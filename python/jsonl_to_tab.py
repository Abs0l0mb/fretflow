import os
import json
import math
from typing import List, Dict, Any, Tuple, Optional

import guitarpro
from guitarpro import models


def load_pred_events(pred_jsonl_path: str) -> List[Dict[str, Any]]:
    rows = []
    with open(pred_jsonl_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))

    if rows and "event_idx" in rows[0]:
        rows.sort(key=lambda r: int(r.get("event_idx", 0)))
    else:
        rows.sort(key=lambda r: float(r.get("start", 0.0)))
    return rows


def set_time_signature(header: models.MeasureHeader, numerator: int, denominator: int) -> None:
    header.timeSignature.numerator = int(numerator)
    header.timeSignature.denominator.value = int(denominator)
    # beams auto-init in TimeSignature.__attrs_post_init__ if empty


def measure_len_ticks(numerator: int, denominator: int, quarter_ticks: int = 960) -> int:
    # Duration.quarterTime = 960 in PyGuitarPro. :contentReference[oaicite:3]{index=3}
    return int(round(numerator * quarter_ticks * (4.0 / denominator)))


# All tick values PyGuitarPro's Duration.fromTime can represent (at quarterTime=960):
# plain + dotted for each of: 64th=60, 32nd=120, 16th=240, 8th=480, quarter=960,
# half=1920, whole=3840.
_VALID_GP5_DURATIONS = sorted(
    v for base in (60, 120, 240, 480, 960, 1920, 3840)
    for v in (base, int(base * 1.5))
)

def snap_duration(ticks: int) -> int:
    """Round ticks to the nearest value representable as a GP5 Duration."""
    return min(_VALID_GP5_DURATIONS, key=lambda v: abs(v - ticks))


E_STD_TUNING = [64, 59, 55, 50, 45, 40]  # string 1 (high E) to string 6 (low E)

def configure_guitar_track(song: models.Song, tuning: List[int]) -> models.Track:
    """
    Configure the first track of a Song using the provided tuning list.
    tuning: open MIDI pitches from string 1 (highest) to string N (lowest).
    """
    track = song.tracks[0]
    track.name = "Guitar"
    track.isPercussionTrack = False
    track.fretCount = 24
    track.channel.instrument = 29  # Overdriven Guitar (optional)

    track.strings = [
        models.GuitarString(number=i + 1, value=int(pitch))
        for i, pitch in enumerate(tuning)
    ]
    return track


def add_note_to_beat(beat: models.Beat, string: int, fret: int, velocity: int = 90) -> None:
    n = models.Note(beat=beat)
    n.string = int(string)
    n.value = int(fret)
    n.velocity = int(velocity)
    beat.notes.append(n)

def set_note_type_tie(note):
    # Prefer enum if available
    if hasattr(models, "NoteType") and hasattr(models.NoteType, "tie"):
        note.type = models.NoteType.tie
    else:
        # GP5 spec: 2 = tied
        note.type = 2

def add_note(beat, string: int, fret: int, is_tie: bool):
    n = models.Note(beat=beat)
    n.string = int(string)
    n.value = int(fret)
    n.velocity = 90
    if is_tie:
        set_note_type_tie(n)
    beat.notes.append(n)

