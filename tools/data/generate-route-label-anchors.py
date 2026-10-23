"""Derive small route-label anchors from external, verified map atlas pixels.

Only display geometry is generated. The source atlases remain outside the
project; navigation rules, coordinates, resource identities and hashes stay
unchanged. Pillow is a development dependency, never a plugin dependency.
"""
import argparse
import hashlib
import json
import math
import os
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / 'data/sortie/maps/index.json'
ALPHA_THRESHOLD = 96


def _unit(dx, dy):
    length = math.hypot(dx, dy)
    return (dx / length, dy / length) if length > 1e-9 else None


def _principal_axis(points):
    if len(points) < 3:
        return None
    cx = sum(x for x, _ in points) / len(points)
    cy = sum(y for _, y in points) / len(points)
    xx = sum((x - cx) ** 2 for x, _ in points)
    yy = sum((y - cy) ** 2 for _, y in points)
    xy = sum((x - cx) * (y - cy) for x, y in points)
    spread = math.hypot(xx - yy, 2 * xy)
    if xx + yy <= 1e-9 or spread <= (xx + yy) * .12:
        return None
    angle = .5 * math.atan2(2 * xy, xx - yy)
    return math.cos(angle), math.sin(angle)


def _components(alpha):
    pixels = alpha.load()
    width, height = alpha.size
    remaining = {(x, y) for y in range(height) for x in range(width)
                 if pixels[x, y] >= ALPHA_THRESHOLD}
    components = []
    # Row-major seeds and sorted output make the result independent of set
    # iteration order or interpreter hash randomization.
    for y in range(height):
        for x in range(width):
            if (x, y) not in remaining:
                continue
            remaining.remove((x, y))
            stack, points = [(x, y)], []
            while stack:
                px, py = stack.pop()
                points.append((px + .5, py + .5))
                for ny in range(py - 1, py + 2):
                    for nx in range(px - 1, px + 2):
                        if (nx, ny) in remaining:
                            remaining.remove((nx, ny))
                            stack.append((nx, ny))
            if len(points) >= 3:
                points.sort(key=lambda point: (point[1], point[0]))
                components.append(dict(points=points,
                                       x=sum(p[0] for p in points) / len(points),
                                       y=sum(p[1] for p in points) / len(points)))
    return components


def _skeleton(points):
    """Thin an isolated dash without joining it to any neighbouring route."""
    pixels = {(int(x), int(y)) for x, y in points}
    neighbours = ((0, -1), (1, -1), (1, 0), (1, 1),
                  (0, 1), (-1, 1), (-1, 0), (-1, -1))
    while True:
        removed = 0
        for step in (0, 1):
            discard = []
            for x, y in pixels:
                around = [(x + dx, y + dy) in pixels for dx, dy in neighbours]
                if not 2 <= sum(around) <= 6:
                    continue
                if sum(not around[i] and around[(i + 1) % 8] for i in range(8)) != 1:
                    continue
                n, e, s, w = (around[i] for i in (0, 2, 4, 6))
                if (n and e and (s if step == 0 else w)) or ((e if step == 0 else n) and s and w):
                    continue
                discard.append((x, y))
            pixels.difference_update(discard)
            removed += len(discard)
        if not removed:
            return pixels


def _dash_path(component, direction):
    skeleton = _skeleton(component['points'])
    if len(skeleton) < 2:
        axis = _principal_axis(component['points']) or direction
        project = lambda point: point[0] * axis[0] + point[1] * axis[1]
        ends = [min(component['points'], key=lambda point: (project(point), point)),
                max(component['points'], key=lambda point: (project(point), point))]
        return ends if ends[0] != ends[1] else ends[:1]

    def farthest(seed):
        parents, distance, queue = {seed: None}, {seed: 0}, deque([seed])
        while queue:
            x, y = queue.popleft()
            for ny in range(y - 1, y + 2):
                for nx in range(x - 1, x + 2):
                    point = nx, ny
                    if point in skeleton and point not in parents:
                        parents[point] = x, y
                        distance[point] = distance[x, y] + 1
                        queue.append(point)
        end = max(distance, key=lambda point: (distance[point], point[1], point[0]))
        return end, parents

    first, _ = farthest(min(skeleton))
    last, parents = farthest(first)
    path = []
    while last is not None:
        path.append((last[0] + .5, last[1] + .5))
        last = parents[last]
    return path


def _distance_to_segment(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    length2 = dx * dx + dy * dy
    t = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length2)) if length2 else 0
    return math.hypot(point[0] - start[0] - dx * t, point[1] - start[1] - dy * t)


def _simplify(path, tolerance=2):
    if len(path) <= 2:
        return path
    distances = [_distance_to_segment(point, path[0], path[-1]) for point in path[1:-1]]
    distance = max(distances)
    if distance <= tolerance:
        return [path[0], path[-1]]
    split = distances.index(distance) + 1
    return _simplify(path[:split + 1], tolerance)[:-1] + _simplify(path[split:], tolerance)


