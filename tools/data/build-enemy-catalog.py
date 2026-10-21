"""Build data/sortie/enemy_catalog.json from staged wikiwiki enemy pages.

Combines three staged sources:
- tmp/sortie_sources/enemies/pages/*.json (wikiwiki individual pages; carry
  the api id as No.xxxx plus hull type, stats and equipment slots)
- tmp/sortie_sources/enemies/wikiwiki_enemy_ships.json (air power table)
- tmp/sortie_sources/enemies/kcwiki_template_shinkai_banner.json (api id ->
  ja/zh name mapping used to verify the wikiwiki ids)

Multi-variant pages (several No.xxxx blocks on one page) become one catalog
entry per block; the anchor it came from is kept for traceability.
"""
import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

PAGES = ROOT.parent / 'tmp/sortie_sources/enemies/pages'
ENEMIES = ROOT.parent / 'tmp/sortie_sources/enemies'
OUT = ROOT / 'data/sortie/enemy_catalog.json'

def clean(text):
    text = re.sub(r'&color\([^)]*\)\{(.*?)\};', r'\1', text)
    text = re.sub(r'\(\((.+?)\)\)', '', text)
    text = text.replace("'''", '').replace("''", '')
    text = text.replace('&br;', '\n').replace('&size(11){', '').replace('&color(gray){', '')
    return text.replace('};', '').strip()

def stat_num(cell):
    cell = clean(cell)
    m = re.fullmatch(r'(-?\d+)(?:\s*/\s*(-?\d+))?', cell)
    if not m:
        return None
    value = int(m.group(1))
    return [value, int(m.group(2))] if m.group(2) else value

def parse_page(record):
    """Return catalog blocks found on one enemy page."""
    src = record['rawSource']
    blocks = []
    positions = [(m.start(), int(m.group(1))) for m in re.finditer(r'~No\.(\d+)', src)]
    for i, (pos, no) in enumerate(positions):
        end = positions[i + 1][0] if i + 1 < len(positions) else len(src)
        seg = src[pos:end]
        head = src[max(0, pos - 400):pos]
        name = None
        ship_type = None
        nm = re.search(r'\|&(?:attachref|ref)\([^)]*\)[^|]*\|>\|([^|]+)\|>\|([^|]+)\|', seg)
        if nm:
            name = clean(nm.group(1))
            ship_type = clean(nm.group(2))
        variant_label = None
        vm = None
        for m in re.finditer(r'\(No\.%d\)[ 	　]*(.*)$' % no, head, re.M):
            vm = m
        if vm is not None:
            variant_label = clean(vm.group(1)) or None
        anchor = None
        am = None
        for m in re.finditer(r'[#&]aname\(([^)]+)\)', head):
            am = m
        if am is not None:
            anchor = am.group(1)
        stats = {}
        for sm in re.finditer(r'\|~\|~([^|]+)\|([^|]*)\|~([^|]+)\|([^|]*)\|', seg):
            left_label, left_val, right_label, right_val = (clean(sm.group(1)), sm.group(2),
                                                            clean(sm.group(3)), sm.group(4))
            for label, value in ((left_label, left_val), (right_label, right_val)):
                if label in ('耐久', '装甲', '雷装', '搭載', '対空', '加重対空値', '火力'):
                    stats[label] = stat_num(value)
                elif label in ('速力', '射程'):
                    stats[label] = clean(value)
                elif label.startswith('艦隊対空'):
                    stats['艦隊対空ボーナス'] = stat_num(value)
        own_air = None
        om = re.search(r'\|~\|~制空値\|>\|>\|(\d+)\|', seg)
        if om:
            own_air = int(om.group(1))
        equipment = []
        for em in re.finditer(r'\|~\|(?:(\d+)\|)?>\|>\|(?:>\|)?([^|]+)\|', seg):
            capacity = int(em.group(1)) if em.group(1) else None
            raw = em.group(2).strip()
            link = re.fullmatch(r'\[\[(.+?)>([^\]]+)\]\]', raw)
            if link:
                equipment.append({'name': clean(link.group(1)),
                                  'wikiAnchor': link.group(2).split('#')[-1],
                                  'slotCapacity': capacity})
            elif '未装備' in raw:
                equipment.append({'name': None, 'slotCapacity': capacity})
            elif '装備不可' in raw:
                equipment.append({'notEquippable': True})
        evolution = None
        vm2 = re.search(r"''(.+?)''\s*→", seg)
        if vm2:
            evolution = clean(seg[vm2.start():seg.find('\n', vm2.start())])
        blocks.append({
            'name': name,
            'variantLabel': variant_label,
            'apiId': no,
            'shipType': ship_type,
            'stats': {k: v for k, v in stats.items() if v is not None},
            'ownAirPower': own_air,
            'equipment': equipment,
            'anchor': anchor,
            'evolution': evolution,
            'sourcePage': record['page'],
        })
    return blocks

def load_air_table():
    record = json.loads((ENEMIES / 'wikiwiki_enemy_ships.json').read_text(encoding='utf-8'))
    table = {}
    for line in record['rawSource'].splitlines():
        m = re.fullmatch(r'\|([^|]+)\|(\d+)\|', line.strip())
        if m:
            key = clean(m.group(1)).replace(' ', '')
            table[key] = int(m.group(2))
    return table, record


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

def load_banner_map():
    record = json.loads((ENEMIES / 'kcwiki_template_shinkai_banner.json').read_text(encoding='utf-8'))
    id2ja = {}
    id2zh = {}
    for sid, zh, ja in _banner_entries(record['rawSource']):
        id2ja[sid] = ja
        id2zh[sid] = zh
    return id2ja, id2zh, record