def build_gp5_from_pred_rows(
    pred_rows: List[Dict[str, Any]],
    out_gp5_path: str,
    title: str = "Viterbi prediction",
    tempo: int = 120,
    time_sig: Tuple[int, int] = (4, 4),
    quarter_ticks: int = 960,
    tuning: Optional[List[int]] = None,
) -> str:
    if tuning is None:
        tuning = E_STD_TUNING

    num, den = time_sig
    default_measure_len = measure_len_ticks(num, den, quarter_ticks=quarter_ticks)

    # IMPORTANT: use Song() default structure (it already has 1 header + 1 track)
    song = models.Song(versionTuple=(5, 1, 0))
    song.title = title
    song.tempo = int(tempo)

    track = configure_guitar_track(song, tuning)

    # Configure first measure header (already exists by default in Song.measureHeaders) :contentReference[oaicite:5]{index=5}
    first_header = song.measureHeaders[0]
    first_header.number = 1
    set_time_signature(first_header, num, den)

    # The track already has a Measure linked to that header (created by Track factory) :contentReference[oaicite:6]{index=6}
    current_measure_index = 0
    current_measure = track.measures[current_measure_index]

    # Make sure voices exist & are empty
    # Measure has 2 voices by default (maxVoices=2). :contentReference[oaicite:7]{index=7}
    for v in current_measure.voices:
        v.beats = []

    remaining = default_measure_len

    def open_new_measure(numerator=num, denominator=den) -> None:
        nonlocal current_measure_index, current_measure, remaining

        # This is the KEY: use song.newMeasure() so headers+measures stay consistent :contentReference[oaicite:8]{index=8}
        song.newMeasure()

        current_measure_index += 1
        current_measure = track.measures[current_measure_index]

        # header numbering is stored in the header object; ensure it’s correct
        header = current_measure.header
        header.number = current_measure_index + 1
        set_time_signature(header, numerator, denominator)

        for v in current_measure.voices:
            v.beats = []

        remaining = measure_len_ticks(numerator, denominator, quarter_ticks=quarter_ticks)
    
    def set_note_type_tie(note: models.Note) -> None:
        # Prefer enum if available
        if hasattr(models, "NoteType") and hasattr(models.NoteType, "tie"):
            note.type = models.NoteType.tie
        else:
            # GP5 spec: 2 = tied
            note.type = 2

    def add_note_to_beat_tieaware(
        beat: models.Beat,
        string: int,
        fret: int,
        is_tie: bool,
        legato: Optional[str] = None,
    ) -> None:
        n = models.Note(beat=beat)
        n.string = int(string)
        n.value = int(fret)
        n.velocity = 90
        if is_tie:
            set_note_type_tie(n)
        if legato == "HO":
            n.effect.hammer = True
        elif legato == "PO":
            n.effect.pullOff = True
        beat.notes.append(n)

    # state across segments (active pitches)
    prev_active: set[int] = set()

    for row in pred_rows:
        dur = row.get("dur")
        if dur is None:
            raise ValueError("Each row must contain 'dur'.")

        dur_ticks = snap_duration(int(round(float(dur))))
        if dur_ticks <= 0:
            continue

        cur_active = set(int(p) for p in row.get("pitches", []) or [])
        pred_strings = row.get("pred_strings", []) or []
        pred_frets   = row.get("pred_frets",   []) or []
        pred_legato  = row.get("pred_legato",  []) or []

        if len(pred_strings) != len(pred_frets):
            raise ValueError(f"pred_strings/pred_frets mismatch at event_idx={row.get('event_idx')}")

        # For rests, pred arrays may be empty, that's ok.
        # For non-rest, we expect one mapping per pitch:
        if cur_active and (len(pred_strings) != len(cur_active)):
            # Not fatal, but usually indicates mismatch between pitches and preds
            # You can raise if you want strictness.
            pass

        # Handle beats longer than a measure: allocate a dedicated bigger measure
        if dur_ticks > default_measure_len:
            if remaining != default_measure_len:
                open_new_measure(num, den)

            unit = quarter_ticks * (4.0 / den)
            num_needed = int(math.ceil(dur_ticks / unit))
            open_new_measure(num_needed, den)

        # If it doesn't fit, open next measure
        if dur_ticks > remaining:
            open_new_measure(num, den)

        # ✅ define voice0 for the CURRENT measure
        voice0 = current_measure.voices[0]

        beat = models.Beat(voice=voice0)
        beat.notes = []
        beat.duration = models.Duration.fromTime(dur_ticks)

        if not cur_active:
            beat.status = models.BeatStatus.rest
        else:
            beat.status = models.BeatStatus.normal

            # Build mapping pitch -> (string, fret, legato) from predictions
            pitch_list = list(row.get("pitches", []) or [])
            # pad pred_legato with None if shorter than pitch_list
            legato_list = list(pred_legato) + [None] * max(0, len(pitch_list) - len(pred_legato))
            pitch_map = {
                int(p): (int(s), int(f), leg)
                for p, s, f, leg in zip(pitch_list, pred_strings, pred_frets, legato_list)
            }

            starting = cur_active - prev_active
            continuing = cur_active & prev_active

            # Add continuing as ties (legato not applied to ties)
            used_strings = set()
            for p in sorted(continuing):
                if p not in pitch_map:
                    continue
                s, f, _ = pitch_map[p]
                if s in used_strings:
                    continue
                used_strings.add(s)
                add_note_to_beat_tieaware(beat, s, f, is_tie=True)

            # Add starting as normal notes (with legato if present)
            for p in sorted(starting):
                if p not in pitch_map:
                    continue
                s, f, leg = pitch_map[p]
                if s in used_strings:
                    continue
                used_strings.add(s)
                add_note_to_beat_tieaware(beat, s, f, is_tie=False, legato=leg)

        voice0.beats.append(beat)
        remaining -= dur_ticks

        # update active set AFTER writing beat
        prev_active = cur_active

        # If measure perfectly filled, move on
        if remaining == 0:
            open_new_measure(num, den)

    prev_active = cur_active    

    # Remove trailing empty measure if created
    if track.measures and len(track.measures[-1].voices[0].beats) == 0:
        track.measures.pop()
        song.measureHeaders.pop()

    # Ensure every voice[1] has at least a whole-measure rest so AlphaTab
    # can read the file without hitting undefined.beats on the second voice.
    for measure in track.measures:
        v1 = measure.voices[1]
        if not v1.beats:
            rest = models.Beat(voice=v1)
            rest.status = models.BeatStatus.rest
            rest.duration = models.Duration.fromTime(
                measure_len_ticks(
                    measure.header.timeSignature.numerator,
                    measure.header.timeSignature.denominator.value,
                    quarter_ticks,
                )
            )
            v1.beats = [rest]

    os.makedirs(os.path.dirname(out_gp5_path) or ".", exist_ok=True)
    guitarpro.write(song, out_gp5_path, version=(5, 1, 0))
    return out_gp5_path


