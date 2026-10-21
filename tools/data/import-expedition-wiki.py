"""Import expedition facts from WikiWiki; full source archives stay outside the project.

python tools/data/import-expedition-wiki.py --source-dir <external-folder> --fetch --write
Without --write, print a comparison and leave runtime data unchanged.
"""
import argparse
import datetime
from decimal import Decimal
import hashlib
import html
import json
import pathlib
import re
import unicodedata
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGES = {'expeditions': '遠征', 'expedition-details': '遠征/詳細一覧表',
         'special-landing-craft': '特大発動艇', 'marriage': 'ケッコンカッコカリ'}
BASES = {'A': 99, 'B': 109, 'C': 120, 'D': 130, 'E': 140}
RESOURCES = ['燃料', '弾薬', '鋼材', 'ボーキサイト']
ITEMS = {'大発動艇': 68, '特大発動艇': 193, '大発動艇(八九式中戦車＆陸戦隊)': 166,
         '特二式内火艇': 167, '装甲艇(AB艇)': 408, '武装大発': 409,
         '大発動艇(II号戦車／北アフリカ仕様)': 436, '特大発動艇＋一式砲戦車': 449,
         '特四式内火艇': 525, '特四式内火艇改': 526, '大発動艇(R35＆フランス兵)': 576}


def mission_id(label):
    return int(label) if label.isdigit() else BASES[label[0]] + int(label[1:])


def plain(text):
    text = re.sub(r'%%.*?%%', '', text)
    text = re.sub(r'&(?:color|size)\([^)]*\)\{(.*?)\};', r'\1', text)
    return text.replace("''", '').replace('&br;', ' ')


def parse_details(source):
    headers = list(re.finditer(r'^\|([A-E]\d+|\d+)\|[^\n]*', source, re.M))
    records = {}
    for index, header in enumerate(headers):
        label = header[1]
        block = source[header.end():headers[index + 1].start() if index + 1 < len(headers) else len(source)]
        if label in ('33', '34'):
            records[mission_id(label)] = {'resources': [0, 0, 0, 0], 'wikiId': label}
            continue
        levels = next((line for line in block.splitlines() if line.startswith('|~|~|Lv')), None)
        condition = next((line for line in block.splitlines() if line.startswith('|~|~|~|')), None)
        if not levels or not condition:
            raise ValueError(f'{label}: missing reward/condition row')
        lv = [int(n) for n in re.findall(r'Lv(\d+)', levels)]
        count = re.search(r'(?:最低|全)(\d+)隻', condition)
        if not count:
            raise ValueError(f'{label}: missing minimum ship count')
        resources = []
        for resource in RESOURCES:
            if re.search(resource + r'×[\d,]+[～〜~-]', plain(levels)):
                raise ValueError(f'{label}: resource reward is not a fixed amount')
            value = re.search(resource + r'×([\d,]+)', plain(levels))
            resources.append(int(value[1].replace(',', '')) if value else 0)
        record = {'resources': resources, 'wikiId': label, 'flagshipLevel': lv[0], 'shipCount': int(count[1])}
        if len(lv) > 1:
            record['levelSum'] = lv[1]
        totals = {key: int(found[1]) for name, key in [('火力', 'firepower'), ('対空', 'antiAir'),
                                                    ('対潜', 'asw'), ('索敵', 'los')]
                  if (found := re.search(name + r'(\d+)', plain(condition)))}
        if totals:
            record['totals'] = totals
        mid = mission_id(label)
        if mid in records:
            raise ValueError(f'{label}: duplicate expedition')
        records[mid] = record
    if not records:
        raise ValueError('No expedition records')
    return records