JA_TO_SIMP = str.maketrans({'級': '级', '軽': '轻', '戦': '战', '駆': '驱', '縦': '纵',
                            '単': '单', '複': '复', '輪': '轮', '姫': '姬', '棲': '栖',
                            '艦': '舰', '機': '机', '壊': '坏', '後': '后', '改': '改',
                            '輸': '输', '潜': '潜', '母': '母'})

GRADE_TOKENS = {'elite', 'flagship', '改', '後期型', '改二'}

def names_agree(wiki_name, wiki_variant, banner_ja):
    def base(text):
        text = re.sub(r'[（(][^）)]*[）)]', '', text)
        text = text.split('　')[0]
        parts = text.split(' ')
        if len(parts) > 1:
            grade = ''.join(t for t in parts[1:] if t in GRADE_TOKENS)
            text = parts[0] + grade
        return text.replace(' ', '')
    letter = None
    if wiki_variant:
        lm = re.search(r'\(([A-Z])\)', wiki_variant)
        if lm:
            letter = lm.group(1)
    simp = lambda t: base(t).translate(JA_TO_SIMP)
    return simp(wiki_name) == simp(banner_ja) or (
        letter is not None and simp(wiki_name + letter) == simp(banner_ja))

def main():
    air_table, air_record = load_air_table()
    id2ja, id2zh, banner_record = load_banner_map()
    enemies = []
    page_sources = {}
    unresolved = []
    for path in sorted(PAGES.glob('*.json')):
        record = json.loads(path.read_text(encoding='utf-8'))
        page_sources[record['page']] = {
            'url': record['url'], 'retrievedAt': record['retrievedAt'],
            'sha256': record['sha256']}
        for block in parse_page(record):
            banner_ja = id2ja.get(str(block['apiId']))
            id_status = 'verified'
            if banner_ja is None:
                id_status = 'wikiwikiOnly'
            elif block['name'] and not names_agree(block['name'], block['variantLabel'], banner_ja):
                id_status = 'nameDisagreement'
            lookup_name = (block['name'] or '').replace(' ', '')
            air = block['ownAirPower']
            air_source = 'enemy page 制空値 row' if air is not None else None
            if air is None and lookup_name:
                air = air_table.get(lookup_name)
                air_source = '敵艦船 制空値一覧' if air is not None else None
            if air is None and block['variantLabel']:
                air = air_table.get(lookup_name + block['variantLabel'].split('　')[0])
                air_source = '敵艦船 制空値一覧(变体行)' if air is not None else None
            enemies.append({
                'name': block['name'],
                'variantLabel': block['variantLabel'],
                'apiId': block['apiId'],
                'apiIdStatus': id_status,
                'kcwikiNameJa': banner_ja,
                'kcwikiNameZh': id2zh.get(str(block['apiId'])),
                'shipType': block['shipType'],
                'stats': block['stats'],
                'equipment': block['equipment'],
                'enemyAirPower': air,
                'enemyAirPowerSource': air_source,
                'evolution': block['evolution'],
                'sourcePage': block['sourcePage'],
                'anchor': block['anchor'],
            })
    ids = [e['apiId'] for e in enemies]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    catalog = {
        'schemaVersion': 1,
        'generatedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'scope': ('enemies appearing on encounter maps parsed so far; derived from '
                  'tmp/sortie_sources/enemies/pages/'),
        'sources': {
            'wikiwikiEnemyPages': page_sources,
            'wikiwikiAirPowerTable': {
                'url': air_record['url'], 'retrievedAt': air_record['retrievedAt'],
                'sha256': air_record['sha256']},
            'kcwikiBannerTemplate': {
                'url': banner_record['url'], 'retrievedAt': banner_record['retrievedAt'],
                'sha256': banner_record['sha256']},
        },
        'airPowerTable': air_table,
        'idNameMap': {sid: {'ja': ja, 'zh': id2zh[sid]} for sid, ja in id2ja.items()},
        'enemies': sorted(enemies, key=lambda e: e['apiId']),
        'duplicateApiIds': dupes,
        'unresolved': unresolved,
    }
    junk = re.compile(r'[<>\[\]{=]|&\w+;|hfBox|文件|�')
    bad_names = []
    for sid, entry in catalog['idNameMap'].items():
        for key in ('ja', 'zh'):
            if entry.get(key) and junk.search(entry[key]):
                bad_names.append((sid, key, entry[key][:60]))
    for e in enemies:
        for key in ('name', 'kcwikiNameJa', 'kcwikiNameZh', 'shipType'):
            if e.get(key) and junk.search(e[key]):
                bad_names.append((e['apiId'], key, e[key][:60]))
        for eq in (e.get('equipment') or []):
            if eq.get('name') and junk.search(eq['name']):
                bad_names.append((e['apiId'], 'equipment', eq['name'][:60]))
    if bad_names:
        for b in bad_names:
            print('JUNK', b, file=sys.stderr)
        raise SystemExit(f'name hygiene check failed: {len(bad_names)} garbled fields')
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'catalog entries: {len(enemies)}, duplicate ids: {dupes}')
    for status in ('verified', 'wikiwikiOnly', 'nameDisagreement'):
        count = sum(1 for e in enemies if e['apiIdStatus'] == status)
        print(f'  {status}: {count}')
    for e in enemies:
        if e['apiIdStatus'] == 'nameDisagreement':
            print('  name conflict:', e['apiId'], e['name'], '<>', e['kcwikiNameJa'])

if __name__ == '__main__':
    main()
