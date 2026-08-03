"""Recorta os cinco modelos das folhas de expressão e cria pastas transparentes.

Uso:
    python scripts/import-five-base-packs.py "C:\\caminho\\5 modelos.zip"
    python scripts/import-five-base-packs.py "C:\\caminho\\5 modelos.zip" --only-new
"""

from __future__ import annotations

import math
import sys
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = ROOT / "public" / "models" / "modelos"
CANVAS_SIZE = (1920, 1080)

# As folhas sempre seguem: masculino, feminino, masculino, masculino, feminino.
# Cada faixa termina no meio do espaço vazio entre dois modelos.
PACKS = (
    ("masculino", "modelo-2", 0, 456, 252),
    ("feminino", "modelo-2", 456, 842, 645),
    ("masculino", "modelo-3", 842, 1190, 1007),
    ("masculino", "modelo-4", 1190, 1504, 1349),
    ("feminino", "modelo-3", 1504, 1920, 1695),
)

EMOTION_NAMES = {
    "normal": "normal",
    "serio": "serio",
    "bravo": "raiva",
    "tenso": "assustado",
    "corado": "corado",
    "corado 2": "corado_2",
    "corado 3": "corado_3",
    "corado 4": "corado_4",
    "sorrindo de canto": "sorriso_canto",
    "surpreso": "surpreso",
    "surpreso 2": "surpreso_2",
    # A folha Talk recebida veio escrita como "supreso 2".
    "supreso 2": "surpreso_2",
    "tenso 2": "assustado_2",
}


def expression_key(filename: str) -> str:
    stem = Path(filename).stem.lower()
    suffix = ""
    for candidate in (" blink", " talk"):
        if stem.endswith(candidate):
            stem = stem[: -len(candidate)]
            suffix = candidate.replace(" ", "_")
            break
    # Na folha recebida, apenas Corado 3 teve os nomes Blink e Talk invertidos.
    if stem == "corado 3":
        suffix = {"_blink": "_talk", "_talk": "_blink"}.get(suffix, suffix)
    if stem not in EMOTION_NAMES:
        raise ValueError(f"Expressão desconhecida: {filename}")
    return f"{EMOTION_NAMES[stem]}{suffix}"


def remove_chroma(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            distance = math.sqrt(red * red + (green - 195) ** 2 + (blue - 102) ** 2)
            if distance < 34:
                alpha = 0
            elif distance < 92:
                alpha = round(((distance - 34) / 58) * alpha)
            pixels[x, y] = red, green, blue, alpha
    return rgba


def import_packs(zip_path: Path, only_new: bool = False) -> None:
    with ZipFile(zip_path) as archive:
        entries = [entry for entry in archive.infolist() if not entry.is_dir() and entry.filename.lower().endswith(".png")]
        if len(entries) != 36:
            raise ValueError(f"O ZIP deveria conter 36 PNGs, mas contém {len(entries)}")

        written = 0
        for entry in entries:
            key = expression_key(entry.filename)
            if only_new and not key.startswith("surpreso_2"):
                continue
            source = Image.open(BytesIO(archive.read(entry))).convert("RGBA")
            if source.size != CANVAS_SIZE:
                raise ValueError(f"{entry.filename} não está em 1920 × 1080")

            for gender, pack_id, start_x, end_x, content_center_x in PACKS:
                cropped = source.crop((start_x, 0, end_x, source.height))
                transparent = remove_chroma(cropped)
                canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
                destination_x = round(960 - content_center_x + start_x)
                canvas.alpha_composite(transparent, (destination_x, 0))
                destination = OUTPUT_ROOT / gender / pack_id / f"{key}.png"
                destination.parent.mkdir(parents=True, exist_ok=True)
                canvas.save(destination, "PNG", optimize=True)
                written += 1

    print(f"{written} quadros criados em {OUTPUT_ROOT}")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or len(sys.argv) == 3 and sys.argv[2] != "--only-new":
        raise SystemExit("Informe o caminho do arquivo 5 modelos.zip e, opcionalmente, --only-new")
    import_packs(Path(sys.argv[1]).resolve(), only_new="--only-new" in sys.argv[2:])
