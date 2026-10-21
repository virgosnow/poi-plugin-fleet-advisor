"""Parse staged wikiwiki 敵編成 folds into structured encounter JSON.

Reads tmp/sortie_sources/maps/<area>.json (produced by stage-wiki-encounters.py)
and writes data/sortie/encounters/<area>.json. Cells directly read from the wiki
table are marked verified; values inherited via `~` or parsed from free text are
marked inherited/tentative; anything absent in the source stays null (never
filled with defaults).
"""
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

STAGED = ROOT.parent / 'tmp/sortie_sources/maps'
OUT = ROOT / 'data/sortie/encounters'
ROUTES = ROOT / 'data/normal_routes'

KIND_MAP = [('揚陸地点', 'transport'), ('対潜戦', 'asw'), ('夜戦', 'nightBattle'), ('空襲戦', 'aerialRaid'),
            ('航空戦', 'aerialCombat'), ('能動分岐', 'activeBranch'),
            ('戦闘なし', 'noBattle'), ('うずしお', 'whirlpool'),
            ('アイテム獲得', 'item'), ('航空偵察', 'airRecon'), ('資源', 'resources')]

def clean(text):
    """Strip wiki inline markup, keeping the visible text."""
    text = re.sub(r'&color\([^)]*\)\{(.*?)\};', r'\1', text)
    text = text.replace("'''", '').replace("''", '')
    text = text.replace('&br;', '\n')
    text = text.replace('%%%', '')
    return text.strip()

def parse_int(cell):
    cell = clean(cell).replace(',', '')
    if cell in ('', '?', '？', '（EXP）', '(EXP)', '-'):
        return None
    m = re.fullmatch(r'\d+', cell)
    return int(m.group(0)) if m else None

def parse_ships(cell):
    ships = []
    for part in cell.split('、'):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r'\[\[(.+?)>([^\]]+)\]\]', part)
        if m:
            raw_display, target = m.group(1), m.group(2)
        else:
            m2 = re.fullmatch(r'\[\[([^>]+?)\]\]', part)
            raw_display, target = (m2.group(1), m2.group(1)) if m2 else (part, None)
        display = clean(raw_display).replace('\n', '')
        ships.append({'name': display, 'raw': part, 'wikiTarget': target,
                      'apiId': None, 'apiIdStatus': 'unknown'})
    return ships

def parse_hq_range(cell):
    raw = clean(cell).replace('\n', ' ').strip()
    if raw in ('', '~', '-'):
        return None
    return {'raw': raw}

def parse_rates_from_text(text):
    """Extract documented per-pattern appearance rates from a node cell."""
    results = []
    # style A: パターン1:2:3=25:15:26 ((note))
    for m in re.finditer(r'パターン\s*((?:\d+[::]\s*)+\d+)\s*[=:]\s*((?:\d+[::]\s*)+\d+)(\(\((.+?)\)\))?', text):
        pats = [int(x) for x in re.findall(r'\d+', m.group(1))]
        rates = [int(x) for x in re.findall(r'\d+', m.group(2))]
        if len(pats) == len(rates) and len(pats) > 1:
            results.append({'patterns': pats, 'rates': rates,
                            'note': m.group(4), 'status': 'verified'})
    # style B: パターン1: 60% / パターン2: 40%
    singles = {}
    for m in re.finditer(r'パターン(\d+)\s*[::]\s*(\d+)\s*%', text):
        singles[int(m.group(1))] = int(m.group(2))
    if len(singles) >= 2 and not results:
        results.append({'patterns': sorted(singles),
                        'rates': [singles[k] for k in sorted(singles)],
                        'note': None, 'status': 'tentative'})
    return results

def phase_of_markers(markers):
    if 'クリア前のみ' in markers:
        return 'beforeClear'
    if 'クリア後のみ' in markers:
        return 'afterClear'
    return None

def node_kind(node_cell_clean):
    for label, key in KIND_MAP:
        if label in node_cell_clean:
            return key
    return 'battle'