def _route_path(components, direction, origin, start=None, end=None):
    """Order actual dash centre-lines; bridge only their transparent gaps.

    Short per-dash skeletons also retain continuous bends. Tangent-aware gap
    costs keep nearby parallel parts of a hairpin in their natural order,
    rather than sorting all points along the straight node-to-node chord.
    """
    curves = [_dash_path(component, direction) for component in components]
    curves = [curve for curve in curves if curve]
    if not curves:
        return []
    source = (start[0] - origin[0], start[1] - origin[1]) if start else min(
        (point for curve in curves for point in curve), key=lambda point: point[0] * direction[0] + point[1] * direction[1])
    target = (end[0] - origin[0], end[1] - origin[1]) if end else max(
        (point for curve in curves for point in curve), key=lambda point: point[0] * direction[0] + point[1] * direction[1])

    def tangent(curve, last=False):
        if len(curve) < 2:
            return direction
        a, b = (curve[max(0, len(curve) - 5)], curve[-1]) if last else (curve[0], curve[min(4, len(curve) - 1)])
        return _unit(b[0] - a[0], b[1] - a[1]) or direction

    def trace(begin, finish):
        remaining, path, cost, previous = set(range(len(curves))), [], 0, None
        cursor = begin
        while remaining:
            choices = []
            for index in sorted(remaining):
                for reverse in (False, True):
                    curve = curves[index][::-1] if reverse else curves[index]
                    gx, gy = curve[0][0] - cursor[0], curve[0][1] - cursor[1]
                    distance2 = gx * gx + gy * gy
                    gap, incoming = _unit(gx, gy), tangent(curve)
                    penalty = 1
                    if gap and previous:
                        penalty += 2 * (1 - gap[0] * previous[0] - gap[1] * previous[1])
                        penalty += 2 * (1 - gap[0] * incoming[0] - gap[1] * incoming[1])
                    choices.append((distance2 * penalty, index, reverse, curve))
            score, index, _, curve = min(choices, key=lambda choice: choice[:3])
            cost += score
            path.extend(point for point in curve if not path or point != path[-1])
            previous, cursor = tangent(curve, last=True), curve[-1]
            remaining.remove(index)
        cost += (cursor[0] - finish[0]) ** 2 + (cursor[1] - finish[1]) ** 2
        return path, cost

    forward, score = trace(source, target)
    backward, reverse_score = trace(target, source)
    if reverse_score < score:
        forward = backward[::-1]
    sparse = _simplify(forward)
    return [[round(origin[0] + x, 1), round(origin[1] + y, 1)] for x, y in sparse]


def label_geometry(atlas, line, start=None, end=None):
    """Return an on-stroke map anchor and a unit local tangent, or no anchor.

    ``atlas`` is the vertically packed development reference. Its frame.y
    already includes the source part's offsetY, just like index.json. A crop
    never uses map position x/y as texture coordinates.
    """
    sprite = line['sprite']
    if sprite.get('rotated'):
        raise ValueError('Rotated route sprites are unsupported')
    frame = sprite['frame']
    x, y, width, height = (frame[k] for k in ('x', 'y', 'w', 'h'))
    if not (width > 0 and height > 0 and x >= 0 and y >= 0
            and x + width <= atlas.width and y + height <= atlas.height):
        raise ValueError('Route sprite lies outside its atlas')
    alpha = atlas.crop((x, y, x + width, y + height)).getchannel('A')
    components = _components(alpha)
    if not components:
        # Transparent or noise-only sprites cannot prove where a real line is.
        # The renderer can retain its existing schematic/bounds fallback.
        return None
    visible = sprite.get('spriteSourceSize', {})
    origin_x = line['x'] + visible.get('x', 0)
    origin_y = line['y'] + visible.get('y', 0)
    all_points = [point for component in components for point in component['points']]
    direction = _unit(end[0] - start[0], end[1] - start[1]) if start and end else None
    direction = direction or _principal_axis(all_points) or (1, 0)
    dx, dy = direction
    project = lambda px, py: px * dx + py * dy
    values = [project(px, py) for px, py in all_points]
    low, high = min(values), max(values)
    span = high - low
    if span <= 1e-9:
        return None
    for component in components:
        component['t'] = (project(component['x'], component['y']) - low) / span
    # The final arrowhead and the departure end are never preferred. Select a
    # real dash near the middle rather than the empty centre of a curved bbox.
    middle = [component for component in components if .2 <= component['t'] <= .8]
    centre = (width / 2, height / 2)
    chosen = min(middle or components, key=lambda component: (
        abs(component['t'] - .5),
        (component['x'] - centre[0]) ** 2 + (component['y'] - centre[1]) ** 2,
        component['y'], component['x']))
    # A pixel nearest the filled shape's centroid can land at the inner edge
    # of a bent/thick dash. Use the visible dash's centre-line arc midpoint;
    # choose a real skeleton pixel instead of interpolating into a clear gap.
    centreline = _dash_path(chosen, direction)
    distances = [0]
    for a, b in zip(centreline, centreline[1:]):
        distances.append(distances[-1] + math.dist(a, b))
    middle_distance = distances[-1] / 2
    anchor_index = min(range(len(centreline)), key=lambda index: (
        round(abs(distances[index] - middle_distance), 9),
        round(abs((project(*centreline[index]) - low) / span - .5), 9),
        centreline[index][1], centreline[index][0]))
    anchor = centreline[anchor_index]
    # The local skeleton determines the tangent at this precise landing point.
    # Neighbouring dash centres remain useful for short or degenerate strokes.
    before = [component for component in middle if component['t'] < chosen['t'] - 1e-6]
    after = [component for component in middle if component['t'] > chosen['t'] + 1e-6]
    local = centreline[max(0, anchor_index - 6):anchor_index + 7]
    tangent = _principal_axis(local)
    if before and after:
        left = max(before, key=lambda component: component['t'])
        right = min(after, key=lambda component: component['t'])
        tangent = tangent or _unit(right['x'] - left['x'], right['y'] - left['y'])
    tangent = tangent or direction
    if tangent[0] * dx + tangent[1] * dy < 0:
        tangent = -tangent[0], -tangent[1]
    rounded = lambda value: round(value, 6) or 0
    geometry = dict(x=rounded(origin_x + anchor[0]), y=rounded(origin_y + anchor[1]),
                    dx=rounded(tangent[0]), dy=rounded(tangent[1]))
    path = _route_path(components, direction, (origin_x, origin_y), start, end)
    if len(path) >= 2:
        geometry['path'] = path
    return geometry


