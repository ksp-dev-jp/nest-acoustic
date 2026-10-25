from __future__ import annotations

import argparse
import math
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageOps


def spectrogram(path: Path, width: int = 900, height: int = 420, max_hz: int = 12_000) -> Image.Image:
    with wave.open(str(path), "rb") as handle:
        channels = handle.getnchannels()
        sample_width = handle.getsampwidth()
        rate = handle.getframerate()
        raw = handle.readframes(handle.getnframes())
    if sample_width != 2:
        raise ValueError(f"Expected 16-bit PCM: {path}")
    signal = np.frombuffer(raw, dtype="<i2").astype(np.float32).reshape(-1, channels).mean(axis=1) / 32768.0
    window_size = 2048
    hop = 256
    frame_count = max(1, 1 + (len(signal) - window_size) // hop)
    frames = np.lib.stride_tricks.as_strided(
        signal,
        shape=(frame_count, window_size),
        strides=(signal.strides[0] * hop, signal.strides[0]),
    ).copy()
    frames *= np.hanning(window_size)
    magnitude = np.abs(np.fft.rfft(frames, axis=1)).T
    max_bin = min(magnitude.shape[0], math.ceil(max_hz / rate * window_size))
    db = 20 * np.log10(magnitude[:max_bin] + 1e-7)
    ceiling = float(np.percentile(db, 99.8))
    normalized = np.clip((db - (ceiling - 70)) / 70, 0, 1)
    grayscale = Image.fromarray(np.uint8(normalized[::-1] * 255), mode="L").resize((width, height))
    return ImageOps.colorize(grayscale, black="#07111f", mid="#136f8a", white="#fff3a8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("clip_dir", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    paths = sorted(args.clip_dir.glob("*.wav"))
    cell_width, cell_height = 900, 465
    columns = 2
    rows = math.ceil(len(paths) / columns)
    canvas = Image.new("RGB", (cell_width * columns, cell_height * rows), "#08111e")
    draw = ImageDraw.Draw(canvas)
    for index, path in enumerate(paths):
        x = (index % columns) * cell_width
        y = (index // columns) * cell_height
        image = spectrogram(path, width=cell_width, height=420)
        canvas.paste(image, (x, y + 35))
        ascii_label = path.stem.encode("ascii", "ignore").decode("ascii")
        draw.text((x + 10, y + 10), ascii_label, fill="white")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.output)


if __name__ == "__main__":
    main()
