"""Build compact return-button templates from an external original port skin.

Usage: python tools/vision/build-port-return.py <port_skin_1.png> <port_skin_1.json>
The input atlas stays outside the repository; this tool never downloads assets.
"""
import hashlib
import math
import json
import sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
png, metadata = map(Path, sys.argv[1:3])
atlas = Image.open(png).convert('RGB')
frames = json.loads(metadata.read_text(encoding='utf-8'))['frames']
f = frames['port_skin_1_3']['frame']
sprite = atlas.crop((f['x'], f['y'], f['x'] + f['w'], f['y'] + f['h']))
# The only text template is a negative: exclude the home hide-UI circle.
# Returning itself uses the stationary border, not a title or rotation angle.
radii, angles, rgb = [12, 20, 28, 36, 44, 52], 120, []
for radius in radii:
    for angle in range(angles):
        theta = angle * math.tau / angles
        x, y = math.floor(92 + radius * math.cos(theta) + .5), math.floor(91.5 + radius * math.sin(theta) + .5)
        pixels = [sprite.getpixel((x + dx, y + dy)) for dx in [-1, 0, 1] for dy in [-1, 0, 1]]
        rgb.extend(round(sum(p[k] for p in pixels) / 9) for k in range(3))
data = {'source': {
    'url': 'https://w16s.kancolle-server.com/kcs2/img/port/port_skin_1.png?version=6.1.0.4',
    'sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
    'rights': 'KanColle game artwork; recognition samples only'},
    'homeExclusion': {'radii': radii, 'angles': angles, 'rgb': rgb}}
(root / 'data/port_return_button.json').write_text(
    json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
