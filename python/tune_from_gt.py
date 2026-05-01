"""
tune_from_gt.py — Ground-truth Viterbi parameter search

Given a MIDI and its matching .gp5 tab, finds Viterbi params that maximise
string-assignment accuracy (% of notes on the correct string).

Once the string is correct, the fret follows deterministically from the pitch
and tuning — so string accuracy is the right optimisation target.

Usage:
    python tune_from_gt.py --midi ../od.mid --gp5 ../od.gp5 --n_trials 500

Output:
    Prints best params as JSON, ready to paste into a preset or viterbi_config.jsonc
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

# ---------------------------------------------------------------------------
# GP5 ground-truth extraction
# ---------------------------------------------------------------------------

def _beat_ticks(beat, gpq: int) -> int:
    val = beat.duration.value          # 1=whole 2=half 4=quarter 8=eighth …
    ticks = gpq * 4 // val
    if beat.duration.isDotted:
        ticks = ticks * 3 // 2
    t = beat.duration.tuplet
    if t.enters != 1 and t.times != 1:
        ticks = ticks * t.times // t.enters
    return max(1, ticks)


def _measure_ticks(header, gpq: int) -> int:
    num = header.timeSignature.numerator
    den = header.timeSignature.denominator.value   # denominator note value (4 = quarter)
    return gpq * 4 * num // den


def extract_gt(gp5_path: str, track_idx: int = 0, gpq: int = 960) -> Dict[Tuple[int,int], Tuple[int,int]]:
    """
    Returns {(abs_tick, midi_pitch): (string_1indexed, fret)} for every note
    in the specified track. Uses beat.start which is already absolute.
    """
    import guitarpro as _gp
    song = _gp.parse(gp5_path)
    track = song.tracks[track_idx]

    gt: Dict[Tuple[int,int], Tuple[int,int]] = {}

    for measure in track.measures:
        for voice in measure.voices:
            for beat in voice.beats:
                if beat.status == _gp.models.BeatStatus.rest or not beat.notes:
                    continue
                # beat.start is absolute ticks from song start
                abs_tick = beat.start
                for note in beat.notes:
                    pitch  = note.realValue   # MIDI pitch
                    string = note.string      # 1 = highest string
                    fret   = note.value
                    key = (abs_tick, pitch)
                    if key not in gt:
                        gt[key] = (string, fret)

    # guitarpro starts all tracks at an internal offset (usually 960).
    # Normalise to zero so ticks align with MIDI-derived event starts.
    if gt:
        offset = min(tick for tick, _ in gt.keys())
        gt = {(tick - offset, pitch): val for (tick, pitch), val in gt.items()}

    return gt


# ---------------------------------------------------------------------------
# Alignment: match JSONL events to GT notes
# ---------------------------------------------------------------------------

def align(events: List[Dict], gt: Dict[Tuple[int,int], Tuple[int,int]],
          tolerance: int = 120) -> List[Tuple[int, int, int, int]]:
    """
    For each pitch in each event, find the closest GT entry by tick.
    Returns list of (event_idx, pitch, gt_string, gt_fret).
    Events use 'start' (float ticks) and 'pitches' (list of int).
    """
    from collections import defaultdict
    import bisect

    pitch_index: Dict[int, List[Tuple[int,int,int]]] = defaultdict(list)
    for (tick, pitch), (string, fret) in gt.items():
        pitch_index[pitch].append((tick, string, fret))
    for lst in pitch_index.values():
        lst.sort()

    aligned = []
    for ev_idx, ev in enumerate(events):
        ev_tick = int(ev.get("start", 0))
        for pitch in ev.get("pitches", []):
            pitch = int(pitch)
            candidates = pitch_index.get(pitch, [])
            if not candidates:
                continue
            ticks = [c[0] for c in candidates]
            i = bisect.bisect_left(ticks, ev_tick)
            best, best_d = None, tolerance + 1
            for j in (i-1, i):
                if 0 <= j < len(candidates):
                    d = abs(candidates[j][0] - ev_tick)
                    if d < best_d:
                        best_d, best = d, candidates[j]
            if best is not None:
                aligned.append((ev_idx, pitch, best[1], best[2]))
    return aligned


# ---------------------------------------------------------------------------
# Objective
# ---------------------------------------------------------------------------

def string_accuracy(preds: List[vp.Voicing], aligned: List[Tuple[int,int,int,int]]) -> float:
    """Fraction of GT notes whose predicted string matches ground truth."""
    if not aligned:
        return 0.0
    correct = 0
    for ev_idx, pitch, gt_string, _ in aligned:
        if ev_idx >= len(preds):
            continue
        pred = preds[ev_idx]
        for p_pitch, p_string in zip(pred.pitches, pred.strings):
            if int(p_pitch) == pitch:
                if int(p_string) == int(gt_string):
                    correct += 1
                break
    return correct / len(aligned)


# ---------------------------------------------------------------------------
# Search space
# ---------------------------------------------------------------------------

PARAM_BOUNDS: Dict[str, Tuple[float, float]] = {
    "local_cost.w_span":                        (0.0,  15.0),   # wide stretch → may need high penalty
    "local_cost.w_high":                        (0.0,   5.0),
    "local_cost.w_string_range":                (0.0,   8.0),
    "local_cost.w_preferred_zone":             (-8.0,   0.0),
    "local_cost.w_high_string":                 (0.0,  10.0),
    "string_discontinuity.w_holes":             (0.0,  10.0),
    "string_discontinuity.w_gap":               (0.0,   5.0),
    "string_discontinuity.w_blocks":            (0.0,  10.0),
    "transition_cost.w_jump":                   (0.0,  10.0),
    "transition_cost.jump_power":               (1.0,   2.5),
    "transition_cost.jump_threshold_penalty":   (0.0,  10.0),
    "transition_cost.w_avg_jump":               (0.0,   8.0),
    "transition_cost.w_string_center":          (0.0,  10.0),
    "transition_cost.close_jump_bonus":        (-8.0,   0.0),
    "transition_cost.w_span_change":            (0.0,   5.0),
    "transition_cost.w_streak":                 (0.0,  10.0),
    "transition_cost.w_same_string_bonus":     (-8.0,   0.0),
    "transition_cost.w_string_jump":            (0.0,   8.0),
    # tapping weights
    "tapping.w_tap_activation":                 (0.0,   5.0),
    "tapping.w_tap_deactivation":               (0.0,   3.0),
    "tapping.w_tap_jump":                       (0.0,   5.0),
    # legato
    "legato.max_fret_distance":                 (2.0,  10.0),
}

INT_PARAMS: Dict[str, Tuple[int, int]] = {
    "transition_cost.same_string_pitch_threshold": (2, 9),
    "transition_cost.string_jump_threshold":        (0, 3),
    "tapping.tap_min_fret":                         (3, 12),
    "legato.speed_threshold":                       (120, 960),
}

# Fixed for this song: it uses tapping and legato
FIXED_OVERRIDES = {
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
# Main tuning function
# ---------------------------------------------------------------------------

def tune(midi_path: str, gp5_path: str, base_cfg: Dict,
         n_trials: int, beam_size: int, gpq: int, step: int,
         track_idx: int, verbose: bool) -> Dict:

    import optuna
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    # 1. Extract GT
    print("Extracting ground truth from GP5…")
    gt = extract_gt(gp5_path, track_idx=track_idx, gpq=gpq)
    print(f"  {len(gt)} GT notes extracted")

    # 2. MIDI → JSONL
    print("Converting MIDI to events…")
    with tempfile.TemporaryDirectory() as tmp:
        jsonl_path = os.path.join(tmp, "input.jsonl")
        midi_to_jsonl_active_compressed(
            midi_path=midi_path,
            out_path=jsonl_path,
            gp_quarter_ticks=gpq,
            step=step,
        )
        events = vp.load_events_from_jsonl(jsonl_path)

    print(f"  {len(events)} events loaded")

    # 3. Align
    aligned = align(events, gt, tolerance=step * 2)
    print(f"  {len(aligned)} notes aligned (coverage: {len(aligned)/max(len(gt),1):.1%})")
    if len(aligned) < 10:
        raise RuntimeError("Too few aligned notes — check that MIDI and GP5 match the same song")

    # 4. Build fast base config
    cfg_base = deepcopy(base_cfg)
    cfg_base["search"]["beam_size"] = beam_size
    apply_overrides(cfg_base, FIXED_OVERRIDES)

    # 5. Optuna
    print(f"\nStarting Optuna search ({n_trials} trials, beam={beam_size})…")
    t0 = time.time()

    def objective(trial: "optuna.Trial") -> float:
        overrides = {k: trial.suggest_float(k, lo, hi) for k, (lo, hi) in PARAM_BOUNDS.items()}
        overrides.update({k: trial.suggest_int(k, lo, hi) for k, (lo, hi) in INT_PARAMS.items()})
        overrides.update(FIXED_OVERRIDES)
        cfg_i = apply_overrides(cfg_base, overrides)
        try:
            preds = vp.viterbi_decode(events, cfg_i)
            return string_accuracy(preds, aligned)
        except Exception:
            return 0.0

    sampler = optuna.samplers.TPESampler(seed=42, n_startup_trials=50)
    study = optuna.create_study(direction="maximize", sampler=sampler)
    study.optimize(objective, n_trials=n_trials,
                   show_progress_bar=True, n_jobs=1)

    best = study.best_trial
    elapsed = time.time() - t0
    print(f"\nDone in {elapsed:.0f}s")
    print(f"Best string accuracy: {best.value:.2%}  (trial #{best.number})")

    if verbose:
        # Show accuracy of defaults for comparison
        default_preds = vp.viterbi_decode(events, cfg_base)
        default_acc = string_accuracy(default_preds, aligned)
        print(f"Default params accuracy: {default_acc:.2%}")
        print(f"Improvement: +{(best.value - default_acc)*100:.1f}pp")

    return best.params


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description="Ground-truth Viterbi parameter tuner")
    ap.add_argument("--midi",      required=True)
    ap.add_argument("--gp5",       required=True)
    ap.add_argument("--config",    default="viterbi_config.jsonc")
    ap.add_argument("--n_trials",  type=int, default=500)
    ap.add_argument("--beam_size", type=int, default=50)
    ap.add_argument("--gpq",       type=int, default=960)
    ap.add_argument("--step",      type=int, default=60)
    ap.add_argument("--track",     type=int, default=0, help="GP5 track index (0=first)")
    ap.add_argument("--out",       default="gt_best_params.json")
    ap.add_argument("--quiet",     action="store_true")
    args = ap.parse_args()

    os.chdir(os.path.dirname(os.path.abspath(__file__)))

    import viterbi_predict as vp
    base_cfg = vp.load_config(args.config)

    best_params = tune(
        midi_path=args.midi,
        gp5_path=args.gp5,
        base_cfg=base_cfg,
        n_trials=args.n_trials,
        beam_size=args.beam_size,
        gpq=args.gpq,
        step=args.step,
        track_idx=args.track,
        verbose=not args.quiet,
    )

    # Merge fixed overrides into output
    best_params.update({
        "tapping.allow_tapping": 1,
        "legato.allow_legato":   1,
    })

    with open(args.out, "w") as f:
        json.dump(best_params, f, indent=2)

    print(f"\nBest params saved to {args.out}")
    print("\n── Best params (copy into preset) ──────────────────────────────")
    print(json.dumps(best_params, indent=2))


if __name__ == "__main__":
    main()
