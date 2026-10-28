"""Extract only the normal-slot detach icon mask from an external game atlas.
Usage: python tools/vision/build-equipment-remove.py <remodel_main.png> <remodel_main.json>
"""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[2]
png, metadata = map(Path, sys.argv[1:3])
atlas = Image.open(png).convert('RGBA')
frame = json.loads(metadata.read_text(encoding='utf-8'))['frames']['remodel_main_56']['frame']
icon = atlas.crop((frame['x'], frame['y'], frame['x'] + frame['w'], frame['y'] + frame['h']))
target = root / 'data/equip_clear_all.json'
data = json.loads(target.read_text(encoding='utf-8'))
data['normalRemove'] = {'size': list(icon.size), 'mask': [
    ''.join('1' if icon.getpixel((x, y))[3] >= 128 else '0' for x in range(icon.width))
    for y in range(icon.height)], 'source': {
    'url': 'https://w16s.kancolle-server.com/kcs2/img/remodel/remodel_main.png',
    'sha256': hashlib.sha256(png.read_bytes()).hexdigest(), 'frame': 'remodel_main_56',
    'rights': 'KanColle game artwork; recognition mask only'}}
target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