def parse_great_success(source, records):
    section = re.split(r'^\*\*[^*]', source.split('**成功条件・大成功条件 [#success]', 1)[1], maxsplit=1, flags=re.M)[0]
    drum_section = section.split('|~ID|~遠征名|~必要キラ隻数', 1)[1].split('※', 1)[0]
    drum = {}
    for line in drum_section.splitlines():
        match = re.match(r'^\|BGCOLOR\([^)]+\):([A-E]\d+|\d+)\|.*?\|(\d+)\|(\d+)\|(\d+)\|$', line)
        if match:
            label, _, carriers, count = match.groups()
            drum[mission_id(label)] = (int(carriers), int(count))
    table = section.split('|0隻|', 1)[1].split('「必要数2」', 1)[0]
    rows = ['|0隻|' + table.splitlines()[0], *table.splitlines()[1:]]
    probabilities = []
    for line in rows:
        match = re.match(r'^\|(\d+)隻\|(?:BGCOLOR\([^)]+\):)?(\d+)%\|(?:BGCOLOR\([^)]+\):)?(\d+)%\|', line)
        if match:
            probabilities.append([int(n) for n in match.groups()])
    if [row[0] for row in probabilities] != list(range(7)) or len(drum) != 7:
        raise ValueError('Incomplete great-success drum reference tables')
    flag_section = section.split('この条件が適用される、または適用される可能性がある遠征は以下', 1)[1]
    flag_section = flag_section.split('-帰投時', 1)[0]
    flagship = {mission_id(label) for label in re.findall(r'>#id([A-E]\d+|\d+)\]\]', flag_section)}
    if not flagship or '16 + 15 ×' not in section:
        raise ValueError('Missing flagship-level probability reference')
    kinds = {}
    for mid, record in records.items():
        if mid in drum:
            carriers, count = drum[mid]
            kinds[mid] = {'kind': 'drum', 'max': count, 'extraDrums': count, 'carriers': carriers}
        else:
            kinds[mid] = {'kind': 'flagship' if mid in flagship else 'sparkled'}
    return kinds, {'ordinary': {'basePercent': 20, 'perSparkledPercent': 15,
                               'basis': 'Linear reference consistent with Wiki approximate 80% / 95% for four / five all-sparkled ships; six ships guarantee great success.'},
                   'drum': {'minimum': [r[1] for r in probabilities], 'full': [r[2] for r in probabilities]},
                   'flagship': {'basePercent': 16, 'perSparkledPercent': 15, 'sqrtLevelFactor': 1, 'linearLevelFactor': 0.1}}


def parse_reward_rules(source, special):
    section = source.split('*大発動艇関連 [#daihatsu]', 1)[1].split('**小型艦', 1)[0]
    names = {unicodedata.normalize('NFKC', name): mid for name, mid in ITEMS.items()}
    rates = {}
    for line in section.splitlines():
        cells = line.split('|')
        if len(cells) < 5 or not re.fullmatch(r'\+(\d+)%', cells[3]):
            continue
        percent = int(cells[3][1:-1])
        for name in re.findall(r'\[\[([^\]>]+)(?:>[^\]]+)?\]\]', cells[2]):
            mid = names.get(unicodedata.normalize('NFKC', name))
            if mid is not None:
                rates[str(mid)] = percent / 100
    if len(rates) != len(ITEMS):
        raise ValueError(f'Missing reward equipment: {set(ITEMS.values()) - set(map(int, rates))}')
    table = special.split('|~　|~大発+0|', 1)[1].split('--遠征報酬', 1)[0]
    synergy = [[0] * 5]
    for line in table.splitlines():
        if not line.startswith('|~特大発'):
            continue
        values = [float(Decimal(n) / 100) for n in re.findall(r'([\d.]+)%', line)]
        if len(values) == 1:
            values *= 5
        if len(values) != 5:
            raise ValueError('Unexpected special landing-craft synergy row')
        synergy.append(values)
    if len(synergy) != 5 or '基本値+20%上限' not in section or '0.01×' not in section:
        raise ValueError('Incomplete reward bonus formula')
    return {'equipmentRates': rates, 'innateShipRates': {'487': 0.05}, 'baseCap': 0.2,
            'improvementFactor': 0.01, 'specialSynergy': synergy,
            'marriageSupplyFactor': 0.85, 'rounding': 'Floor ordinary-plus-improvement rewards and special synergy rewards separately, then add.'}


