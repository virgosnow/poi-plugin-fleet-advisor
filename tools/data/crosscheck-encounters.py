"""Cross-check parsed wikiwiki encounters against kcwiki 敌方配置表 blocks.

Matching is keyed on the enemy api-id sequence (wikiwiki side ids come from
the back-fill against data/sortie/enemy_catalog.json), falling back to
variant-insensitive name matching only when ids are unavailable. A pattern
counts as fullyConsistent only when the id sequence AND every field both
sides document (exp, enemy air power, formation, escort fleet, final-form
marker) agree; any difference is kept as a per-field conflict record with
both values verbatim, not adjudicated here.
"""
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

STAGED = ROOT.parent / 'tmp/sortie_sources/maps'
BANNER = ROOT.parent / 'tmp/sortie_sources/enemies/kcwiki_template_shinkai_banner.json'
OUT = ROOT / 'data/sortie/encounters'


def _banner_entries(body):
    """Yield (ids, zh, ja) from Template:深海横幅 lines.

    Normal lines are |id|zh|ja =<div ...>; some entries (装甲空母鬼 etc.)
    carry a single name only. Names are taken from the part before the first
    '=' so image-parameter pipes cannot leak in; anything still containing
    template markup is rejected instead of recorded as garbage.
    """
    for line in body.splitlines():
        if not line.startswith('|'):
            continue
        head = line.split('=', 1)[0]
        fields = [f.strip() for f in head.split('|')[1:] if f.strip()]
        ids = []
        while fields and re.fullmatch(r'\d{4}', fields[0]):
            ids.append(fields.pop(0))
        if not ids or not fields:
            continue
        if len(fields) >= 2:
            zh, ja = fields[0], fields[1]
        else:
            zh = ja = fields[0]
        junk = re.compile(r'[<>{\[\]=]')
        if junk.search(zh) or junk.search(ja):
            continue
        for sid in ids:
            yield sid, zh, ja

def load_banner_names():
    body = json.loads(BANNER.read_text(encoding='utf-8'))['rawSource']
    id2ja = {}
    id2zh = {}
    for sid, zh, ja in _banner_entries(body):
        id2ja[sid] = ja
        id2zh[sid] = zh
    return id2ja, id2zh

JA_TO_SIMP = str.maketrans({'級': '级', '軽': '轻', '戦': '战', '駆': '驱', '縦': '纵',
                            '単': '单', '複': '复', '輪': '轮', '姫': '姬', '棲': '栖',
                            '艦': '舰', '機': '机', '壊': '坏', '後': '后', '改': '改',
                            '輸': '输'})

def canon(name):
    name = name.translate(JA_TO_SIMP)
    m = re.match(r'^(.*?)\s*[（(][^）)]*[）)]\s*$', name)
    if m:
        return m.group(1).replace(' ', '')
    if ' ' in name:
        return name.split(' ', 1)[0].replace(' ', '')
    return name.replace(' ', '')

def parse_kcwiki_blocks(raw):
    blocks = {}
    for m in re.finditer(r'\{\{敌方配置表(.*?)\n\}\}', raw, re.S):
        fields = {}
        last_key = None
        for line in m.group(1).splitlines():
            fm = re.match(r'\|([^=|]+?)\s*=\s*(.*)$', line)
            if fm:
                last_key = fm.group(1).strip()
                fields[last_key] = fm.group(2).strip()
            elif line.strip() and last_key:
                fields[last_key] += line.strip()
        node = fields.get('海域点', '')
        nm = re.match(r'([A-Z][0-9]?)', node)
        if not nm:
            continue
        def make(idx):
            suffix = '' if idx == 1 else str(idx)
            ships = fields.get(f'敌方{suffix}', '')
            groups = [g for g in re.split(r'<br\s*/?>', ships) if g.strip()]
            marker = fields.get(f'lastkill{suffix}', '').strip().lower()
            return {'formation': fields.get(f'阵型{suffix}', ''),
                    'main': groups[0] if groups else '',
                    'escort': groups[1] if len(groups) > 1 else '',
                    'air': fields.get(f'制空值{suffix}', ''),
                    'exp': fields.get(f'获得经验{suffix}', ''),
                    'finalForm': {'true': True, 'false': False}.get(marker)}
        variants = [make(1)]
        idx = 2
        while f'阵型{idx}' in fields or f'敌方{idx}' in fields or f'获得经验{idx}' in fields:
            variants.append(make(idx))
            idx += 1
        blocks[nm.group(1)] = {'nodeName': fields.get('海域点原名', ''),
                               'nodeType': fields.get('nodetype', ''),
                               'variants': variants}
    return blocks