def parse_enemy_fold(section, area, source_info, routes):
    lines = [l for l in section.splitlines() if l.startswith('|')]
    header_idx = None
    cols = None
    for i, line in enumerate(lines):
        cells = line.split('|')[1:-1]
        if cells and cells[0].startswith('~出現場所'):
            header_idx = i
            cols = [clean(c).replace('\n', ' ') for c in cells]
            break
    if header_idx is None:
        raise RuntimeError(f'{area}: 敵編成 header row not found')
    colmap = {}
    for idx, name in enumerate(cols):
        if '出現場所' in name:
            colmap['node'] = idx
        elif '司令部' in name:
            colmap['hq'] = idx
        elif 'パターン' in name:
            colmap['pattern'] = idx
        elif 'EXP' in name:
            colmap['exp'] = idx
        elif '出現艦船' in name:
            colmap['ships'] = idx
        elif '陣形' in name:
            colmap['formation'] = idx
        elif '敵制空値' in name:
            colmap['air'] = idx
        elif '優勢' in name:
            colmap['sup'] = idx
        elif '確保' in name:
            colmap['exc'] = idx
        elif '半径' in name:
            colmap['radius'] = idx

    boss_nodes_routes = set(routes.get('bossNodes', []))
    nodes = {}
    order = []
    current = None
    # `~` means "same cell as the row above" in the rendered table and can
    # cross node boundaries (e.g. 6-1 K's first row continues J's formation),
    # so the previous-row state runs across the whole table
    last_pattern = None
    last_air = {'value': None, 'note': None, 'sup': None, 'exc': None}
    for lineno, line in enumerate(lines[header_idx + 1:], start=header_idx + 2):
        cells = line.split('|')[1:-1]
        if not cells or (cells and cells[-1].strip() in ('h', 'c', 'f')):
            continue
        def cell(key):
            i = colmap.get(key)
            return cells[i] if i is not None and i < len(cells) else ''
        node_cell = cell('node')
        if node_cell not in ('', '~'):
            node_clean = clean(node_cell)
            m = re.match(r'([A-Z][0-9]?)[:：](.*)', node_clean, re.S)
            if not m:
                # decoration rows (merged-cell banners like 6-4's 離島棲姫
                # cutscene) are not encounter points
                continue
            node_id = m.group(1)
            body = m.group(2)
            entry = {
                'node': node_id,
                'kind': node_kind(node_clean),
                'kindRaw': node_clean.replace('\n', ' '),
                'fleetName': None,
                'boss': ('ボス' in node_clean) or (node_id in boss_nodes_routes),
                'bossLabel': None,
                'note': None,
                'phases': {},
                'fuelFraction': None,
                'ammoFraction': None,
                'effect': None,
            }
            rates_text = node_cell
            bm = re.search(r'第(\d)ボス', node_clean)
            if bm:
                entry['bossLabel'] = f'第{bm.group(1)}ボス'
            nm = re.search(r'\(\((.+?)\)\)', node_cell)
            if nm:
                entry['note'] = clean(nm.group(1))
            body_lines = [b.strip() for b in body.split('\n') if b.strip()]
            skip_words = ('対潜戦', '夜戦', '空襲戦', '能動分岐', '戦闘なし', 'うずしお',
                          'アイテム獲得', 'ボス', 'ゲージ破壊', '出現率',
                          'パターン', '前"', '後"', 'KCNavi', '集計期間', '母数')
            name_parts = [b for b in body_lines
                          if b and not any(w in b for w in skip_words)
                          and not re.fullmatch(r'[\d:%.?～"\s:]+', b)]
            if name_parts:
                entry['fleetName'] = ' '.join(name_parts)
            rates_all = parse_rates_from_text(node_clean)
            scoped_rates = {}
            if '破壊"前"' in node_clean or '破壊"後"' in node_clean:
                seg_pre = node_clean.split('破壊"後"')[0]
                seg_post = node_clean.split('破壊"後"')[-1] if '破壊"後"' in node_clean else ''
                if '破壊"前"' in node_clean:
                    pre_rates = parse_rates_from_text(seg_pre)
                    if pre_rates:
                        scoped_rates['beforeClear'] = pre_rates[0]
                if '破壊"後"' in node_clean:
                    post_rates = parse_rates_from_text(seg_post)
                    if post_rates:
                        scoped_rates['afterClear'] = post_rates[0]
            elif rates_all and ('破壊後' in node_clean or '破壊前' in node_clean):
                scope = 'beforeClear' if '破壊前' in node_clean else 'afterClear'
                scoped_rates[scope] = rates_all[0]
            nodes[node_id] = entry
            nodes[node_id]['_rates'] = {'scoped': scoped_rates, 'raw': rates_text}
            avail_m = re.search(r'(?:ゲージ消滅後|ゲージ破壊後|クリア後)[はな]パターン(\d+)のみ', node_clean)
            nodes[node_id]['_avail_constraint'] = int(avail_m.group(1)) if avail_m else None
            nodes[node_id]['_row'] = lineno
            order.append(node_id)
            current = node_id
        pattern_cell = clean(cell('pattern')).replace('\n', ' ')
        ships_cell = cell('ships')
        if current is None:
            continue
        # escort fleet continuation row (6-5 boss): pattern=~ but ships present
        if pattern_cell in ('', '~') and ships_cell.strip() and nodes[current]['phases']:
            for phase in nodes[current]['phases'].values():
                if phase['patterns'] and phase['patterns'][-1].get('escortFleet') is None:
                    phase['patterns'][-1]['escortFleet'] = {
                        'enemyShips': parse_ships(ships_cell),
                        'rowRef': lineno,
                        'status': 'verified'}
                    break
            continue
        if pattern_cell == '' and ships_cell.strip():
            effect_raw = clean(ships_cell)
            if effect_raw:
                nodes[current]['effect'] = {'raw': effect_raw}
            continue
        pm = re.search(r'パターン(\d+)', pattern_cell)
        if not pm:
            continue
        pid = int(pm.group(1))
        markers = []
        for mk in re.findall(r"''([^']+)''", cell('pattern')):
            markers.append(clean(mk))
        marker_text = pattern_cell
        final_form = '最終形態' in marker_text
        avail = None
        if 'クリア前のみ' in marker_text:
            avail = 'beforeClear'
        elif 'クリア後のみ' in marker_text:
            avail = 'afterClear'
        elif 'クリア後' in marker_text:
            avail = 'afterClear'
        ships_cell_clean = clean(ships_cell)
        sm = re.search(r'パターン(\d+)と(?:同編成|同じ)', ships_cell_clean)
        if sm:
            ships, same_as = None, int(sm.group(1))
        else:
            ships, same_as = parse_ships(ships_cell), None
        formation_cell = cell('formation')
        if formation_cell.strip() == '~':
            formation = last_pattern['formation'] if last_pattern else None
            formation_status = 'inherited'
        else:
            formation = [f for f in clean(formation_cell).split('\n') if f]
            if formation == ['第三警戒', '航行序列']:
                formation = ['第三警戒航行序列']
            formation_status = 'verified'
        def air_from(key):
            # `~` is column-wise: each column inherits its own previous-row
            # value (air+footnote from air, superiority from superiority...);
            # inheriting the air value into every column produced 24/24/24
            raw = cell(key).strip()
            if raw == '~':
                if key == 'air':
                    return (last_air['value'], last_air['note'], 'inherited')
                return (last_air[key], None, 'inherited')
            if raw == '':
                return (None, None, 'absent')
            fm = re.fullmatch(r"(?:'')?(\d+)(?:'')?(?:\(\((.+)\)\))?", raw)
            if not fm:
                return (raw, None, 'unparsed')
            value, footnote = int(fm.group(1)), fm.group(2)
            note = clean(footnote) if footnote else None
            return (value, note, 'verified')
        air, air_note, air_status = air_from('air')
        sup, _, _ = air_from('sup')
        exc, _, _ = air_from('exc')
        last_air = {'value': air, 'note': air_note, 'sup': sup, 'exc': exc}
        hq = parse_hq_range(cell('hq')) if 'hq' in colmap else None
        radius = None
        if 'radius' in colmap:
            rcell = cell('radius').strip()
            if rcell == '~':
                radius = last_pattern['lbasRadius'] if last_pattern else None
            else:
                radius = parse_int(rcell)
        exp = parse_int(cell('exp'))
        pattern_entry = {
            'pattern': pid,
            'rowRef': lineno,
            'enemyShips': ships if ships else None,
            'sameAsPattern': same_as,
            'formation': formation,
            'formationStatus': formation_status,
            'exp': exp,
            'enemyAirPower': air,
            'enemyAirPowerNote': air_note,
            'airStatus': air_status,
            'airSuperiority': sup,
            'airSupremacy': exc,
            'hqLevelRange': hq,
            'appearanceRate': None,
            'finalForm': final_form or None,
            'availability': avail,
            'lbasRadius': radius,
            'status': 'verified',
        }
        phase_key = 'base'
        if avail in ('beforeClear', 'afterClear') and 'のみ' in marker_text:
            phase_key = avail
        nodes[current]['phases'].setdefault(phase_key, {'patterns': []})['patterns'].append(pattern_entry)
        last_pattern = pattern_entry
    # appearance rates stay node-level with an explicit phase scope taken
    # verbatim from the wiki (破壊"前"/破壊"後"/ゲージ破壊後); mounting them
    # onto whatever phase happens to exist has caused wrong-phase reads
    for entry in nodes.values():
        rates = entry.pop('_rates', None)
        constraint = entry.pop('_avail_constraint', None)
        entry.pop('_row', None)
        if rates and rates['scoped']:
            entry['appearanceRates'] = rates['scoped']
        if constraint is not None:
            for phase in entry['phases'].values():
                for p in phase['patterns']:
                    if p['pattern'] == constraint:
                        p['availability'] = 'afterClear'
                        p['availabilityNote'] = f'节点格记载：該当パターンはゲージ消滅後のみ'
    return nodes, order, cols

