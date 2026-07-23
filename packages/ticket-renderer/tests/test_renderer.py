import json
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from printdesk_renderer import render_ticket  # noqa: E402
from printdesk_renderer.renderer import _font, _format_due  # noqa: E402


def payload(body: str, due_at: str | None = None) -> dict:
    return {
        "request": {
            "type": "task",
            "title": "Llamar a Sanitas",
            "body": body,
            "important": True,
            "dueAt": due_at,
        },
        "shortUrl": "https://printdesk.example/r/abc123",
        "createdBy": {
            "uid": "user-1",
            "displayName": "Dani Loral",
            "email": "dani@example.com",
        },
        "createdAt": "2026-07-23T16:00:00.000Z",
    }


class RendererTest(unittest.TestCase):
    def test_formats_due_date_without_time(self) -> None:
        self.assertEqual(_format_due("2026-07-24T08:30:00.000Z"), "24/07/2026")
        self.assertIsNone(_format_due(None))

    def test_bundled_fonts_contain_spanish_glyphs(self) -> None:
        for semibold in (False, True):
            font = _font(28, semibold=semibold)
            for character in "áéíóúüñÁÉÍÓÚÜÑ¿¡":
                self.assertIsNotNone(font.getmask(character).getbbox(), f"Missing glyph: {character}")

    def test_renders_utf8_json_with_spanish_accents(self) -> None:
        fixture = Path(__file__).parent / "fixtures" / "spanish-accents-ticket.json"
        source = fixture.read_text(encoding="utf-8")
        self.assertIn("Revisión del pingüino", source)
        self.assertIn("¿Está todo bien? ¡Sí!", source)

        with tempfile.TemporaryDirectory() as directory:
            preview, escpos = render_ticket(json.loads(source), Path(directory))
            with Image.open(preview) as image:
                self.assertEqual(image.mode, "1")
                self.assertGreater(image.height, 0)
            self.assertGreater(escpos.stat().st_size, 0)

    def test_height_tracks_content_and_optional_date(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            short_path, _ = render_ticket(payload("Póliza y conexión correctas."), root / "short")
            dated_path, _ = render_ticket(
                payload("Póliza y conexión correctas.", "2026-07-24T08:30:00.000Z"),
                root / "dated",
            )
            long_path, _ = render_ticket(
                payload(
                    "Preguntar por la analítica completa, las autorizaciones y la cobertura dental. "
                    "Confirmar también qué documentación necesita el niño para la próxima revisión."
                ),
                root / "long",
            )
            with Image.open(short_path) as short, Image.open(dated_path) as dated, Image.open(long_path) as long:
                self.assertLess(short.height, dated.height)
                self.assertLess(short.height, long.height)
                self.assertGreaterEqual(dated.height - short.height, 55)
                self.assertGreaterEqual(long.height - short.height, 60)

    def test_renders_one_bit_576px_png_and_matching_escpos(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            preview, escpos = render_ticket(
                payload(
                    "Preguntar por la analítica, la póliza, la conexión, el pingüino y el niño. "
                    "¿Está todo bien? ¡Sí!"
                ),
                Path(directory),
            )
            with Image.open(preview) as image:
                expected_height = image.height
                self.assertEqual(image.width, 576)
                self.assertEqual(image.mode, "1")
            data = escpos.read_bytes()
            self.assertTrue(data.startswith(b"\x1b@\x1ba\x01\x1dv0"))
            self.assertTrue(data.endswith(b"\x1dV\x00"))
            self.assertEqual(int.from_bytes(data[9:11], "little"), 72)
            self.assertEqual(int.from_bytes(data[11:13], "little"), expected_height)


if __name__ == "__main__":
    unittest.main()
