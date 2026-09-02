#!/usr/bin/env python3
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

MAX_TILE_PIXELS = 1900
OVERLAP_PIXELS = 200


def positions(length: int) -> list[int]:
    if length <= MAX_TILE_PIXELS:
        return [0]
    values = list(range(0, length - MAX_TILE_PIXELS + 1, MAX_TILE_PIXELS - OVERLAP_PIXELS))
    last = length - MAX_TILE_PIXELS
    if values[-1] != last:
        values.append(last)
    return values


def main() -> int:
    if len(sys.argv) != 3:
        return 2
    source = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    if not source.is_file() or source.is_symlink():
        return 2

    if destination.exists():
        if destination.is_symlink():
            return 2
        shutil.rmtree(destination)
    destination.mkdir(parents=True)

    records = []
    with Image.open(source) as image:
        image.load()
        index = 0
        for top in positions(image.height):
            for left in positions(image.width):
                index += 1
                right = min(left + MAX_TILE_PIXELS, image.width)
                bottom = min(top + MAX_TILE_PIXELS, image.height)
                name = f"tile-{index:04d}.png"
                image.crop((left, top, right, bottom)).save(destination / name, format="PNG")
                records.append({"file": name, "left": left, "top": top, "right": right, "bottom": bottom})

    print(json.dumps(records, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
