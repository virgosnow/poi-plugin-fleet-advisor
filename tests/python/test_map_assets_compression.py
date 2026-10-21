"""Offline image build checks; Pillow is needed only for asset development."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import unittest
import tempfile
from unittest import mock

try:
    from PIL import Image
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False


@unittest.skipUnless(HAS_PILLOW, 'Asset checks require Pillow')
class MapCompressionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        file = Path(__file__).resolve().parents[2] / 'tools/data/optimize-map-assets.py'
        spec = importlib.util.spec_from_file_location('map_compression', file)
        cls.codec = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.codec)

    def test_lossless_encoding_preserves_transparent_rgb_and_partial_alpha(self):
        image = Image.new('RGBA', (3, 2))
        image.putdata([(255, 1, 2, 0), (3, 254, 5, 1), (6, 7, 253, 128),
                       (9, 10, 11, 254), (12, 13, 14, 255), (15, 16, 17, 0)])
        data, digest = self.codec.encode_exact(image)
        self.assertEqual(digest, hashlib.sha256(image.tobytes()).hexdigest())
        record = dict(sha256=hashlib.sha256(data).hexdigest(), rgbaSha256=digest)
        self.codec.verify(data, record, image.size)
        with Image.open(io.BytesIO(data)) as decoded:
            self.assertEqual(decoded.convert('RGBA').tobytes(), image.tobytes())
        with self.assertRaisesRegex(ValueError, 'RGBA identity'):
            self.codec.verify(data, record, (2, 3))
        with self.assertRaisesRegex(ValueError, 'hash mismatch'):
            self.codec.verify(data+b'tampered', record, image.size)

    def test_shipped_common_symbols_match_their_original_rgba_hashes_without_references(self):
        output = io.StringIO()
        with mock.patch.dict(self.codec.os.environ), contextlib.redirect_stdout(output):
            self.codec.os.environ.pop('FLEET_ADVISOR_MAP_REFERENCES', None)
            self.codec.main(check=True)
        report = json.loads(output.getvalue())
        self.assertEqual(report['images'], 1)
        self.assertTrue(report['pixelExact'])
        self.assertTrue(report['checkOnly'])
        self.assertLess(report['after'], report['before'])

    def test_external_references_are_optional_but_explicit_checks_reject_missing_or_corrupt_images(self):
        original = self.codec.ASSETS
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets, references = root / 'runtime', root / 'references'
            assets.mkdir()
            references.mkdir()
            for name in ['map_common.source.json', 'map_common.json', 'map_common.png']:
                (assets / name).write_bytes((original / name).read_bytes())
            data, digest = self.codec.encode_exact(Image.new('RGBA', (3, 2), (10, 20, 30, 100)))
            row = dict(image='1-1.png', spriteWidth=3, spriteHeight=2,
                       source=dict(sha256=hashlib.sha256(data).hexdigest()),
                       imageEncoding=dict(sha256=hashlib.sha256(data).hexdigest(), rgbaSha256=digest,
                                          sourceBytes=len(data)+100, bytes=len(data)))
            (assets / 'index.json').write_text(json.dumps(dict(maps={'1-1': row})), encoding='utf-8')
            with mock.patch.object(self.codec, 'ASSETS', assets), mock.patch.dict(self.codec.os.environ):
                self.codec.os.environ.pop('FLEET_ADVISOR_MAP_REFERENCES', None)
                with contextlib.redirect_stdout(io.StringIO()):
                    self.codec.main(check=True)
                with self.assertRaises(FileNotFoundError):
                    self.codec.main(check=True, reference_dir=references)
                (references / '1-1.png').write_bytes(data)
                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    self.codec.main(check=True, reference_dir=references, areas=['1-1'])
                self.assertEqual(json.loads(output.getvalue())['images'], 2)
                (references / '1-1.png').write_bytes(data+b'corrupt')
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    self.codec.main(check=True, reference_dir=references)
                with self.assertRaisesRegex(ValueError, 'outside the project'):
                    self.codec.main(check=True, reference_dir=original)

    def test_unused_common_sprites_are_cleared_without_moving_or_changing_used_pixels(self):
        image = Image.new('RGBA', (20, 12), (10, 20, 30, 100))
        frames = {'boss': dict(frame=dict(x=2, y=3, w=3, h=2)),
                  'start': dict(frame=dict(x=13, y=2, w=3, h=3))}
        retained, runtime = self.codec.retain_symbols(image, {'frames': frames}, ['boss', 'start'])
        self.assertEqual(retained.size, image.size)
        self.assertEqual(retained.getpixel((19, 11)), (0, 0, 0, 0))
        for name, frame in frames.items():
            f = frame['frame']
            self.assertEqual(runtime['frames'][name], f)
            box = (f['x']-2, f['y']-2, f['x']+f['w']+2, f['y']+f['h']+2)
            self.assertEqual(retained.crop(box).tobytes(), image.crop(box).tobytes())
        data, _ = self.codec.encode_exact(retained)
        self.codec.verify_symbols(data, runtime)

    def test_importer_collects_all_incremental_stages_and_refuses_incomplete_or_repeated_spots(self):
        file = Path(__file__).resolve().parents[2] / 'tools/data/import-map-assets.py'
        spec = importlib.util.spec_from_file_location('map_import', file)
        importer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(importer)
        data, _ = self.codec.encode_exact(Image.new('RGBA', (3, 2)))
        files = {
            'maps/007/05_info.json': json.dumps(dict(bg=['base'], spots=[dict(no=0), dict(no=1)])).encode(),
            'maps/007/05_image.json': b'{"frames":{}}', 'maps/007/05_image.png': data,
            'maps/007/05_info2.json': b'{"spots":[{"no":2}]}',
            'maps/007/05_image2.json': b'{"frames":{}}', 'maps/007/05_image2.png': data,
        }
        annotation = dict(route={'0': [None, '1'], '1': ['1', 'A'], '2': ['A', 'B']})
        stages = importer.collect_phases('7-5', annotation, files.__getitem__)
        self.assertEqual(len(stages), 2)
        self.assertEqual(stages[1]['info']['spots'], [dict(no=2)])
        self.assertTrue(stages[1]['files'][2]['url'].endswith('05_image2.png'))
        self.assertEqual(stages[1]['files'][2]['sha256'], hashlib.sha256(data).hexdigest())
        files['maps/007/05_info2.json'] = b'{"spots":[{"no":1}]}'
        with self.assertRaisesRegex(ValueError, 'repeated stage spots'):
            importer.collect_phases('7-5', annotation, files.__getitem__)
        del files['maps/007/05_info2.json']
        with self.assertRaises(KeyError):
            importer.collect_phases('7-5', annotation, files.__getitem__)
