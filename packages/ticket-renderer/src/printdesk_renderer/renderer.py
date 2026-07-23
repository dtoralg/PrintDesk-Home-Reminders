from __future__ import annotations

import argparse
import json
import math
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import qrcode
from PIL import Image, ImageDraw, ImageFont, ImageOps

WIDTH = 576
MARGIN = 30
CONTENT_WIDTH = WIDTH - MARGIN * 2
MADRID = ZoneInfo("Europe/Madrid")
FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts"
TYPE_LABELS = {
    "task": "TASK",
    "idea": "IDEA",
    "reminder": "RECORDATORIO",
    "note": "NOTA",
}


def _font(size: int, semibold: bool = False) -> ImageFont.FreeTypeFont:
    filename = "Poppins-SemiBold.ttf" if semibold else "Poppins-Regular.ttf"
    path = FONT_DIR / filename
    if not path.is_file():
        raise FileNotFoundError(f"Bundled ticket font not found: {path}")
    return ImageFont.truetype(str(path), size=size)


def _text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> float:
    return draw.textlength(text, font=font)


def _break_word(draw: ImageDraw.ImageDraw, word: str, font: ImageFont.ImageFont, max_width: int) -> list[str]:
    pieces: list[str] = []
    current = ""
    for character in word:
        candidate = current + character
        if current and _text_width(draw, candidate, font) > max_width:
            pieces.append(current)
            current = character
        else:
            current = candidate
    if current:
        pieces.append(current)
    return pieces


def _wrap_pixels(
    draw: ImageDraw.ImageDraw,
    text: str,
    font: ImageFont.ImageFont,
    max_width: int,
) -> list[str]:
    lines: list[str] = []
    for paragraph in text.splitlines() or [""]:
        words = paragraph.split()
        if not words:
            lines.append("")
            continue
        current = ""
        for word in words:
            if _text_width(draw, word, font) > max_width:
                if current:
                    lines.append(current)
                    current = ""
                pieces = _break_word(draw, word, font, max_width)
                lines.extend(pieces[:-1])
                current = pieces[-1]
                continue
            candidate = f"{current} {word}".strip()
            if current and _text_width(draw, candidate, font) > max_width:
                lines.append(current)
                current = word
            else:
                current = candidate
        if current:
            lines.append(current)
    return lines


def _centered_x(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont) -> float:
    return (WIDTH - _text_width(draw, text, font)) / 2


def _dotted_line(draw: ImageDraw.ImageDraw, y: int, start: int = MARGIN, end: int = WIDTH - MARGIN) -> None:
    for x in range(start, end, 12):
        draw.ellipse((x, y, x + 3, y + 3), fill=0)


def _calendar_icon(draw: ImageDraw.ImageDraw, x: int, y: int, size: int = 27) -> None:
    draw.rounded_rectangle((x, y + 4, x + size, y + size), radius=2, outline=0, width=2)
    draw.line((x, y + 11, x + size, y + 11), fill=0, width=2)
    draw.line((x + 7, y, x + 7, y + 8), fill=0, width=3)
    draw.line((x + size - 7, y, x + size - 7, y + 8), fill=0, width=3)


def _person_icon(draw: ImageDraw.ImageDraw, x: int, y: int) -> None:
    draw.ellipse((x + 8, y, x + 22, y + 14), outline=0, width=2)
    draw.arc((x, y + 12, x + 30, y + 39), 180, 360, fill=0, width=2)
    draw.line((x, y + 26, x, y + 34), fill=0, width=2)
    draw.line((x + 30, y + 26, x + 30, y + 34), fill=0, width=2)


def _star(draw: ImageDraw.ImageDraw, center_x: int, center_y: int, radius: int, fill: int = 0) -> None:
    points = []
    for index in range(10):
        angle = -math.pi / 2 + index * math.pi / 5
        point_radius = radius if index % 2 == 0 else radius * 0.43
        points.append((center_x + math.cos(angle) * point_radius, center_y + math.sin(angle) * point_radius))
    draw.polygon(points, fill=fill)


def _type_icon(draw: ImageDraw.ImageDraw, kind: str, x: int, y: int) -> None:
    if kind == "task":
        draw.line((x + 2, y + 14, x + 10, y + 23, x + 28, y + 3), fill=0, width=5, joint="curve")
    elif kind == "idea":
        draw.ellipse((x + 4, y, x + 27, y + 24), outline=0, width=3)
        draw.line((x + 10, y + 25, x + 22, y + 25), fill=0, width=3)
        draw.line((x + 12, y + 30, x + 20, y + 30), fill=0, width=3)
    elif kind == "reminder":
        draw.ellipse((x + 2, y + 1, x + 29, y + 28), outline=0, width=3)
        draw.line((x + 16, y + 14, x + 16, y + 6), fill=0, width=3)
        draw.line((x + 16, y + 14, x + 23, y + 18), fill=0, width=3)
    else:
        draw.rectangle((x + 5, y, x + 27, y + 30), outline=0, width=3)
        draw.line((x + 10, y + 9, x + 22, y + 9), fill=0, width=2)
        draw.line((x + 10, y + 16, x + 22, y + 16), fill=0, width=2)
        draw.line((x + 10, y + 23, x + 20, y + 23), fill=0, width=2)