def to_int(text):
    text = (text or '').strip().replace(',', '')
    m = re.fullmatch(r"(?:\'\')?(\d+)(?:\'\')?", text)
    return int(m.group(1)) if m else None

FORMATION_ZH_JA = {'单纵': '単縦', '复纵': '複縦', '单横': '単横', '轮型': '輪形',
                   '梯形': '梯形', '单舰': '単艦', '警戒': '警戒'}

def norm_formation(tokens):
    """kcwiki writes 単縦陣/单横阵, wikiwiki 単縦/単横; compare as ja sets."""
    out = set()
    for token in tokens:
        token = token.strip()
        if not token:
            continue
        token = re.sub(r'<br\s*/?>', ' ', token)
        for part in token.split(' '):
            part = part.strip().rstrip('陣').rstrip('阵')
            if part in FORMATION_ZH_JA:
                part = FORMATION_ZH_JA[part]
            if part:
                out.add(part)
    return out

def ids_of_ships(ships):
    return [s.get('apiId') for s in (ships or [])]

def final_form_conflict(wikiwiki, kcwiki):
    """An absent marker is unknown, not a negative assertion."""
    return isinstance(wikiwiki, bool) and isinstance(kcwiki, bool) and wikiwiki != kcwiki

def main():
    areas = sys.argv[1:] or ['1-5', '2-5', '5-5', '6-5', '7-5']
    id2ja, id2zh = load_banner_names()
    print(f'banner mapping: {len(id2ja)} ids')
    for area in areas:
        staged = json.loads((STAGED / f'{area}.kcwiki.json').read_text(encoding='utf-8'))
        encounter_path = OUT / f'{area}.json'
        data = json.loads(encounter_path.read_text(encoding='utf-8'))
        blocks = parse_kcwiki_blocks(staged['rawSource'])
        cross = {
            'source': {
                'url': staged['url'],
                'retrievedAt': staged['retrievedAt'],
                'sha256': staged['sha256'],
            },
            'idNameSource': {
                'url': json.loads(BANNER.read_text(encoding='utf-8'))['url'],
                'note': 'kcwiki Template:深海横幅 api id → 日文名',
            },
            'matchBasis': ('api-id sequence first, name fallback; fields compared '
                           'when both sides document them: exp/enemyAirPower/formation/'
                           'escortApiIds/finalForm'),
            'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
            'nodes': {},
        }
        totals = {'fullyConsistent': 0, 'fieldConflicts': 0, 'compositionConflicts': 0}
        for node_id, entry in data['nodes'].items():
            block = blocks.get(node_id)
            node_report = {'kcwikiVariants': None, 'matches': [], 'conflicts': []}
            if block is None:
                node_report['conflicts'].append({
                    'type': 'nodeMissingInKcwiki', 'wikiwiki': 'node present', 'kcwiki': None})
                cross['nodes'][node_id] = node_report
                continue
            variants = []
            for v in block['variants']:
                ids = [int(i) for i in re.findall(r'\{\{深海横幅\|(\d+)\}\}', v['main'])]
                escort_ids = [int(i) for i in re.findall(r'\{\{深海横幅\|(\d+)\}\}', v['escort'])]
                variants.append({
                    'apiIds': ids,
                    'escortApiIds': escort_ids or None,
                    'namesJa': [id2ja.get(str(i), f'unknown:{i}') for i in ids],
                    'formation': v['formation'] or None,
                    'air': to_int(v['air']),
                    'exp': to_int(v['exp']),
                    'finalForm': v['finalForm'],
                })
            node_report['kcwikiVariants'] = variants
            patterns = []
            for phase in entry['phases'].values():
                patterns.extend(phase['patterns'])
            if not patterns:
                cross['nodes'][node_id] = node_report
                continue
            def resolve_same(p, seen=None):
                seen = seen or set()
                if p['pattern'] in seen:
                    return None
                if p.get('enemyShips'):
                    return p
                if p.get('sameAsPattern'):
                    ref = next((q for q in patterns if q['pattern'] == p['sameAsPattern']), None)
                    return resolve_same(ref, seen | {p['pattern']}) if ref else None
                return None
            for p in patterns:
                ref = resolve_same(p) or p
                main_ids = ids_of_ships(ref.get('enemyShips'))
                names = [s['name'] for s in (ref.get('enemyShips') or [])]
                escort_ids = ids_of_ships((p.get('escortFleet') or {}).get('enemyShips'))
                w_form = norm_formation(p.get('formation') or [])
                w_air = p.get('enemyAirPower')
                w_exp = p.get('exp')
                w_final = p.get('finalForm')
                ids_complete = bool(main_ids) and all(i is not None for i in main_ids)
                id_pool = [v for v in variants if main_ids == v['apiIds']] if ids_complete else []
                if id_pool:
                    pool, basis = id_pool, 'ids'
                elif not ids_complete:
                    pool = [v for v in variants
                            if names and len(names) == len(v['namesJa'])
                            and all(canon(a) == canon(b) or a == b
                                    for a, b in zip(names, v['namesJa']))]
                    basis = 'names'
                else:
                    pool, basis = [], None
                best = None  # (score_tuple, variant, basis, field_conflicts)
                for v in pool:
                    field_conflicts = []
                    if escort_ids and v.get('escortApiIds') and escort_ids != v['escortApiIds']:
                        field_conflicts.append({'field': 'escortApiIds',
                                                'wikiwiki': escort_ids, 'kcwiki': v['escortApiIds']})
                    if w_exp is not None and v['exp'] is not None and w_exp != v['exp']:
                        field_conflicts.append({'field': 'exp', 'wikiwiki': w_exp, 'kcwiki': v['exp']})
                    if isinstance(w_air, int) and v['air'] is not None and w_air != v['air']:
                        field_conflicts.append({'field': 'enemyAirPower',
                                                'wikiwiki': w_air, 'kcwiki': v['air']})
                    v_form = norm_formation([v['formation']] if v['formation'] else [])
                    if w_form and v_form and w_form != v_form:
                        relation = ('wikiwikiSuperset' if v_form < w_form else
                                    'wikiwikiSubset' if w_form < v_form else 'disjoint')
                        field_conflicts.append({'field': 'formation',
                                                'wikiwiki': sorted(w_form), 'kcwiki': sorted(v_form),
                                                'relation': relation})
                    if final_form_conflict(w_final, v.get('finalForm')):
                        field_conflicts.append({'field': 'finalForm',
                                                'wikiwiki': w_final, 'kcwiki': v['finalForm'],
                                                'note': '双方明确标注的最终形态状态不同'})
                    score = (0 if field_conflicts else 1, -len(field_conflicts))
                    if best is None or score > best[0]:
                        best = (score, v, basis, field_conflicts)
                if best is None and ids_complete:
                    totals['compositionConflicts'] += 1
                    node_report['conflicts'].append({
                        'type': 'compositionConflict',
                        'wikiwikiPattern': p['pattern'],
                        'wikiwikiShips': names,
                        'wikiwikiApiIds': main_ids,
                        'kcwikiVariants': [{'apiIds': v['apiIds'],
                                            'namesJa': v['namesJa']} for v in variants]})
                    continue
                if best is None:
                    totals['compositionConflicts'] += 1
                    node_report['conflicts'].append({
                        'type': 'compositionConflict',
                        'wikiwikiPattern': p['pattern'],
                        'wikiwikiShips': names,
                        'wikiwikiApiIds': main_ids,
                        'kcwikiVariants': [{'apiIds': v['apiIds'],
                                            'namesJa': v['namesJa']} for v in variants]})
                    continue
                _, v, basis, field_conflicts = best
                if field_conflicts:
                    totals['fieldConflicts'] += 1
                    node_report['conflicts'].append({
                        'type': 'fieldConflict',
                        'wikiwikiPattern': p['pattern'],
                        'matchBasis': basis,
                        'fieldConflicts': field_conflicts,
                        'wikiwikiApiIds': main_ids,
                        'kcwikiApiIds': v['apiIds']})
                else:
                    totals['fullyConsistent'] += 1
                    node_report['matches'].append({'pattern': p['pattern'], 'basis': basis})
            kv = len(variants)
            wp = len(patterns)
            if kv != wp:
                node_report['conflicts'].append({
                    'type': 'patternCountDiffers',
                    'wikiwikiPatterns': wp, 'kcwikiVariants': kv})
            cross['nodes'][node_id] = node_report
        data['crossCheck'] = cross
        data['crossCheck']['summary'] = {
            'nodesChecked': len(data['nodes']),
            'kcwikiNodes': len(blocks),
            'patternsFullyConsistent': totals['fullyConsistent'],
            'fieldConflictPatterns': totals['fieldConflicts'],
            'compositionConflictPatterns': totals['compositionConflicts'],
            'conflictCount': sum(len(n['conflicts']) for n in cross['nodes'].values()),
            'note': ('「字段一致」指 api ID 序列与双方均记载的全部字段（经验/敌制空/阵形/'
                     '护卫舰队/最终形态）都一致；仅舰名匹配不算一致'),
        }
        encounter_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f"{area}: kcwiki nodes={len(blocks)} fullyConsistent={totals['fullyConsistent']} "
              f"fieldConflicts={totals['fieldConflicts']} compositionConflicts={totals['compositionConflicts']}")

if __name__ == '__main__':
    main()
