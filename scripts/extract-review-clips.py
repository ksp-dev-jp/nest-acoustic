from __future__ import annotations

import argparse
import csv
import re
import wave
from collections import defaultdict
from pathlib import Path


def safe_name(value: str) -> str:
    return re.sub(r"[^0-9A-Za-z._\-\u3040-\u30ff\u3400-\u9fff]+", "_", value).strip("_")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("wav", type=Path)
    parser.add_argument("events_csv", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--per-species", type=int, default=3)
    parser.add_argument("--max-clips", type=int, default=24)
    parser.add_argument("--seconds", type=float, default=9.0)
    args = parser.parse_args()

    with args.events_csv.open("r", encoding="utf-8-sig", newline="") as handle:
        events = list(csv.DictReader(handle))
    events.sort(key=lambda row: float(row["peak_confidence"]), reverse=True)

    selected: list[dict[str, str]] = []
    counts: dict[str, int] = defaultdict(int)
    for event in events:
        species = event["scientific_name"]
        if counts[species] >= args.per_species:
            continue
        selected.append(event)
        counts[species] += 1
        if len(selected) >= args.max_clips:
            break

    args.output_dir.mkdir(parents=True, exist_ok=True)
    with wave.open(str(args.wav), "rb") as source:
        rate = source.getframerate()
        total_frames = source.getnframes()
        clip_frames = int(args.seconds * rate)
        for index, event in enumerate(selected, start=1):
            peak_seconds = sum(int(part) * multiplier for part, multiplier in zip(
                event["peak_offset"].split(":"), (3600, 60, 1)
            ))
            first_frame = max(0, int((peak_seconds - 3) * rate))
            frame_count = min(clip_frames, total_frames - first_frame)
            source.setpos(first_frame)
            frames = source.readframes(frame_count)
            filename = (
                f"{index:02d}_{safe_name(event['species_ja'])}_{event['peak_offset'].replace(':', '-')}_"
                f"score-{float(event['peak_confidence']):.3f}.wav"
            )
            with wave.open(str(args.output_dir / filename), "wb") as target:
                target.setnchannels(source.getnchannels())
                target.setsampwidth(source.getsampwidth())
                target.setframerate(rate)
                target.writeframes(frames)


if __name__ == "__main__":
    main()