def _top_ornament(draw: ImageDraw.ImageDraw, y: int) -> None:
    centers = list(range(MARGIN + 12, WIDTH - MARGIN - 8, 32))
    for index, x in enumerate(centers):
        if index % 3 == 0:
            draw.line((x - 7, y, x + 7, y), fill=0, width=3)
            draw.line((x, y - 7, x, y + 7), fill=0, width=3)
        elif index % 3 == 1:
            draw.polygon(((x, y - 7), (x + 7, y), (x, y + 7), (x - 7, y)), outline=0)
            draw.ellipse((x - 2, y - 2, x + 2, y + 2), fill=0)
        else:
            draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=0)


def _format_date(value: Any) -> str | None:
    if not value:
        return None
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=MADRID)
    return parsed.astimezone(MADRID).strftime("%d/%m/%Y")


def _format_due(value: Any) -> str | None:
    return _format_date(value)


def _qr_image(value: str) -> Image.Image:
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=4, border=1)
    qr.add_data(value)
    qr.make(fit=True)
    return qr.make_image(fill_color="black", back_color="white").convert("L")


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
    kind_key = str(request["type"]).lower()
    kind = TYPE_LABELS.get(kind_key, kind_key.upper())
    due = _format_due(request.get("dueAt"))
    created_at = _format_date(payload.get("createdAt")) or datetime.now(MADRID).strftime("%d/%m/%Y")
    created_by = payload.get("createdBy") or {}
    creator = str(created_by.get("displayName") or created_by.get("email") or "PrintDesk").strip().split()[0]
    short_url = str(payload["shortUrl"])

    measuring_canvas = Image.new("L", (WIDTH, 100), 255)
    measuring_draw = ImageDraw.Draw(measuring_canvas)
    kind_font = _font(30, semibold=True)
    title_font = _font(40, semibold=True)
    body_font = _font(27)
    footer_font = _font(22)
    date_font = _font(21, semibold=True)
    title_lines = _wrap_pixels(measuring_draw, title.upper(), title_font, CONTENT_WIDTH - 24)
    body_lines = _wrap_pixels(measuring_draw, body, body_font, CONTENT_WIDTH - 20) if body else []
    qr = _qr_image(short_url)

    header_y = 58
    header_height = 76
    divider_y = header_y + header_height + 17
    title_y = divider_y + 23
    title_line_height = 51
    y = title_y + len(title_lines) * title_line_height
    if body_lines:
        y += 10 + len(body_lines) * 36
    content_divider_y = y + 15
    y = content_divider_y + 5
    if due:
        due_y = y + 16
        due_divider_y = due_y + 42
        y = due_divider_y + 5
    else:
        due_y = None
        due_divider_y = None
    footer_y = y + 20
    qr_frame_size = qr.width + 12
    footer_height = max(qr_frame_size, 94)
    bottom_ornament_y = footer_y + footer_height + 19
    height = bottom_ornament_y + 28

    canvas = Image.new("L", (WIDTH, height), 255)
    draw = ImageDraw.Draw(canvas)
    _top_ornament(draw, 27)

    left = MARGIN
    right = WIDTH - MARGIN
    clip = 13
    header_points = (
        (left + clip, header_y),
        (right - clip, header_y),
        (right, header_y + clip),
        (right, header_y + header_height - clip),
        (right - clip, header_y + header_height),
        (left + clip, header_y + header_height),
        (left, header_y + header_height - clip),
        (left, header_y + clip),
    )
    draw.polygon(header_points, outline=0, width=3)
    badge_x = left + 16
    badge_y = header_y + 12
    draw.polygon(
        (
            (badge_x + 12, badge_y),
            (badge_x + 49, badge_y),
            (badge_x + 61, badge_y + 12),
            (badge_x + 61, badge_y + 40),
            (badge_x + 49, badge_y + 52),
            (badge_x + 12, badge_y + 52),
            (badge_x, badge_y + 40),
            (badge_x, badge_y + 12),
        ),
        outline=0,
        width=3,
    )
    _type_icon(draw, kind_key, badge_x + 15, badge_y + 11)
    draw.text((badge_x + 82, header_y + 18), kind, font=kind_font, fill=0)
    if request.get("important"):
        _star(draw, right - 31, header_y + header_height // 2, 16)

    _dotted_line(draw, divider_y)
    current_y = title_y
    for line in title_lines:
        draw.text((_centered_x(draw, line, title_font), current_y), line, font=title_font, fill=0)
        current_y += title_line_height

    if body_lines:
        current_y += 10
        for line in body_lines:
            draw.text((MARGIN + 10, current_y), line, font=body_font, fill=0)
            current_y += 36

    _dotted_line(draw, content_divider_y)
    if due and due_y is not None and due_divider_y is not None:
        _calendar_icon(draw, MARGIN + 10, due_y - 2, size=28)
        draw.text((MARGIN + 55, due_y), due, font=date_font, fill=0)
        _dotted_line(draw, due_divider_y)

    person_y = footer_y + 7
    _person_icon(draw, MARGIN + 10, person_y)
    draw.text((MARGIN + 56, person_y + 5), creator, font=footer_font, fill=0)
    calendar_y = person_y + 51
    _calendar_icon(draw, MARGIN + 11, calendar_y, size=25)
    draw.text((MARGIN + 56, calendar_y + 3), created_at, font=footer_font, fill=0)

    qr_x = WIDTH - MARGIN - qr_frame_size
    draw.rectangle((qr_x, footer_y, qr_x + qr_frame_size, footer_y + qr_frame_size), outline=0, width=2)
    canvas.paste(qr, (qr_x + 6, footer_y + 6))
    _top_ornament(draw, bottom_ornament_y)

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
