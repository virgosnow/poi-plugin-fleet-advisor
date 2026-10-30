"""Generate the padded, edge-adjusted Boss marker from the original atlas.

Development only: requires Pillow. The original RGB pixels remain unchanged;
only alpha is tightened to reduce the transparent fringe at small sizes.
"""
import hashlib
import json
from pathlib import Path

from PIL import Image

ASSETS = Path(__file__).resolve().parents[2] / 'data/sortie/maps'
source = json.loads((ASSETS / 'map_common.source.json').read_text(encoding='utf-8'))
atlas_path = ASSETS / source['image']
if hashlib.sha256(atlas_path.read_bytes()).hexdigest() != source['imageEncoding']['sha256']:
    raise ValueError('Unexpected map_common.png; check the source manifest')
frame = source['runtimeAtlas']['frames'][source['bossFrame']]
x, y, w, h = (frame[k] for k in ('x', 'y', 'w', 'h'))
with Image.open(atlas_path) as atlas:
    marker = atlas.convert('RGBA').crop((x, y, x + w, y + h))
marker.putalpha(marker.getchannel('A').point(lambda a: max(0, min(255, round((a - 72) * 255 / 112)))))
output = Image.new('RGBA', (w + 4, h + 4))
output.paste(marker, (2, 2))
output.save(ASSETS / 'boss_marker.png', optimize=True)
