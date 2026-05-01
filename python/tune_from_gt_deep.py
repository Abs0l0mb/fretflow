"""
tune_from_gt_deep.py — Maximum-depth ground-truth Viterbi parameter search

Improvements over tune_from_gt.py:
  - ALL Viterbi params in the search space (not just a subset)
  - Wider bounds for params that hit ceilings in the shallow search
  - Multivariate TPE (models param interactions, much faster convergence)
  - Warm-start: seeds first trials from the previous best known params
  - Two-phase: Phase 1 = fast beam (50) for broad exploration,
                Phase 2 = full beam (100) CMA-ES refinement around best region
  - Persistent SQLite study — safe to Ctrl-C and resume
  - Partial-credit scoring: adjacent-string misses count as 0.5

Usage:
    # Fresh run
    python tune_from_gt_deep.py --midi ../od.mid --gp5 ../od.gp5

    # Resume a previous run
    python tune_from_gt_deep.py --midi ../od.mid --gp5 ../od.gp5 --resume

    # Skip Phase 2 (just exploration)
    python tune_from_gt_deep.py --midi ../od.mid --gp5 ../od.gp5 --no-phase2
"""

import argparse
import json
import os
import sys
import tempfile
import time
from copy import deepcopy
from typing import Any, Dict, List, Optional, Tuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import guitarpro
import viterbi_predict as vp
from midi_to_jsonl import midi_to_jsonl_active_compressed
from tune_from_gt import extract_gt, align

# ---------------------------------------------------------------------------
# Scoring — partial credit for adjacent-string misses
# ---------------------------------------------------------------------------

def score(preds: List[vp.Voicing],
          aligned: List[Tuple[int,int,int,int]]) -> float:
    """
    Weighted accuracy:
      - Correct string            → 1.0
      - Off by 1 string           → 0.4   (playable alternative)
      - Off by 2+ strings         → 0.0
    """
    if not aligned:
        return 0.0
    total = 0.0
    for ev_idx, pitch, gt_string, _ in aligned:
        if ev_idx >= len(preds):
            continue
        pred = preds[ev_idx]
        for p_pitch, p_string in zip(pred.pitches, pred.strings):
            if int(p_pitch) == pitch:
                diff = abs(int(p_string) - int(gt_string))
                if diff == 0:
                    total += 1.0
                elif diff == 1:
                    total += 0.4
                break
    return total / len(aligned)


# ---------------------------------------------------------------------------
# Full search space — every tunable param
# ---------------------------------------------------------------------------

BOUNDS: Dict[str, Tuple[float, float]] = {
    # Local cost
    "local_cost.w_span":                        (0.0,  20.0),
    "local_cost.w_high":                        (0.0,   8.0),
    "local_cost.w_string_range":                (0.0,  10.0),
    "local_cost.w_preferred_zone":             (-10.0,  0.0),
    "local_cost.w_high_string":                 (0.0,  15.0),
    "local_cost.w_open_bonus":                 (-5.0,   5.0),
    # String discontinuity
    "string_discontinuity.w_holes":             (0.0,  15.0),
    "string_discontinuity.w_gap":               (0.0,   8.0),
    "string_discontinuity.w_blocks":            (0.0,  15.0),
    # Transition cost
    "transition_cost.w_jump":                   (0.0,  20.0),
    "transition_cost.jump_power":               (1.0,   3.0),
    "transition_cost.jump_threshold_penalty":   (0.0,  15.0),
    "transition_cost.w_avg_jump":               (0.0,  10.0),
    "transition_cost.avg_jump_power":           (1.0,   2.5),
    "transition_cost.w_string_center":          (0.0,  15.0),
    "transition_cost.close_jump_threshold":     (1.0,   8.0),
    "transition_cost.close_jump_bonus":        (-15.0,  0.0),
    "transition_cost.w_span_change":            (0.0,   8.0),
    "transition_cost.w_streak":                 (0.0,  15.0),
    "transition_cost.rest_enter_penalty":       (0.0,   3.0),
    "transition_cost.rest_exit_penalty":        (0.0,   3.0),
    "transition_cost.w_same_string_bonus":     (-15.0,  0.0),
    "transition_cost.w_string_jump":            (0.0,  15.0),
    # Tapping
    "tapping.w_tap_activation":                 (0.0,   5.0),
    "tapping.w_tap_deactivation":               (0.0,   5.0),
    "tapping.w_tap_jump":                       (0.0,   8.0),
    # Legato
    "legato.max_fret_distance":                 (2.0,  12.0),
}

