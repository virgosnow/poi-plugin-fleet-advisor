"""Offline route-label geometry checks; no game or network access is used."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import tempfile
import unittest
from unittest import mock

try:
    from PIL import Image, ImageDraw
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False


@unittest.skipUnless(HAS_PILLOW, 'Asset checks require Pillow')
class RouteLabelAnchorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        file = Path(__file__).resolve().parents[2] / 'tools/data/generate-route-label-anchors.py'
        spec = importlib.util.spec_from_file_location('route_label_anchors', file)
        cls.generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.generator)

    def line(self, width=100, height=90, **overrides):
        row = dict(x=0, y=0, sprite=dict(frame=dict(x=0, y=0, w=width, h=height),
                                       rotated=False, trimmed=False,
                                       spriteSourceSize=dict(x=0, y=0, w=width, h=height),
                                       sourceSize=dict(w=width, h=height)))
        row.update(overrides)
        return row

    def reference(self, directory, image, line):
        output = io.BytesIO()
        image.save(output, format='PNG')
        data = output.getvalue()
        (directory / '1-1.png').write_bytes(data)
        return dict(source=dict(pinned=True), maps={'1-1': dict(
            image='1-1.png', spriteWidth=image.width, spriteHeight=image.height,
            source=dict(sha256=hashlib.sha256(data).hexdigest(), license='retained'),
            imageEncoding=dict(sha256=hashlib.sha256(data).hexdigest(),
                               rgbaSha256=hashlib.sha256(image.tobytes()).hexdigest()),
            resources=[dict(sha256='source-part-identity', offsetY=0)],
            spots={'A': [0, 20, 'battle'], 'B': [100, 20, 'battle']}, lines={'A>B': line})})

    def test_curved_dashes_anchor_on_real_pixels_instead_of_empty_bbox_centre(self):
        image = Image.new('RGBA', (100, 90))
        draw = ImageDraw.Draw(image)
        for x in range(8, 94, 12):
            points = [(xx, round(10 + 60 * math.sin(math.pi * xx / 100))) for xx in range(x, x + 6)]
            draw.line(points, fill=(70, 70, 70, 255), width=3)
        self.assertEqual(image.getpixel((50, 45))[3], 0)
        result = self.generator.label_geometry(image, self.line(), [0, 10], [100, 10])
        self.assertTrue(30 < result['x'] < 70)
        self.assertGreater(result['y'], 60)
        self.assertGreaterEqual(image.getpixel((int(result['x']), int(result['y'])))[3], 96)
        self.assertAlmostEqual(math.hypot(result['dx'], result['dy']), 1, places=5)
        self.assertGreater(result['dx'], .85)
        self.assertGreaterEqual(len(result['path']), 4)
        self.assertGreater(max(point[1] for point in result['path']), 60)
        self.assertEqual(result, self.generator.label_geometry(image, self.line(), [0, 10], [100, 10]))

    def test_first_and_last_arrow_components_do_not_replace_a_middle_dash(self):
        image = Image.new('RGBA', (100, 40))
        draw = ImageDraw.Draw(image)
        for x in [4, 24, 44, 64]:
            draw.rectangle((x, 18, x + 8, 21), fill=(255, 255, 255, 255))
        draw.polygon([(82, 7), (99, 20), (82, 33)], fill=(255, 255, 255, 255))
        result = self.generator.label_geometry(image, self.line(100, 40), [0, 20], [100, 20])
        self.assertTrue(35 < result['x'] < 65)
        self.assertAlmostEqual(result['dy'], 0, places=5)

    def test_landing_uses_the_middle_of_a_thick_bent_dash_centreline_not_its_inner_edge(self):
        image = Image.new('RGBA', (80, 80))
        ImageDraw.Draw(image).line([(8, 10), (52, 10), (52, 62)],
                                  fill=(255, 255, 255, 255), width=9)
        result = self.generator.label_geometry(image, self.line(80, 80), [8, 10], [52, 62])
        self.assertTrue(51 <= result['x'] <= 53)
        self.assertTrue(12 <= result['y'] <= 19)
        self.assertGreaterEqual(image.getpixel((int(result['x']), int(result['y'])))[3], 96)
        self.assertAlmostEqual(math.hypot(result['dx'], result['dy']), 1, places=5)

    def test_whole_line_midpoint_in_a_transparent_gap_still_uses_a_real_central_dash(self):
        image = Image.new('RGBA', (100, 40))
        draw = ImageDraw.Draw(image)
        for x in [8, 30, 52, 74]:
            draw.line([(x, 20), (x + 8, 20)], fill=(255, 255, 255, 255), width=5)
        result = self.generator.label_geometry(image, self.line(100, 40), [0, 20], [100, 20])
        self.assertEqual(image.getpixel((45, 20))[3], 0)
        self.assertTrue(32 <= result['x'] <= 36 or 54 <= result['x'] <= 58)
        self.assertEqual(result['y'], 20.5)
        self.assertGreaterEqual(image.getpixel((int(result['x']), int(result['y'])))[3], 96)

    def test_packed_stage_y_and_trim_offsets_are_separate_from_map_coordinates(self):
        part = Image.new('RGBA', (120, 70))
        ImageDraw.Draw(part).line((25, 30, 80, 30), fill=(255, 255, 255, 255), width=3)
        atlas = Image.new('RGBA', (120, 150))
        atlas.paste(part, (0, 80))
        line = self.line(80, 40, x=300, y=200)
        line['sprite']['frame'].update(x=10, y=95)
        line['sprite']['spriteSourceSize'].update(x=4, y=6)
        line['sprite']['trimmed'] = True
        result = self.generator.label_geometry(atlas, line, [300, 221], [400, 221])
        self.assertTrue(330 < result['x'] < 365)
        self.assertTrue(220 <= result['y'] <= 222)
        self.assertAlmostEqual(result['dx'], 1, places=5)
        self.assertEqual(len(result['path']), 2)
        self.assertTrue(all(315 < x < 380 and 220 <= y <= 222 for x, y in result['path']))
        wrong = copy.deepcopy(line)
        wrong['sprite']['frame']['y'] -= 80
        self.assertIsNone(self.generator.label_geometry(atlas, wrong))

    def test_transparent_or_noise_only_sprites_leave_renderer_fallback_available(self):
        image = Image.new('RGBA', (100, 40), (255, 255, 255, 0))
        image.putpixel((50, 20), (255, 255, 255, 20))
        self.assertIsNone(self.generator.label_geometry(image, self.line(100, 40)))
        image.putpixel((50, 20), (255, 255, 255, 255))
        self.assertIsNone(self.generator.label_geometry(image, self.line(100, 40)))
        with tempfile.TemporaryDirectory() as directory:
            manifest = self.reference(Path(directory), image, self.line(100, 40))
            manifest['maps']['1-1']['lines']['A>B']['labelGeometry'] = dict(x=50, y=20, dx=1, dy=0)
            report = self.generator.update_manifest(manifest, Path(directory))
            self.assertEqual(report['missing'], ['1-1:A>B'])
            self.assertNotIn('labelGeometry', manifest['maps']['1-1']['lines']['A>B'])

    def test_generation_changes_only_label_geometry_and_check_never_writes(self):
        image = Image.new('RGBA', (100, 40))
        ImageDraw.Draw(image).line((5, 20, 95, 20), fill=(255, 255, 255, 255), width=3)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.reference(root, image, self.line(100, 40))
            original = copy.deepcopy(manifest)
            file = root / 'manifest.json'
            file.write_text(json.dumps(manifest), encoding='utf-8')
            with contextlib.redirect_stdout(io.StringIO()):
                self.generator.main(reference_dir=root, manifest_path=file)
            generated = json.loads(file.read_text(encoding='utf-8'))
            geometry = generated['maps']['1-1']['lines']['A>B'].pop('labelGeometry')
            self.assertEqual(set(geometry), {'x', 'y', 'dx', 'dy', 'path'})
            self.assertEqual({key: geometry[key] for key in ['x', 'y', 'dx', 'dy']},
                             dict(x=50.5, y=20.5, dx=1, dy=0))
            self.assertEqual(generated, original)
            stable = file.read_bytes()
            for check in [False, True]:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.generator.main(check=check, reference_dir=root, manifest_path=file)
                self.assertEqual(file.read_bytes(), stable)
            changed = json.loads(stable)
            changed['maps']['1-1']['lines']['A>B']['labelGeometry']['x'] += 1
            file.write_text(json.dumps(changed), encoding='utf-8')
            stale = file.read_bytes()
            with self.assertRaisesRegex(ValueError, 'geometry differs'):
                self.generator.main(check=True, reference_dir=root, manifest_path=file)
            self.assertEqual(file.read_bytes(), stale)

    def test_mismatched_reference_pixels_and_invalid_frames_fail_closed(self):
        image = Image.new('RGBA', (100, 40), (255, 255, 255, 255))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.reference(root, image, self.line(100, 40))
            file = root / '1-1.png'
            file.write_bytes(file.read_bytes() + b'changed')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                self.generator.update_manifest(manifest, root)
        rotated = self.line(100, 40)
        rotated['sprite']['rotated'] = True
        with self.assertRaisesRegex(ValueError, 'Rotated'):
            self.generator.label_geometry(image, rotated)
        outside = self.line(100, 40)
        outside['sprite']['frame']['x'] = 1
        with self.assertRaisesRegex(ValueError, 'outside'):
            self.generator.label_geometry(image, outside)

    def test_subset_leaves_other_maps_and_unavailable_reference_images_untouched(self):
        image = Image.new('RGBA', (100, 40))
        ImageDraw.Draw(image).line((5, 20, 95, 20), fill=(255, 255, 255, 255), width=3)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self.reference(root, image, self.line(100, 40))
            other = copy.deepcopy(manifest['maps']['1-1'])
            other['image'] = 'not-downloaded.png'
            other['source']['kind'] = 'gamePhasedAtlas'
            other['lines']['A>B']['labelGeometry'] = dict(x=18, y=12, dx=0, dy=1)
            manifest['maps']['7-5'] = copy.deepcopy(other)
            report = self.generator.update_manifest(manifest, root, areas=['1-1', '1-1'])
            self.assertEqual(report['maps'], 1)
            self.assertEqual(report['anchors'], 1)
            self.assertEqual(report['changed'], 1)
            self.assertEqual(manifest['maps']['7-5'], other)
            file = root / 'manifest.json'
            file.write_text(json.dumps(manifest), encoding='utf-8')
            for check in [False, True]:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.generator.main(check=check, reference_dir=root, manifest_path=file, areas=['1-1'])
                self.assertEqual(json.loads(file.read_text(encoding='utf-8'))['maps']['7-5'], other)
            before = copy.deepcopy(manifest)
            with self.assertRaisesRegex(ValueError, 'Unknown normal map: 99-9'):
                self.generator.update_manifest(manifest, root, areas=['1-1', '99-9'])
            self.assertEqual(manifest, before)

    def test_importer_regenerates_anchors_only_after_optimizing_the_new_map_subset(self):
        file = Path(__file__).resolve().parents[2] / 'tools/data/import-map-assets.py'
        spec = importlib.util.spec_from_file_location('map_import_for_labels', file)
        importer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(importer)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project, references = root / 'project', root / 'references'
            assets, routes = project / 'data/sortie/maps', project / 'data/normal_routes'
            assets.mkdir(parents=True)
            routes.mkdir(parents=True)
            references.mkdir()
            (routes / '1-1.json').write_text('{}', encoding='utf-8')
            generated = self.reference(references, Image.new('RGBA', (100, 40)), self.line(100, 40))['maps']['1-1']
            generated.update(missingCoordinates=[], missingLineSprites=[])
            generated['imageEncoding']['bytes'] = 123
            retained = dict(image='unavailable.png', source=dict(kind='gamePhasedAtlas'),
                            missingCoordinates=[], missingLineSprites=[], imageEncoding=dict(bytes=456))
            (assets / 'index.json').write_text(json.dumps(dict(maps={'7-5': retained})), encoding='utf-8')
            with mock.patch.multiple(importer, ROOT=project, DEST=assets), \
                    mock.patch.object(importer, 'fetch', side_effect=lambda name: b'{}' if name == 'data/final.json' else b'license'), \
                    mock.patch.object(importer.concurrent.futures, 'ThreadPoolExecutor') as pool, \
                    mock.patch.object(importer.subprocess, 'run') as run, \
                    contextlib.redirect_stdout(io.StringIO()):
                pool.return_value.__enter__.return_value.map.return_value = [('1-1', generated)]
                importer.main(['1-1'], references)
            self.assertEqual(run.call_count, 2)
            optimize, anchors = [call.args[0] for call in run.call_args_list]
            self.assertEqual(Path(optimize[1]).name, 'optimize-map-assets.py')
            self.assertEqual(Path(anchors[1]).name, 'generate-route-label-anchors.py')
            self.assertEqual(anchors[2:], ['--reference-dir', str(references.resolve()), '--areas', '1-1'])
            self.assertTrue(all(call.kwargs['check'] for call in run.call_args_list))
            self.assertEqual(json.loads((assets / 'index.json').read_text(encoding='utf-8'))['maps']['7-5'], retained)

    def test_continuous_bend_retains_its_real_centreline_with_a_two_pixel_simplification(self):
        image = Image.new('RGBA', (100, 90))
        centres = [(x, round(10 + 60 * math.sin(math.pi * x / 100))) for x in range(8, 94)]
        ImageDraw.Draw(image).line(centres, fill=(255, 255, 255, 255), width=3)
        geometry = self.generator.label_geometry(image, self.line(), [0, 10], [100, 10])
        path = geometry['path']
        self.assertTrue(4 <= len(path) <= 10)
        self.assertGreater(max(point[1] for point in path), 65)
        for point in centres[2:-2]:
            distance = min(self.generator._distance_to_segment(point, a, b) for a, b in zip(path, path[1:]))
            self.assertLessEqual(distance, 3.5)
        for x, y in path:
            self.assertGreaterEqual(image.getpixel((int(x), int(y)))[3], 96)

    def test_nearby_parallel_hairpin_parts_are_not_sorted_into_a_straight_chord(self):
        image = Image.new('RGBA', (70, 100))
        centres = ([(20, y) for y in range(10, 81)] + [(x, 80) for x in range(21, 41)]
                   + [(40, y) for y in range(79, 9, -1)])
        draw = ImageDraw.Draw(image)
        for index in range(0, len(centres), 10):
            draw.line(centres[index:index + 6], fill=(255, 255, 255, 255), width=3)
        geometry = self.generator.label_geometry(image, self.line(70, 100), [20, 10], [40, 10])
        path = geometry['path']
        self.assertGreaterEqual(max(point[1] for point in path), 78)
        self.assertTrue(4 <= len(path) <= 9)
        self.assertLess(path[0][0], 25)
        self.assertGreater(path[-1][0], 35)
        for point in centres[5:-5]:
            distance = min(self.generator._distance_to_segment(point, a, b) for a, b in zip(path, path[1:]))
            self.assertLessEqual(distance, 4)


if __name__ == '__main__':
    unittest.main()