def read_reference(reference_dir, row):
    file = reference_dir / row['image']
    if file.parent.resolve() != reference_dir.resolve():
        raise ValueError('Reference image must stay inside its directory')
    data = file.read_bytes()
    encoding = row.get('imageEncoding', {})
    identities = {value for value in (encoding.get('sha256'), row.get('source', {}).get('sha256')) if value}
    if not identities or hashlib.sha256(data).hexdigest() not in identities:
        raise ValueError(f'{file.name}: source image hash mismatch')
    with Image.open(file) as source:
        image = source.convert('RGBA')
    if image.size != (row['spriteWidth'], row['spriteHeight']):
        raise ValueError(f'{file.name}: atlas dimensions mismatch')
    if encoding.get('rgbaSha256') and hashlib.sha256(image.tobytes()).hexdigest() != encoding['rgbaSha256']:
        raise ValueError(f'{file.name}: RGBA identity mismatch')
    return image


def update_manifest(manifest, reference_dir, check=False, areas=None):
    count, missing, changed = 0, [], []
    selected = set(manifest['maps'] if areas is None else areas)
    unknown = selected - manifest['maps'].keys()
    if unknown:
        raise ValueError('Unknown normal map: ' + ', '.join(sorted(unknown)))
    for area, row in manifest['maps'].items():
        if area not in selected:
            continue
        image = read_reference(reference_dir, row)
        try:
            for key, line in row['lines'].items():
                start, end = key.split('>')
                geometry = label_geometry(image, line, row['spots'].get(start), row['spots'].get(end))
                count += 1
                if geometry is None:
                    missing.append(f'{area}:{key}')
                if line.get('labelGeometry') == geometry:
                    continue
                changed.append(f'{area}:{key}')
                if geometry is None:
                    line.pop('labelGeometry', None)
                else:
                    line['labelGeometry'] = geometry
        finally:
            image.close()
    if check and changed:
        raise ValueError('Route label geometry differs: ' + ', '.join(changed))
    return dict(maps=len(selected), lines=count, anchors=count - len(missing),
                missing=missing, changed=len(changed), checkOnly=check)


def main(check=False, reference_dir=None, manifest_path=MANIFEST, areas=None):
    references = Path(reference_dir or os.environ.get('FLEET_ADVISOR_MAP_REFERENCES')
                      or ROOT.parent / 'map-references/fleet-advisor').expanduser().resolve()
    if references.is_relative_to(ROOT):
        raise ValueError('Map reference directory must be outside the project')
    manifest_path = Path(manifest_path)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    report = update_manifest(manifest, references, check=check, areas=areas)
    if not check and report['changed']:
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
                                 encoding='utf-8', newline='\n')
    print(json.dumps(report, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-dir', help='External, verified development map atlases')
    parser.add_argument('--areas', nargs='+', help='Only process these maps, such as 1-3 7-3')
    parser.add_argument('--check', action='store_true', help='Verify deterministic anchors without writing')
    args = parser.parse_args()
    main(check=args.check, reference_dir=args.reference_dir, areas=args.areas)