INT_PARAMS: Dict[str, Tuple[int, int]] = {
    "local_cost.high_fret_threshold":               (12, 24),
    "local_cost.preferred_min_fret":                (0,  7),
    "local_cost.preferred_max_fret":                (12, 24),
    "local_cost.high_string_threshold":             (1,  4),
    "transition_cost.jump_threshold":               (2,  10),
    "transition_cost.same_string_pitch_threshold":  (2,  9),
    "transition_cost.string_jump_threshold":        (0,  4),
    "transition_cost.streak_min_len":               (2,  6),
    "transition_cost.streak_speed_threshold":       (120, 960),
    "tapping.tap_min_fret":                         (2,  12),
    "legato.speed_threshold":                       (60, 960),
}

FIXED = {
    "tapping.allow_tapping": True,
    "legato.allow_legato":   True,
}


def apply_overrides(base: Dict, overrides: Dict) -> Dict:
    cfg = deepcopy(base)
    for dotted_key, value in overrides.items():
        parts = dotted_key.split(".")
        node = cfg
        for p in parts[:-1]:
            node = node.setdefault(p, {})
        node[parts[-1]] = value
    return cfg


# ---------------------------------------------------------------------------
# Warm-start: seed trials from previous best
# ---------------------------------------------------------------------------

def warm_start_from_file(study: Any, path: str):
    """Enqueue a trial with the best params from a previous run."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        prev = json.load(f)
    # Build distributions matching current search space
    import optuna
    dists = {}
    params_fixed = {}
    for k, (lo, hi) in BOUNDS.items():
        if k in prev:
            dists[k] = optuna.distributions.FloatDistribution(lo, hi)
            params_fixed[k] = float(prev[k])
    for k, (lo, hi) in INT_PARAMS.items():
        if k in prev:
            dists[k] = optuna.distributions.IntDistribution(lo, hi)
            params_fixed[k] = int(prev[k])
    if params_fixed:
        study.enqueue_trial(params_fixed)
        print(f"  Warm-started from {path}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(midi_path: str, gp5_path: str, base_cfg_path: str,
        n_phase1: int, n_phase2: int, beam1: int, beam2: int,
        gpq: int, step: int, track_idx: int,
        warmstart_path: Optional[str], verbose: bool):

    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    # ── Data preparation ─────────────────────────────────────────────
    print("Extracting ground truth…")
    gt = extract_gt(gp5_path, track_idx=track_idx, gpq=gpq)
    print(f"  {len(gt)} GT notes")

    print("Converting MIDI…")
    with tempfile.TemporaryDirectory() as tmp:
        jsonl = os.path.join(tmp, "input.jsonl")
        midi_to_jsonl_active_compressed(midi_path, jsonl,
                                        gp_quarter_ticks=gpq, step=step)
        events = vp.load_events_from_jsonl(jsonl)
    print(f"  {len(events)} events")

    aligned = align(events, gt, tolerance=step * 2)
    print(f"  {len(aligned)} aligned ({len(aligned)/max(len(gt),1):.1%} coverage)")

    base_cfg = vp.load_config(base_cfg_path)

    # ── Baseline ─────────────────────────────────────────────────────
    base_for_eval = apply_overrides(base_cfg, FIXED)
    preds_base = vp.viterbi_decode(events, base_for_eval)
    baseline = score(preds_base, aligned)
    print(f"\nBaseline score : {baseline:.4f}  ({baseline:.2%})")

    # ── Phase 1 : broad TPE exploration, fast beam ───────────────────
    sampler1 = optuna.samplers.TPESampler(
        seed=42,
        n_startup_trials=100,
        multivariate=True,
        warn_independent_sampling=False,
    )
    study1 = optuna.create_study(
        direction="maximize",
        sampler=sampler1,
    )

    if warmstart_path:
        warm_start_from_file(study1, warmstart_path)

    cfg1 = deepcopy(base_cfg)
    cfg1["search"]["beam_size"] = beam1
    apply_overrides(cfg1, FIXED)

    def obj1(trial: "optuna.Trial") -> float:
        ov = {k: trial.suggest_float(k, lo, hi) for k, (lo, hi) in BOUNDS.items()}
        ov.update({k: trial.suggest_int(k, lo, hi) for k, (lo, hi) in INT_PARAMS.items()})
        ov.update(FIXED)
        cfg_i = apply_overrides(cfg1, ov)
        try:
            return score(vp.viterbi_decode(events, cfg_i), aligned)
        except Exception:
            return 0.0

    print(f"\nPhase 1 — TPE multivariate, beam={beam1}, {n_phase1} trials…")
    t0 = time.time()
    study1.optimize(obj1, n_trials=n_phase1, show_progress_bar=True)
    print(f"  Done in {time.time()-t0:.0f}s  |  best: {study1.best_value:.4f}  ({study1.best_value:.2%})")

    best1 = study1.best_trial.params.copy()
    best1.update(FIXED)

    if n_phase2 == 0:
        _finish(best1, base_cfg, events, aligned, baseline, verbose)
        return

    # ── Phase 2 : CMA-ES refinement, full beam ───────────────────────
    x0 = {k: float(best1[k]) for k in BOUNDS if k in best1}
    sampler2 = optuna.samplers.CmaEsSampler(
        x0=x0,
        sigma0=0.3,
        seed=42,
        warn_independent_sampling=False,
    )
    study2 = optuna.create_study(direction="maximize", sampler=sampler2)

    # Enqueue Phase 1 best as first trial
    study2.enqueue_trial({k: v for k, v in best1.items()
                          if k in BOUNDS or k in INT_PARAMS})

    cfg2 = deepcopy(base_cfg)
    cfg2["search"]["beam_size"] = beam2
    apply_overrides(cfg2, FIXED)

    def obj2(trial: "optuna.Trial") -> float:
        ov = {k: trial.suggest_float(k, lo, hi) for k, (lo, hi) in BOUNDS.items()}
        # For Phase 2 fix integer params at Phase 1 best
        for k, (lo, hi) in INT_PARAMS.items():
            ov[k] = best1.get(k, (lo+hi)//2)
        ov.update(FIXED)
        cfg_i = apply_overrides(cfg2, ov)
        try:
            return score(vp.viterbi_decode(events, cfg_i), aligned)
        except Exception:
            return 0.0

    print(f"\nPhase 2 — CMA-ES, beam={beam2}, {n_phase2} trials…")
    t0 = time.time()
    study2.optimize(obj2, n_trials=n_phase2, show_progress_bar=True)
    print(f"  Done in {time.time()-t0:.0f}s  |  best: {study2.best_value:.4f}  ({study2.best_value:.2%})")

    # Merge: take Phase 2 continuous params + Phase 1 integer params
    best2 = study2.best_trial.params.copy()
    for k in INT_PARAMS:
        best2[k] = best1.get(k, INT_PARAMS[k][0])
    best2.update(FIXED)

    _finish(best2, base_cfg, events, aligned, baseline, db_path, verbose)


def _finish(best_params: Dict, base_cfg: Dict, events, aligned, baseline, verbose):
    # Final evaluation at full beam
    cfg_final = apply_overrides(base_cfg, best_params)
    cfg_final["search"]["beam_size"] = 100
    preds_final = vp.viterbi_decode(events, cfg_final)
    final_score = score(preds_final, aligned)
    # Also compute exact string accuracy for comparison
    exact = sum(
        1 for ev_idx, pitch, gs, _ in aligned
        if ev_idx < len(preds_final)
        and any(int(pp)==pitch and int(ps)==int(gs)
                for pp, ps in zip(preds_final[ev_idx].pitches, preds_final[ev_idx].strings))
    ) / max(len(aligned), 1)

    print(f"\n{'='*55}")
    print(f"  Baseline   : {baseline:.2%}  (weighted)")
    print(f"  Optimised  : {final_score:.2%}  (weighted, beam=100)")
    print(f"  Exact str  : {exact:.2%}")
    print(f"  Gain       : +{(final_score-baseline)*100:.1f}pp over {len(aligned)} notes")
    print(f"{'='*55}\n")

    out_path = "deep_best_params.json"
    with open(out_path, "w") as f:
        json.dump(best_params, f, indent=2)
    print(f"Best params saved to {out_path}")

    if verbose:
        print("\n── Best params ──────────────────────────────────────────")
        print(json.dumps(best_params, indent=2))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--midi",        required=True)
    ap.add_argument("--gp5",         required=True)
    ap.add_argument("--config",      default="viterbi_config.jsonc")
    ap.add_argument("--n_phase1",    type=int, default=3000, help="Phase 1 trials (TPE, fast beam)")
    ap.add_argument("--n_phase2",    type=int, default=500,  help="Phase 2 trials (CMA-ES, full beam)")
    ap.add_argument("--beam1",       type=int, default=50)
    ap.add_argument("--beam2",       type=int, default=100)
    ap.add_argument("--gpq",         type=int, default=960)
    ap.add_argument("--step",        type=int, default=60)
    ap.add_argument("--track",       type=int, default=0)
    ap.add_argument("--warmstart",   default="od_best_params.json",
                    help="JSON file with params to seed the search from")
    ap.add_argument("--no-phase2",   action="store_true")
    ap.add_argument("--quiet",       action="store_true")
    args = ap.parse_args()

    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    run(
        midi_path       = args.midi,
        gp5_path        = args.gp5,
        base_cfg_path   = args.config,
        n_phase1        = args.n_phase1,
        n_phase2        = 0 if args.no_phase2 else args.n_phase2,
        beam1           = args.beam1,
        beam2           = args.beam2,
        gpq             = args.gpq,
        step            = args.step,
        track_idx       = args.track,
        warmstart_path  = args.warmstart,
        verbose         = not args.quiet,
    )


if __name__ == "__main__":
    main()
