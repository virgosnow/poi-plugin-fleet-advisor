"""Optimize map PNGs and retain the two used common sprites at original size.

Development only: requires Pillow; this tool adds no plugin dependency.
Original source hashes stay unchanged. Map pixels and used symbol pixels are
verified exactly; the unused common-atlas sprites are excluded from runtime.
"""
import argparse
import concurrent.futures
import hashlib
import io
import json
import os
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'data/sortie/maps'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encode_exact(image):
    rgba = image.convert('RGBA')
    pixels = rgba.tobytes()
    output = io.BytesIO()
    rgba.save(output, format='PNG', optimize=True, compress_level=9)
    encoded = output.getvalue()
    with Image.open(io.BytesIO(encoded)) as decoded:
        if decoded.size != rgba.size or decoded.convert('RGBA').tobytes() != pixels:
            raise ValueError('Lossless encoder changed RGBA pixels')
    return encoded, sha(pixels)


def verify(data, encoding, size):
    if sha(data) != encoding['sha256']:
        raise ValueError('Encoded image hash mismatch')
    with Image.open(io.BytesIO(data)) as image:
        if image.size != tuple(size) or sha(image.convert('RGBA').tobytes()) != encoding['rgbaSha256']:
            raise ValueError('Decoded RGBA identity mismatch')


def retain_symbols(image, atlas, names):
    image = image.convert('RGBA')
    if any(atlas['frames'][name].get('rotated') for name in names):
        raise ValueError('Rotated symbol is not supported')
    frames = {name: atlas['frames'][name]['frame'] for name in names}
    pad = 2  # Preserve source neighbours too, for identical edge interpolation.
    # Keep original coordinates and canvas size: changing texture coordinates
    # can alter browser interpolation by one channel at fractional scales.
    packed = Image.new('RGBA', image.size)
    runtime = dict(size=dict(w=packed.width, h=packed.height), frames={}, frameRgbaSha256={},
                   originalRgbaSha256=sha(image.tobytes()))
    for name, f in frames.items():
        if f['x'] < pad or f['y'] < pad or f['x']+f['w']+pad > image.width or f['y']+f['h']+pad > image.height:
            raise ValueError('Source symbol has no interpolation padding')
        tile = image.crop((f['x']-pad, f['y']-pad, f['x']+f['w']+pad, f['y']+f['h']+pad))
        packed.paste(tile, (f['x']-pad, f['y']-pad))
        runtime['frames'][name] = dict(f)
        original = image.crop((f['x'], f['y'], f['x']+f['w'], f['y']+f['h']))
        runtime['frameRgbaSha256'][name] = sha(original.tobytes())
        if packed.crop((f['x'], f['y'], f['x']+f['w'], f['y']+f['h'])).tobytes() != original.tobytes():
            raise ValueError('Symbol optimization changed source pixels')
    return packed, runtime


def verify_symbols(data, runtime):
    with Image.open(io.BytesIO(data)) as image:
        image = image.convert('RGBA')
        for name, f in runtime['frames'].items():
            pixels = image.crop((f['x'], f['y'], f['x']+f['w'], f['y']+f['h'])).tobytes()
            if sha(pixels) != runtime['frameRgbaSha256'][name]:
                raise ValueError('Original symbol pixel hash mismatch')


def main(check=False, reference_dir=None, areas=None):
    manifest_path = ASSETS / 'index.json'
    common_path = ASSETS / 'map_common.source.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    common = json.loads(common_path.read_text(encoding='utf-8'))
    common_atlas = json.loads((ASSETS / 'map_common.json').read_text(encoding='utf-8'))
    reference_dir = reference_dir or os.environ.get('FLEET_ADVISOR_MAP_REFERENCES')
    references = Path(reference_dir).expanduser().resolve() if reference_dir else None
    if references and references.is_relative_to(ROOT):
        raise ValueError('Map reference directory must be outside the project')
    if areas and not references:
        raise ValueError('--areas requires an external reference directory')
    selected = manifest['maps'] if areas is None else {area: manifest['maps'][area] for area in areas}
    entries = [(row, row['source']['sha256'], [row['spriteWidth'], row['spriteHeight']], references)
               for row in selected.values()] if references else []
    common_size = common.get('runtimeAtlas', common_atlas['meta'])['size']
    entries.append((common, common['imageSha256'], [common_size[k] for k in ['w', 'h']], ASSETS))

    def prepare(entry):
        row, source_hash, size, directory = entry
        filename = row.get('image', 'map_common.png')
        file = (directory / filename).resolve()
        if file.parent != directory.resolve():
            raise ValueError('Map path escapes asset directory')
        data = file.read_bytes()
        encoding = row.get('imageEncoding')
        if encoding:
            verify(data, encoding, size)
            if row is not common or row.get('runtimeAtlas'):
                if row is common:
                    verify_symbols(data, row['runtimeAtlas'])
                return row, file, data, None
        if check:
            raise ValueError(f'{filename}: missing lossless encoding record')
        if not encoding and sha(data) != source_hash:
            raise ValueError(f'{filename}: original source hash mismatch')
        with Image.open(io.BytesIO(data)) as image:
            if image.size != tuple(size):
                raise ValueError(f'{filename}: atlas dimensions changed')
            if row is common:
                image, row['runtimeAtlas'] = retain_symbols(image, common_atlas, [common['bossFrame'], common['startFrame']])
                size = [image.width, image.height]
            encoded, rgba_hash = encode_exact(image)
        if len(encoded) >= len(data):
            raise ValueError(f'{filename}: optimized PNG is not smaller; retain the original and review')
        encoding = dict(format='png-lossless', exact=True, sha256=sha(encoded),
                        rgbaSha256=rgba_hash, sourceFile=filename,
                        sourceBytes=encoding['sourceBytes'] if encoding else len(data), bytes=len(encoded))
        verify(encoded, encoding, size)
        if row is common:
            verify_symbols(encoded, row['runtimeAtlas'])
        return row, file, encoded, encoding

    # Complete and validate every candidate before replacing any source file.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        prepared = list(pool.map(prepare, entries))
    if not check:
        for row, original, encoded, encoding in prepared:
            if not encoding:
                continue
            target = original
            target.write_bytes(encoded)
            row['image'], row['imageEncoding'] = target.name, encoding
        for file, value in [(manifest_path, manifest), (common_path, common)]:
            file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    records = [row['imageEncoding'] for row, *_ in prepared]
    before, after = sum(r['sourceBytes'] for r in records), sum(r['bytes'] for r in records)
    print(json.dumps(dict(images=len(records), before=before, after=after,
                          saved=before-after, savedPercent=round(100*(1-after/before), 2),
                          pixelExact=True, checkOnly=check)))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Check file and RGBA hashes without writing')
    parser.add_argument('--reference-dir', help='External development atlas directory; otherwise check runtime symbols only')
    parser.add_argument('--areas', nargs='+', help='Only process these external reference maps')
    args = parser.parse_args()
    main(args.check, args.reference_dir, args.areas)
