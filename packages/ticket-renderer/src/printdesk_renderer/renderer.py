from __future__ import annotations

import argparse
import json
import math
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageOps

WIDTH = 576
MARGIN = 30
MADRID = ZoneInfo("Europe/Madrid")
TYPE_LABELS = {
    "task": "TAREA",
    "idea": "IDEA",
    "reminder": "RECORDATORIO",
    "note": "NOTA",
}


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


def _centered_x(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> float:
    box = draw.textbbox((0, 0), text, font=font)
    return (WIDTH - (box[2] - box[0])) / 2


def _right_x(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont, right: int) -> float:
    box = draw.textbbox((0, 0), text, font=font)
    return right - (box[2] - box[0])


def _dashed_line(draw: ImageDraw.ImageDraw, y: int, start: int = MARGIN, end: int = WIDTH - MARGIN) -> None:
    for x in range(start, end, 14):
        draw.line((x, y, min(x + 7, end), y), fill=0, width=2)


def _calendar_icon(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    draw.rectangle((x, y + 3, x + 25, y + 26), outline=0, width=2)
    draw.line((x, y + 10, x + 25, y + 10), fill=0, width=2)
    draw.line((x + 6, y, x + 6, y + 7), fill=0, width=2)
    draw.line((x + 19, y, x + 19, y + 7), fill=0, width=2)


def _star(draw: ImageDraw.ImageDraw, center_x: int, center_y: int, radius: int) -> None:
    points = []
    for index in range(10):
        angle = -math.pi / 2 + index * math.pi / 5
        point_radius = radius if index % 2 == 0 else radius * 0.42
        points.append((center_x + math.cos(angle) * point_radius, center_y + math.sin(angle) * point_radius))
    draw.polygon(points, fill=255)


def _format_due(value: Any) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=MADRID)
    return parsed.astimezone(MADRID).strftime("%d/%m/%Y  %H:%M")


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
    title = str(request["title"]).strip()
    body = str(request.get("body") or "").strip()
    kind = TYPE_LABELS.get(str(request["type"]).lower(), str(request["type"]).upper())
    short_url = str(payload["shortUrl"])
    due = _format_due(request.get("dueAt"))

    title_lines = _wrap(title.upper(), 22)
    body_lines = _wrap(body, 46) if body else []
    content_height = len(title_lines) * 48 + max(55, len(body_lines) * 28)
    due_height = 58 if due else 0
    qr_y = 220 + content_height + due_height
    height = max(700, qr_y + 225)
    canvas = Image.new("L", (WIDTH, height), 255)
    draw = ImageDraw.Draw(canvas)

    micro = _font(15, bold=True)
    draw.text((MARGIN, 23), "PRINTDESK", font=micro, fill=0)
    descriptor = "TICKET TERMICO / 80 MM"
    draw.text((_right_x(draw, descriptor, micro, WIDTH - MARGIN), 23), descriptor, font=micro, fill=0)
    draw.line((MARGIN, 53, WIDTH - MARGIN, 53), fill=0, width=2)

    draw.rectangle((MARGIN, 70, WIDTH - MARGIN, 130), fill=0)
    kind_font = _font(27, bold=True)
    draw.text((MARGIN + 18, 84), kind, font=kind_font, fill=255)
    if request.get("important"):
        _star(draw, WIDTH - MARGIN - 29, 100, 15)

    y = 166
    title_font = _font(39, bold=True)
    for line in title_lines:
        draw.text((_centered_x(draw, line, title_font), y), line, font=title_font, fill=0)
        y += 48

    y += 10
    _dashed_line(draw, y)
    y += 25
    body_font = _font(22)
    if body_lines:
        for line in body_lines:
            draw.text((MARGIN + 8, y), line, font=body_font, fill=0)
            y += 28
    else:
        draw.text((MARGIN + 8, y), "SIN DETALLES ADICIONALES", font=_font(17), fill=0)
        y += 28

    y += 13
    if due:
        _dashed_line(draw, y)
        y += 16
        _calendar_icon(draw, MARGIN + 8, y)
        draw.text((MARGIN + 48, y + 3), due, font=_font(20, bold=True), fill=0)
        y += 41
        _dashed_line(draw, y)

    qr_y = max(y + 38, height - 218)
    qr = qrcode.make(short_url, border=1).convert("L").resize((166, 166), Image.Resampling.NEAREST)
    canvas.paste(qr, (MARGIN, qr_y))

    footer_x = MARGIN + qr.width + 27
    footer_title = _font(23, bold=True)
    draw.text((footer_x, qr_y + 18), "ABRIR", font=footer_title, fill=0)
    draw.text((footer_x, qr_y + 47), "NOTA VIVA", font=footer_title, fill=0)
    draw.line((footer_x, qr_y + 82, WIDTH - MARGIN, qr_y + 82), fill=0, width=2)
    display_url = short_url.removeprefix("https://").removeprefix("http://")
    for index, line in enumerate(_wrap(display_url, 25)[:2]):
        draw.text((footer_x, qr_y + 96 + index * 20), line, font=_font(15), fill=0)

    baseline = height - 28
    draw.line((MARGIN, baseline - 14, WIDTH - MARGIN, baseline - 14), fill=0, width=1)
    draw.text((MARGIN, baseline), "HECHO PARA SALIR DEL RUIDO DIGITAL", font=_font(12, bold=True), fill=0)

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
