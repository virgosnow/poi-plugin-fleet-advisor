"""Extract the picker detach-button references from an external game atlas.
Usage: python tools/vision/build-organization-detach.py <organize_filter.png> <organize_filter.json>
"""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
png, metadata = map(Path, sys.argv[1:3])
atlas = Image.open(png).convert('RGBA')
frames = json.loads(metadata.read_text(encoding='utf-8'))['frames']
references = []
background = frames['organize_filter_6']['frame']
paper = atlas.crop((background['x'] + 594, background['y'] + 522,
                    background['x'] + 672, background['y'] + 558))
for name in ['organize_filter_48', 'organize_filter_49']:
    frame = frames[name]['frame']
    sprite = atlas.crop((frame['x'], frame['y'], frame['x'] + 78, frame['y'] + 36))
    icon = Image.alpha_composite(paper, sprite).crop((4, 4, 74, 32))
    tile = icon.resize((35, 14), Image.Resampling.BOX).convert('RGB')
    references.append(list(tile.tobytes()))
target = root / 'data/org_clear_escorts.json'
data = json.loads(target.read_text(encoding='utf-8'))
data['detach'] = {'box': [1126, 664, 1196, 692], 'size': [35, 14], 'rgb': references,
                  'source': {'url': 'https://w16s.kancolle-server.com/kcs2/img/organize/organize_filter.png',
                             'sha256': hashlib.sha256(png.read_bytes()).hexdigest(),
                             'frames': ['organize_filter_6', 'organize_filter_48', 'organize_filter_49'],
                             'rights': 'KanColle game artwork; recognition reference only'}}
target.write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
