"""Generate the OrderHub Desktop application icon from code.

The icon is a new geometric mark (no text, no crop of the decorative
illustrations) so it does not misrepresent the generated artwork as an app
icon. Run from the repository root with the bundled Python that has Pillow.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SIZE = 1024
TEAL = (86, 214, 208, 255)
TEAL_DIM = (46, 148, 152, 255)
INK = (13, 18, 21, 255)


def rounded_mask(size: int, radius: int) -> Image.Image:
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def gradient(size: int) -> Image.Image:
    y = np.linspace(0.0, 1.0, size, dtype=np.float32)[:, None]
    x = np.linspace(0.0, 1.0, size, dtype=np.float32)[None, :]
    # Graphite with a faint cool light from the upper-left.
    base = np.zeros((size, size, 3), dtype=np.float32)
    base[..., 0] = 18 + 20 * (1 - y) + 5 * (1 - x)
    base[..., 1] = 23 + 26 * (1 - y) + 6 * (1 - x)
    base[..., 2] = 27 + 28 * (1 - y) + 8 * (1 - x)
    image = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    return image


def main() -> None:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    body = gradient(SIZE)
    body.putalpha(rounded_mask(SIZE, 226))
    canvas.alpha_composite(body)

    # Frosted inner plate: draw on an overlay so the alpha is composited with
    # the graphite body rather than replacing it with a translucent pixel.
    plate = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    plate_draw = ImageDraw.Draw(plate)
    plate_draw.rounded_rectangle(
        (96, 96, SIZE - 96, SIZE - 96),
        radius=166,
        fill=(29, 38, 42, 196),
        outline=(148, 196, 198, 70),
        width=4,
    )
    canvas.alpha_composite(plate)

    draw = ImageDraw.Draw(canvas)
    # Teal ring, intentionally open at the lower right (a progress/connection cue).
    draw.arc(
        (246, 246, SIZE - 246, SIZE - 246),
        start=35,
        end=326,
        fill=TEAL,
        width=58,
    )
    draw.arc(
        (246, 246, SIZE - 246, SIZE - 246),
        start=326,
        end=350,
        fill=TEAL_DIM,
        width=58,
    )
    # Order-book bars inside the ring.
    bars = [
        (386, 262, 120, 62),
        (386, 398, 210, 62),
        (386, 534, 160, 62),
    ]
    for index, (x, y, width, height) in enumerate(bars):
        color = (243, 250, 250, 255) if index == 1 else (176, 196, 197, 255)
        draw.rounded_rectangle((x, y, x + width, y + height), radius=31, fill=color)
    # Small teal status tick at the ring opening.
    draw.ellipse((704, 704, 784, 784), fill=TEAL)

    icons = Path(__file__).resolve().parents[1] / "apps" / "desktop" / "src-tauri" / "icons"
    icons.mkdir(parents=True, exist_ok=True)
    master = canvas
    for size, name in [
        (32, "32x32.png"),
        (128, "128x128.png"),
        (256, "128x128@2x.png"),
        (512, "icon.png"),
        (1024, "icon-1024.png"),
    ]:
        resized = master.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(icons / name)
    master.save(
        icons / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )
    print(f"wrote icons to {icons}")


if __name__ == "__main__":
    main()