def parse_header_info(raw_source, area):
    info = {'operationName': None, 'gauges': [], 'remarksRaw': None,
            'consumptionNotes': [], 'sortieRequirement': None}
    m = re.search(r'\|~作戦名\|(?:>\|)*([^|]+)\|', raw_source)
    if m:
        info['operationName'] = clean(m.group(1))
    rem = re.search(r'\|~備考\|(.*?)\|\n', raw_source, re.S)
    if rem:
        info['remarksRaw'] = clean(rem.group(1))
    for line in raw_source.splitlines():
        if line.startswith('|~&nobr{') and 'ゲージ' in line:
            cells = line.split('|')[1:-1]
            label = clean(cells[0]).replace('~', '').strip()
            label = re.sub(r'&nobr\{(.*?)\};', r'\1', label)
            raw = clean(cells[1])
            info['gauges'].append({'label': label, 'raw': raw})
        elif re.match(r'^\|~(?:第[一二三四1-4]+ゲージ|ゲージ|戦力HPゲージ|戦力ゲージ)\|', line):
            # plain-label forms: 7-2/7-3 第一ゲージ/第二ゲージ, 1-6 裸 ゲージ
            cells = line.split('|')[1:-1]
            info['gauges'].append({'label': clean(cells[0]).lstrip('~'), 'raw': clean(cells[1])})
    for gauge in info['gauges']:
        gm = re.search(r'[(（]([A-Z][0-9]?)マス[)）]', gauge['raw'])
        if gm:
            gauge['bossNode'] = gm.group(1)
        else:
            am = re.search(r'([A-Z][0-9]?)マスに到達', gauge['raw'])
            if am:
                gauge['bossNode'] = am.group(1)
        km = re.search(r'(\d+)回(?:目の到達|の到達|撃沈|破壊|攻略)?で'
                       r'(?:海域)?(?:クリア|ゲージ破壊|ゲージが消滅|消滅)', gauge['raw'])
        if km:
            gauge['killsToClear'] = int(km.group(1))
        tp = re.search(r'TP[~～\s:：]*(\d+)', gauge['raw'])
        if '輸送ゲージ' in gauge['raw']:
            gauge['mechanism'] = 'transport'
            if tp:
                gauge['transportPoints'] = int(tp.group(1))
        elif '撃沈' in gauge['raw'] or '破壊' in gauge['raw']:
            gauge['mechanism'] = 'bossSunk'
        elif '到達' in gauge['raw']:
            gauge['mechanism'] = 'arrival'
    sr = re.search(r'出撃条件[：:]([^\n&]+)', info['remarksRaw'] or '')
    if sr:
        info['sortieRequirement'] = sr.group(1).strip()
    return info

