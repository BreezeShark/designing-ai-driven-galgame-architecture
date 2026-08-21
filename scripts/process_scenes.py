#!/usr/bin/env python3
"""Process `love_girls/场景/` screenshots into clean game scene backgrounds.

The scene images arrive as phone screenshots (1080x2374) that contain, around
the actual scene photo:

  * a solid letterbox bar at the very top,
  * a title / caption text strip just below it,
  * more letterbox between the text and the scene,
  * a bottom letterbox band,
  * the phone's bottom toolbar + home indicator + black bar.

This script keeps only the scene itself (the largest high-detail region) and
writes the result to `public/images/scenes/` as JPEG.

Usage:
    python3 scripts/process_scenes.py            # process all, keep originals
    python3 scripts/process_scenes.py --force    # overwrite existing outputs

Requires: Pillow, numpy (pip install Pillow numpy)
"""

from __future__ import annotations

import argparse
import glob
import os

import numpy as np
from PIL import Image

SRC_DIR = "love_girls/场景"
OUT_DIR = "public/images/scenes"

# std threshold: a row whose pixel std is below this is treated as flat
# (letterbox / uniform fill), not scene content.
DETAIL_THRESHOLD = 15.0
SMOOTH_WINDOW = 20      # rows, to bridge small low-detail gaps inside a scene
GAP_TOLERANCE = 40      # rows, merge scene segments split by short gaps


def find_scene_bounds(arr: np.ndarray) -> tuple[int, int]:
    """Return (top, bottom_exclusive) rows of the largest high-detail region."""
    h = arr.shape[0]
    row_std = arr.astype(np.float64).std(axis=(1, 2))
    kernel = np.ones(SMOOTH_WINDOW) / SMOOTH_WINDOW
    smoothed = np.convolve(row_std, kernel, mode="same")

    regions: list[tuple[int, int]] = []
    start: int | None = None
    for i in range(h):
        if smoothed[i] > DETAIL_THRESHOLD:
            if start is None:
                start = i
        elif start is not None:
            regions.append((start, i - 1))
            start = None
    if start is not None:
        regions.append((start, h - 1))

    # merge regions separated by only a short gap
    merged: list[tuple[int, int]] = []
    for r in regions:
        if merged and r[0] - merged[-1][1] <= GAP_TOLERANCE:
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)

    if not merged:
        raise RuntimeError("no scene region detected")
    top, bottom = max(merged, key=lambda r: r[1] - r[0])
    return top, bottom + 1  # bottom exclusive


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="overwrite existing outputs")
    args = parser.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    files = sorted(glob.glob(os.path.join(SRC_DIR, "*.jpg")) + glob.glob(os.path.join(SRC_DIR, "*.png")))
    if not files:
        print(f"no images found in {SRC_DIR}/")
        return 0

    for i, path in enumerate(files, start=1):
        stem = os.path.splitext(os.path.basename(path))[0]
        out_path = os.path.join(OUT_DIR, f"scene-{i}.jpg")
        if os.path.exists(out_path) and not args.force:
            print(f"skip {os.path.basename(path)} (already processed; use --force to redo)")
            continue

        arr = np.array(Image.open(path).convert("RGB"))
        top, bottom = find_scene_bounds(arr)
        im = Image.open(path)
        cropped = im.crop((0, top, im.size[0], bottom))
        cropped.save(out_path, "JPEG", quality=95)
        print(f"{os.path.basename(path)} -> {out_path} "
              f"(cropped rows {top}-{bottom - 1}, {cropped.size[0]}x{cropped.size[1]})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
