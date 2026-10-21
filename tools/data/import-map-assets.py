"""Import complete final-stage map geometry and development reference atlases.

Does not import routing rules: normal_routes remains the source of navigation.
Only fetches data/image files from the map-data maintainer's public repository.
"""
import concurrent.futures
import argparse
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
COMMIT = '796a7564eac5de79d32ae0e086a673052ee65ad0'
BASE = f'https://raw.githubusercontent.com/KagamiChan/kcs2-mapdata/{COMMIT}/'
DEST = ROOT / 'data/sortie/maps'


def fetch(name):
    with urllib.request.urlopen(BASE + name, timeout=30) as response:
        return response.read()


def collect_phases(area, annotation, load=fetch):
    """Later game files are deltas; keep every layer through the final spot."""
    world, number = map(int, area.split('-'))
    prefix = f'maps/{world:03}/{number:02}'
    expected = {int(no) for no in annotation['route']}
    seen, stages, suffix = set(), [], ''
    while True:
        info_data = load(prefix + '_info' + suffix + '.json')
        frame_data = load(prefix + '_image' + suffix + '.json')
        image_data = load(prefix + '_image' + suffix + '.png')
        if not image_data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError(f'{area}: not a PNG')
        info, atlas = json.loads(info_data), json.loads(frame_data)
        numbers = {spot['no'] for spot in info['spots']}
        if not numbers or numbers & seen or not numbers <= expected:
            raise ValueError(f'{area}: unexpected/repeated stage spots')
        seen.update(numbers)
        stages.append(dict(info=info, atlas=atlas, image=image_data,
                           files=[dict(url=BASE + prefix + kind + suffix + ext,
                                       sha256=hashlib.sha256(raw).hexdigest())
                                  for kind, ext, raw in [('_info', '.json', info_data),
                                                         ('_image', '.json', frame_data), ('_image', '.png', image_data)]]))
        if seen == expected:
            return stages
        suffix = str(max(seen) + 1)
        if len(stages) >= 10:
            raise ValueError(f'{area}: incomplete final-stage map')