NODE_LIST_RE = r'([A-Z][0-9]?(?:\s*[、]\s*[A-Z][0-9]?)*)'

def normalize_remarks(remarks):
    """Normalize 備考 wording so node lists parse uniformly: strip boss
    annotations (K (ボス)：/G（ボス1）：), unwrap parenthesized lists
    (対潜マス(M)：/空襲マス(D,F,G,I)：) and unify ASCII commas."""
    text = re.sub(r'[(（]\s*ボス\s*\d*\s*[）)]', '', remarks)
    text = re.sub(r'[(（]\s*([A-Z][0-9]?(?:\s*[、,]\s*[A-Z][0-9]?)*)\s*[）)]\s*([：:])',
                  r'\1\2', text)
    return text.replace(',', '、')

CONSUMPTION_PATTERNS = [
    # A、D、F：潜水艦エフェクトあり・燃料8%消費、弾薬消費せず
    (re.compile(NODE_LIST_RE + r'\s*[：:].*?燃料(\d+)(?:～(\d+))?%消費、弾薬消費せず'),
     lambda m: {'nodes': re.findall(r'[A-Z][0-9]?', m.group(1)),
                'fuel': (int(m.group(2)) / 100 if not m.group(3)
                         else {'min': int(m.group(2)) / 100, 'max': int(m.group(3)) / 100}),
                'ammo': 0.0}),
    # J：…燃料弾薬ともに20%消費（対潜/夜戦マス、ボス表記は normalize 去除）
    (re.compile(NODE_LIST_RE + r'\s*[：:].*?燃料弾薬ともに(\d+)%消費'),
     lambda m: {'nodes': re.findall(r'[A-Z][0-9]?', m.group(1)),
                'fuel': int(m.group(2)) / 100, 'ammo': int(m.group(2)) / 100}),
    # G、H：燃料4%、弾薬8%消費
    (re.compile(NODE_LIST_RE + r'\s*[：:]燃料(\d+)%、弾薬(\d+)%消費'),
     lambda m: {'nodes': re.findall(r'[A-Z][0-9]?', m.group(1)),
                'fuel': int(m.group(2)) / 100, 'ammo': int(m.group(3)) / 100}),
]

