import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from printdesk_renderer import render_ticket  # noqa: E402


class RendererTest(unittest.TestCase):
    def test_renders_one_bit_png_and_escpos(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            preview, escpos = render_ticket(
                {
                    "request": {
                        "type": "task",
                        "title": "Llamar a Sanitas",
                        "body": "Preguntar por la analítica",
                    },
                    "shortUrl": "http://localhost:8080/r/abc123",
                },
                Path(directory),
            )
            with Image.open(preview) as image:
                self.assertEqual(image.width, 576)
                self.assertEqual(image.mode, "1")
            data = escpos.read_bytes()
            self.assertTrue(data.startswith(b"\x1b@\x1ba\x01\x1dv0"))
            self.assertTrue(data.endswith(b"\x1dV\x00"))


if __name__ == "__main__":
    unittest.main()