def main(areas=None, reference_dir=None):
    references = Path(reference_dir or os.environ.get('FLEET_ADVISOR_MAP_REFERENCES')
                      or ROOT.parent / 'map-references/fleet-advisor').expanduser().resolve()
    if references.is_relative_to(ROOT):
        raise ValueError('Map reference directory must be outside the project')
    references.mkdir(parents=True, exist_ok=True)
    DEST.mkdir(parents=True, exist_ok=True)
    source = fetch('data/final.json')
    annotated = json.loads(source)
    maps = sorted(p.stem for p in (ROOT / 'data/normal_routes').glob('?-?.json'))
    if areas:
        if set(areas) - set(maps):
            raise ValueError('Unknown normal map')
        maps = sorted(set(areas))
    current = json.loads((DEST / 'index.json').read_text(encoding='utf8')) if (DEST / 'index.json').exists() else {'maps': {}}

    def one(area):
        retained = current['maps'].get(area, {})
        if retained.get('source', {}).get('kind') == 'gamePhasedAtlas':
            image = references / retained['image']
            if image.exists() and hashlib.sha256(image.read_bytes()).hexdigest() != retained.get('imageEncoding', {}).get('sha256', retained['source']['sha256']):
                raise ValueError(f'{area}: retained phased atlas checksum mismatch')
            return area, retained
        world, number = map(int, area.split('-'))
        prefix = f'maps/{world:03}/{number:02}'
        stages = collect_phases(area, annotated[area])
        frames, source_spots, resources, height, width = {}, [], [], 0, 0
        for stage in stages:
            sprite_width, sprite_height = struct.unpack('>II', stage['image'][16:24])
            frames.update(copy.deepcopy(stage['atlas']['frames']))
            for name in stage['atlas']['frames']:
                frames[name]['frame']['y'] += height
            source_spots.extend(stage['info']['spots'])
            image_source = stage['files'][2]
            resources.append(dict(path='/kcs2/resources/map/' + image_source['url'].split('/maps/')[1],
                                  sha256=image_source['sha256'],width=sprite_width,height=sprite_height,
                                  offsetY=height,fallbackUrl=image_source['url']))
            height += sprite_height
            width = max(width, sprite_width)
        info = stages[0]['info']

        def frame_for(suffix):
            matches = [v for k, v in frames.items() if k.endswith('_' + suffix)]
            if len(matches) != 1 or matches[0].get('rotated'):
                raise ValueError(f'{area}: ambiguous/rotated frame {suffix}')
            return matches[0]

        layers = [frame_for(name) for name in info['bg']]
        background = layers[0]['sourceSize']
        spots = annotated[area]['spots']
        starts = [name for name, point in spots.items() if point[2] == 'start']
        source_routes = annotated[area]['route']
        lines = {}
        for spot in source_spots:
            if not spot.get('line'):
                continue
            pair = source_routes.get(str(spot['no']))
            if not pair or pair[0] is None:
                continue
            frame = frame_for(spot['line'].get('img', f'route_{spot["no"]}'))
            lines['>'.join(pair)] = {'x': spot['x'] + spot['line']['x'],
                                    'y': spot['y'] + spot['line']['y'], 'sprite': frame}
        graph = json.loads((ROOT / f'data/normal_routes/{area}.json').read_text(encoding='utf8'))
        nodes = set(graph.get('bossNodes', []) + graph.get('terminalNodes', []))
        edges = set()
        for key, to in graph.get('fixedEdges', {}).items():
            edges.add((key.split('#')[0], to))
        for branch in graph.get('branchPoints', []):
            edges.update((branch['from'], to) for to in branch['destinations'])
        for a, b in edges:
            nodes.update([a, b])
        missing = sorted(nodes - {'start'} - set(spots))
        missing_lines = []
        for a, b in edges:
            matches = [f'{s}>{b}' for s in starts] if a == 'start' else [f'{a}>{b}']
            if not any(key in lines for key in matches):
                missing_lines.append(f'{a}>{b}')
        if len(stages) == 1:
            image_data = stages[0]['image']
        else:
            packed = Image.new('RGBA', (width, height))
            for stage, resource in zip(stages, resources):
                with Image.open(io.BytesIO(stage['image'])) as image:
                    packed.paste(image.convert('RGBA'), (0, resource['offsetY']))
            output = io.BytesIO()
            packed.save(output, format='PNG')
            image_data = output.getvalue()
        (references / f'{area}.png').write_bytes(image_data)
        return area, {'image': f'{area}.png', 'width': background['w'], 'height': background['h'],
                      'spriteWidth': width, 'spriteHeight': height,
                      'backgrounds': layers, 'spots': spots, 'starts': starts, 'lines': lines,
                      'resources': resources,
                      'missingCoordinates': missing, 'missingLineSprites': sorted(missing_lines),
                      'source': {'url': BASE + prefix + '_image.png' if len(stages)==1 else 'https://github.com/KagamiChan/kcs2-mapdata',
                                 'infoUrl': BASE + prefix + '_info.json',
                                 'sha256': hashlib.sha256(image_data).hexdigest(),
                                 'infoSha256': stages[0]['files'][0]['sha256'],
                                 'atlasSha256': stages[0]['files'][1]['sha256'],
                                 **({'packing':'lossless vertical atlas; source frame positions offset only',
                                     'assets':[asset for stage in stages for asset in stage['files']]} if len(stages)>1 else {})}}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        rows = {**current['maps'], **dict(executor.map(one, maps))}
    manifest = {'schemaVersion': 1, 'source': {'repository': 'https://github.com/KagamiChan/kcs2-mapdata',
                 'commit': COMMIT, 'annotationsSha256': hashlib.sha256(source).hexdigest()}, 'maps': rows}
    (DEST / 'index.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    (DEST / 'SOURCE_LICENSE').write_bytes(fetch('LICENSE'))
    generated = [area for area in maps if rows[area]['source'].get('kind') != 'gamePhasedAtlas']
    command = [sys.executable, str(ROOT / 'tools/data/optimize-map-assets.py')]
    if generated:
        command += ['--reference-dir', str(references), '--areas', *generated]
    subprocess.run(command, check=True)
    rows = json.loads((DEST / 'index.json').read_text(encoding='utf8'))['maps']
    print(json.dumps({'maps': len(rows), 'missingCoordinates': {a: r['missingCoordinates'] for a, r in rows.items()
           if r['missingCoordinates']}, 'missingLineSprites': {a: r['missingLineSprites'] for a, r in rows.items()
           if r['missingLineSprites']}, 'referenceDirectory': str(references),
           'referenceBytes': sum(r['imageEncoding']['bytes'] for r in rows.values())}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('areas', nargs='*', help='Optional subset, such as 7-2 7-3 7-5')
    parser.add_argument('--reference-dir', help='External directory for generated development atlases')
    args = parser.parse_args()
    main(args.areas, args.reference_dir)