def roundtrip_sanity_check(gp5_path: str, max_print_measures: int = 3) -> None:
    s = guitarpro.parse(gp5_path)
    t = s.tracks[0]
    print(f"[CHECK] measures={len(t.measures)} tempo={s.tempo}")
    for mi, m in enumerate(t.measures[:max_print_measures], start=1):
        v0 = m.voices[0]
        durs = [b.duration.time for b in v0.beats[:10]]
        print(f"  measure {mi}: beats={len(v0.beats)} first_durs={durs}")


if __name__ == "__main__":
    import argparse
    import commentjson

    ap = argparse.ArgumentParser()
    ap.add_argument("--pred", default="./test_output_folder/playing_god.jsonl")
    ap.add_argument("--out", default="./viterbi_preds_gp5/playing_god.gp5")
    ap.add_argument("--config", default="viterbi_config.jsonc")
    ap.add_argument("--tempo", type=int, default=120)
    args = ap.parse_args()

    tuning = E_STD_TUNING
    if os.path.exists(args.config):
        with open(args.config, "r", encoding="utf-8") as f:
            cfg = commentjson.load(f)
        tuning = cfg.get("guitar", {}).get("tuning", E_STD_TUNING)

    rows = load_pred_events(args.pred)
    out = build_gp5_from_pred_rows(
        pred_rows=rows,
        out_gp5_path=args.out,
        title="Viterbi prediction",
        tempo=args.tempo,
        time_sig=(4, 4),
        quarter_ticks=960,
        tuning=tuning,
    )
    print(f"[OK] wrote {out}")
    roundtrip_sanity_check(out)