def fetch_sources(folder):
    folder.mkdir(parents=True, exist_ok=True)
    for name, page in PAGES.items():
        url = 'https://wikiwiki.jp/kancolle/::cmd/source?page=' + urllib.parse.quote(page, safe='')
        request = urllib.request.Request(url, headers={'User-Agent': 'Fleet Advisor expedition rules research/1.0'})
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode('utf-8')
        match = re.search(r'<pre id="source"[^>]*><code>(.*?)</code></pre>', body, re.S)
        if not match:
            raise ValueError(f'{page}: missing Wiki source')
        raw = html.unescape(match[1])
        value = {'page': page, 'url': 'https://wikiwiki.jp/kancolle/' + urllib.parse.quote(page),
                 'sourceUrl': url, 'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
                 'sha256': hashlib.sha256(raw.encode()).hexdigest(), 'rawSource': raw}
        (folder / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def serialized(value, original, preserved_key, indent):
    """Keep unrelated hand-formatted reference sections byte-for-byte."""
    text = json.dumps(value, ensure_ascii=False, indent=indent) + '\n'

    def bounds(content):
        start = content.index(':', content.index('"' + preserved_key + '"')) + 1
        while content[start].isspace():
            start += 1
        _, length = json.JSONDecoder().raw_decode(content[start:])
        return start, start + length

    left, right = bounds(text)
    old_left, old_right = bounds(original)
    return text[:left] + original[old_left:old_right] + text[right:]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=pathlib.Path, required=True)
    parser.add_argument('--fetch', action='store_true')
    parser.add_argument('--write', action='store_true')
    args = parser.parse_args()
    if args.source_dir.resolve().is_relative_to(ROOT):
        parser.error('Full Wiki source archives must be outside the project')
    if args.fetch:
        fetch_sources(args.source_dir)
    pages = {name: json.loads((args.source_dir / (name + '.json')).read_text(encoding='utf-8')) for name in PAGES}
    for name, page in pages.items():
        if page['page'] != PAGES[name] or hashlib.sha256(page['rawSource'].encode()).hexdigest() != page['sha256']:
            raise ValueError(f'{name}: source identity/hash mismatch')
    records = parse_details(pages['expedition-details']['rawSource'])
    gs, probabilities = parse_great_success(pages['expeditions']['rawSource'], records)
    rules = parse_reward_rules(pages['expeditions']['rawSource'], pages['special-landing-craft']['rawSource'])
    if '0.85' not in pages['marriage']['rawSource']:
        raise ValueError('Missing marriage supply reference')
    rewards_path, requirements_path = (ROOT / 'data' / f'expedition_{name}.json' for name in ['rewards', 'requirements'])
    original_rewards = rewards_path.read_text(encoding='utf-8')
    original_requirements = requirements_path.read_text(encoding='utf-8')
    old_rewards = json.loads(original_rewards)
    requirements = json.loads(original_requirements)
    if set(records) != set(map(int, requirements['missions'])):
        raise ValueError('Wiki mission catalog differs; review additions/removals before importing')
    sources = [{key: page[key] for key in ['page', 'url', 'retrievedAt', 'sha256']} for page in pages.values()]
    rewards = {'source': 'WikiWiki expedition rewards and mechanics', 'url': pages['expeditions']['url'],
               'sources': sources, 'rules': {**rules, 'greatSuccess': probabilities},
               'missions': {str(mid): {key: record[key] for key in ['resources', 'wikiId']} for mid, record in sorted(records.items())},
               'incomeReference': old_rewards['incomeReference']}
    differences = []
    for mid, record in records.items():
        key = str(mid)
        if old_rewards['missions'][key]['resources'] != record['resources']:
            differences.append({'missionId': mid, 'resourcesBefore': old_rewards['missions'][key]['resources'], 'resourcesAfter': record['resources']})
        spec = requirements['missions'][key]
        for field in ['flagshipLevel', 'shipCount', 'levelSum', 'totals']:
            if field in record:
                if spec.get(field) != record[field]:
                    differences.append({'missionId': mid, 'field': field, 'before': spec.get(field), 'after': record[field]})
                spec[field] = record[field]
        kinds = gs[mid]
        if kinds['kind'] == 'drum':
            kinds['min'] = spec.get('drums', 0)
        spec['gs'] = kinds
    requirements.update(source='WikiWiki expedition conditions and great-success references', sources=sources[:2])
    requirements.pop('generated', None)
    requirements['checked'] = pages['expeditions']['retrievedAt'][:10]
    requirements['notes']['gs'] = {'drum': 'Wiki theoretical reference table; min=dispatch drum minimum, max/extraDrums/carriers=great-success table.',
                                  'flagship': 'Wiki estimate: 16 + 15*sparkled + sqrt(flagship level) + flagship level/10.',
                                  'sparkled': 'All ships sparkled; Wiki approximate 80% / 95% at four / five ships, 100% at six.'}
    if args.write:
        rewards_path.write_text(serialized(rewards, original_rewards, 'incomeReference', 2), encoding='utf-8', newline='\n')
        requirements_path.write_text(serialized(requirements, original_requirements, 'unlocks', 1), encoding='utf-8', newline='\n')
    print(json.dumps({'missions': len(records), 'written': args.write, 'differences': differences}, ensure_ascii=False))


if __name__ == '__main__':
    main()
