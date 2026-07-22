from __future__ import annotations

import argparse
import json
import textwrap
from pathlib import Path
from typing import Any

import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageOps

WIDTH = 576
MARGIN = 32


def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (
        Path("C:/Windows/Fonts/arialbd.ttf" if bold else "C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default(size=size)


def _wrap(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width, break_long_words=True) or [""]


def _escpos_raster(image: Image.Image) -> bytes:
    monochrome = image.convert("1")
    width_bytes = (monochrome.width + 7) // 8
    raster = bytearray()
    pixels = monochrome.load()
    for y in range(monochrome.height):
        for byte_x in range(width_bytes):
            value = 0
            for bit in range(8):
                x = byte_x * 8 + bit
                if x < monochrome.width and pixels[x, y] == 0:
                    value |= 1 << (7 - bit)
            raster.append(value)
    x_l, x_h = width_bytes & 0xFF, width_bytes >> 8
    y_l, y_h = monochrome.height & 0xFF, monochrome.height >> 8
    return b"\x1b@\x1ba\x01" + bytes((0x1D, 0x76, 0x30, 0, x_l, x_h, y_l, y_h)) + bytes(raster) + b"\n\n\n\x1dV\x00"


def render_ticket(payload: dict[str, Any], output_dir: Path) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    request = payload["request"]
    title = str(request["title"])
    body = str(request.get("body") or "")
    kind = str(request["type"]).upper()
    short_url = str(payload["shortUrl"])

    title_lines = _wrap(title.upper(), 22)
    body_lines = _wrap(body, 48) if body else []
    content_end = 158 + len(title_lines) * 52 + len(body_lines) * 30
    height = max(640, content_end + 260)
    canvas = Image.new("L", (WIDTH, height), 255)
    draw = ImageDraw.Draw(canvas)

    draw.rectangle((MARGIN, 28, WIDTH - MARGIN, 86), fill=0)
    kind_label = f"{kind}  !" if request.get("important") else kind
    kind_font = _font(30, bold=True)
    kind_box = draw.textbbox((0, 0), kind_label, font=kind_font)
    draw.text(((WIDTH - (kind_box[2] - kind_box[0])) / 2, 39), kind_label, font=kind_font, fill=255)

    y = 124
    title_font = _font(42, bold=True)
    for line in title_lines:
        box = draw.textbbox((0, 0), line, font=title_font)
        draw.text(((WIDTH - (box[2] - box[0])) / 2, y), line, font=title_font, fill=0)
        y += 52

    y += 12
    draw.line((MARGIN, y, WIDTH - MARGIN, y), fill=0, width=3)
    y += 22
    body_font = _font(23)
    for line in body_lines:
        draw.text((MARGIN, y), line, font=body_font, fill=0)
        y += 30

    qr = qrcode.make(short_url, border=1).convert("L").resize((176, 176), Image.Resampling.NEAREST)
    qr_y = height - 238
    canvas.paste(qr, ((WIDTH - qr.width) // 2, qr_y))
    footer = "ABRIR NOTA VIVA"
    footer_font = _font(18, bold=True)
    footer_box = draw.textbbox((0, 0), footer, font=footer_font)
    draw.text(((WIDTH - (footer_box[2] - footer_box[0])) / 2, height - 48), footer, font=footer_font, fill=0)

    monochrome = ImageOps.autocontrast(canvas).convert("1", dither=Image.Dither.NONE)
    preview_path = output_dir / "preview.png"
    escpos_path = output_dir / "ticket.escpos"
    monochrome.save(preview_path, format="PNG", optimize=True)
    escpos_path.write_bytes(_escpos_raster(monochrome))
    return preview_path, escpos_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    preview, escpos = render_ticket(payload, args.output)
    print(json.dumps({"previewPath": str(preview), "escposPath": str(escpos)}))


if __name__ == "__main__":
    main()