def apply_consumption(nodes, info):
    # Some enemy tables omit 対潜戦 from the node heading (notably 4-4 E).
    # The remarks explicitly classify them; do not infer battle type merely
    # from a submarine-only formation, since ordinary mixed-battle rules differ.
    raw = info.get('remarksRaw') or ''
    for section in re.finditer(r'対潜マスについて(.*?)(?=・[^\n]*について|$)', raw, re.S):
        for match in re.finditer(NODE_LIST_RE + r'\s*[：:]', section.group(1)):
            for node_id in re.findall(r'[A-Z][0-9]?', match.group(1)):
                entry = nodes.get(node_id)
                if entry and entry.get('kind') == 'battle':
                    entry['kind'] = 'asw'
    remarks = normalize_remarks(info.get('remarksRaw') or '')
    for regex, fn in CONSUMPTION_PATTERNS:
        for m in regex.finditer(remarks):
            hit = fn(m)
            for node_id in hit['nodes']:
                entry = nodes.get(node_id)
                if entry is None:
                    continue
                entry['fuelFraction'] = hit['fuel']
                entry['ammoFraction'] = hit['ammo']
                entry['consumptionSource'] = '備考行'

def validate_nodes(nodes):
    """Automatic checks: `~` inheritance must resolve, and the air line must
    satisfy 優勢=ceil(敵制空x1.5) / 確保=敵制空x3. Deviations are recorded for
    human adjudication (source-internal contradictions are kept as-is)."""
    findings = []
    for node_id, entry in nodes.items():
        for phase_key, phase in entry['phases'].items():
            for p in phase['patterns']:
                if p.get('formationStatus') == 'inherited' and not p.get('formation'):
                    findings.append({'severity': 'error', 'kind': 'inheritanceGap',
                                     'node': node_id, 'pattern': p['pattern'],
                                     'field': 'formation',
                                     'message': '`~` 继承未能解析出上一行阵形'})
                if p.get('airStatus') == 'inherited' and p.get('enemyAirPower') is None:
                    findings.append({'severity': 'error', 'kind': 'inheritanceGap',
                                     'node': node_id, 'pattern': p['pattern'],
                                     'field': 'enemyAirPower',
                                     'message': '`~` 继承未能解析出上一行制空值'})
                air = p.get('enemyAirPower')
                if isinstance(air, int):
                    if p.get('airSuperiority') is not None:
                        expected = -(-air * 3 // 2)  # ceil(1.5x)
                        if p['airSuperiority'] != expected:
                            findings.append({
                                'severity': 'sourceConflict', 'kind': 'airLineInconsistency',
                                'node': node_id, 'pattern': p['pattern'],
                                'field': 'airSuperiority',
                                'recorded': p['airSuperiority'], 'expected': expected,
                                'enemyAirPower': air,
                                'message': (f"空优线 {p['airSuperiority']} 与敌制空 {air}×1.5="
                                            f"{expected} 不符；保留原值并标注，待核查")})
                    if p.get('airSupremacy') is not None:
                        expected = air * 3
                        if p['airSupremacy'] != expected:
                            findings.append({
                                'severity': 'sourceConflict', 'kind': 'airLineInconsistency',
                                'node': node_id, 'pattern': p['pattern'],
                                'field': 'airSupremacy',
                                'recorded': p['airSupremacy'], 'expected': expected,
                                'enemyAirPower': air,
                                'message': (f"空确线 {p['airSupremacy']} 与敌制空 {air}×3="
                                            f"{expected} 不符；保留原值并标注，待核查")})
    return findings

def graph_nodes(routes):
    found = set()
    for b in routes.get('branchPoints', []):
        found.add(b['from'])
        found.update(b['destinations'])
    for src, dst in routes.get('fixedEdges', {}).items():
        found.add(src)
        if isinstance(dst, str):
            found.add(dst)
    found.update(routes.get('bossNodes', []))
    found.update(routes.get('terminalNodes', []))
    found.update(routes.get('deadEnds', []))
    return sorted(found)

def main():
    areas = sys.argv[1:] or ['1-5', '2-5', '5-5', '6-5', '7-5']
    OUT.mkdir(parents=True, exist_ok=True)
    for area in areas:
        staged = json.loads((STAGED / f'{area}.json').read_text(encoding='utf-8'))
        routes = json.loads((ROUTES / f'{area}.json').read_text(encoding='utf-8'))
        section = staged['folds']['敵編成']['section']
        nodes, order, cols = parse_enemy_fold(section, area, staged, routes)
        info = parse_header_info(staged['rawSource'], area)
        apply_consumption(nodes, info)
        validation = validate_nodes(nodes)
        gauge_lines = [l for l in staged['rawSource'].splitlines()
                       if re.match(r'^\|~(?:&nobr\{)?(?:第[一二三四1-4]+ゲージ|ゲージ|戦力HPゲージ|戦力ゲージ)', l)]
        if gauge_lines and not info['gauges']:
            validation.append({'severity': 'error', 'kind': 'gaugeMissing',
                               'message': f'原表有 {len(gauge_lines)} 行血条记录但解析为空'})
        # single-boss maps: a gauge row without a node reference targets the
        # one boss; multi-gauge maps keep the node parsed from the wiki row
        route_bosses = routes.get('bossNodes', [])
        for gauge in info['gauges']:
            if gauge.get('bossNode'):
                gauge['bossNodeSource'] = 'wiki血条行'
            elif len(route_bosses) == 1:
                gauge['bossNode'] = route_bosses[0]
                gauge['bossNodeSource'] = 'normal_routes唯一bossNodes回退'
        covered = sorted(nodes)
        graph = graph_nodes(routes)
        result = {
            'area': area,
            'schemaVersion': 2,
            'source': {
                'url': staged['url'],
                'sourceUrl': staged['sourceUrl'],
                'retrievedAt': staged['retrievedAt'],
                'sha256': staged['sha256'],
                'enemySectionSha256': staged['folds']['敵編成']['sha256'],
                'tableColumns': cols,
            },
            'operationName': info['operationName'],
            'gauges': info['gauges'],
            'sortieRequirement': info['sortieRequirement'],
            'remarksRaw': info['remarksRaw'],
            'bossNodes': routes.get('bossNodes', []),
            'nodes': {k: nodes[k] for k in sorted(nodes)},
            'validation': validation,
            'coverageCheck': {
                'graphNodes': graph,
                'coveredNodes': covered,
                # routing graphs may phase-alias a node as X#gaugeN; the
                # enemy table lists it once as X, so compare base letters
                'missingInEnemyTable': [n for n in graph
                                        if n != 'start' and n.split('#')[0] not in nodes],
                'notInGraph': [n for n in covered if n not in graph],
            },
        }
        target = OUT / f'{area}.json'
        target.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
        issues = [v for v in validation if v['severity'] == 'error']
        flagged = [v for v in validation if v['severity'] == 'sourceConflict']
        print(f'{area}: nodes={len(nodes)} order={".".join(sorted(nodes))} '
              f'patterns={sum(len(p["patterns"]) for e in nodes.values() for p in e["phases"].values())} '
              f'missing={result["coverageCheck"]["missingInEnemyTable"]} '
              f'notInGraph={result["coverageCheck"]["notInGraph"]} '
              f'validationErrors={len(issues)} airLineFlags={len(flagged)}')
        for v in flagged:
            print(f'  AIRLINE {v["node"]}/P{v["pattern"]}: {v["message"]}')

if __name__ == '__main__':
    main()
