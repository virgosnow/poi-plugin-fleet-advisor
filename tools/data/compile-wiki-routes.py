"""Compile staged wikiwiki branching tables into one JSON file per map.

The table sentences remain evidence, not executable rules. Exact evaluators
must be reviewed separately and never inferred from ambiguous prose.
"""
import html
import json
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]
STAGED = ROOT.parent / 'tmp' / 'wiki_branches'
OUT = ROOT / 'data' / 'normal_routes'
BOSS_CORRECTIONS = {'6-2': ['K']}  # wiki enemy table omits the ボス marker; branching/tactics identify K.

def clean_clause(value):
    value = html.unescape(value).replace("''", '').replace('%%%', '')
    value = re.sub(r'\[\[([^\]>]+)>[^\]]+\]\]', r'\1', value)
    value = re.sub(r'\[\[([^\]]+)\]\]', r'\1', value)
    for _ in range(4):
        value = re.sub(r'&(?:color|size)\([^)]*\)\{([^{}]*)\};', r'\1', value)
    value = re.sub(r'\(\(https?://[^)]*\)\)', '', value)
    return value.strip()

def parse_section(section):
    points = []
    current = None
    phase = None
    for raw in section.splitlines():
        if '#fold(戦力ゲージ1' in raw:
            phase = 'gauge1'
        elif '#fold(戦力ゲージ2' in raw:
            phase = 'gauge2'
        if not raw.startswith('|') or raw.startswith('//'):
            continue
        cells = raw.strip('|').split('|')
        if len(cells) < 3:
            continue
        source, destination, rule = cells[:3]
        source = source.removeprefix('~')
        destination = destination.removeprefix('~')
        if source == '':
            if current is not None and re.fullmatch(r'[A-Z][0-9]?', destination):
                current['destinations'].append(destination)
            continue
        if not (source == '出撃' or re.fullmatch(r'[A-Z][0-9]?', source)):
            continue
        if not re.fullmatch(r'[A-Z][0-9]?', destination):
            continue
        current = {'from': 'start' if source == '出撃' else source,
                   'destinations': [destination],
                   'clauses': [s for part in rule.split('&br;') if (s := clean_clause(part))]}
        if phase:
            current['phase'] = phase
        points.append(current)
    return points

def trivial_machine_rules(points):
    rules = {}
    for point in points:
        clauses = point['clauses']
        destinations = point['destinations']
        if len(destinations) == 1 and clauses == ['固定']:
            rules[point['from']] = [{'when': True, 'to': destinations[0]}]
        elif len(destinations) == 2 and len(clauses) == 1 and clauses[0] in (
                'ランダム（片寄りなし）', 'ランダム(片寄りなし)'):
            rules[point['from']] = [{'when': True, 'choices': [
                {'to': destination, 'weight': 0.5} for destination in destinations]}]
    return rules


def graph_issues(data):
    """Reject only structural contradictions; uncertain nodes stay explicit."""
    points = data['branchPoints']
    exits = {destination for point in points for destination in point['destinations']}
    defined = ({point['from'] for point in points}
               | set(data.get('fixedEdges', {})) | set(data.get('deadEnds', []))
               | set(data['bossNodes']) | set(data['terminalNodes'])
               | set(data.get('unresolvedNodes', [])))
    issues = [f'{node}: no outgoing definition' for node in sorted(exits - defined)]
    for key, rules in data['machineRules'].items():
        node, _, phase = key.partition('#')
        matching = [point for point in points if point['from'] == node
                    and (not phase or point.get('phase') == phase)]
        if not matching:
            issues.append(f'{key}: no branch point')
            continue
        allowed = {dest for point in matching for dest in point['destinations']}
        actual = {rule['to'] for rule in rules if 'to' in rule}
        actual.update(choice['to'] for rule in rules for choice in rule.get('choices', []))
        if actual - allowed:
            issues.append(f'{key}: rule exits outside source table {sorted(actual - allowed)}')
    for key, destination in data.get('fixedEdges', {}).items():
        for rule in data['machineRules'].get(key, []):
            actual = ({rule['to']} if 'to' in rule else
                      {choice['to'] for choice in rule.get('choices', [])})
            if actual - {destination}:
                issues.append(f'{key}: fixed edge conflicts with machine rules')
                break
    return issues

def main():
    OUT.mkdir(exist_ok=True)
    for file in sorted(STAGED.glob('*.json')):
        staged = json.loads(file.read_text(encoding='utf-8'))
        area = staged['area']
        points = parse_section(staged['section'])
        if not points:
            print('EMPTY', area)
            continue
        result = {'area': area,
                  'source': {'url': staged['url'], 'branchSectionSha256': staged['sha256']},
                  'bossNodes': BOSS_CORRECTIONS.get(area, staged.get('bossNodes', [])),
                  'terminalNodes': staged.get('terminalNodes', []),
                  'branchPoints': points,
                  'evaluation': 'partial' if trivial_machine_rules(points) else 'source-text-only',
                  'machineRules': trivial_machine_rules(points)}
        prior_file = OUT / f'{area}.json'
        if prior_file.exists():
            prior = json.loads(prior_file.read_text(encoding='utf-8'))
            # A wikiwiki refresh is supplemental once the user has selected
            # an NGA snapshot. Never silently replace its clauses or provenance.
            if prior.get('source', {}).get('authority') == 'nga-16820397':
                print('KEEP NGA PRIMARY', area)
                continue
            for key in ('machineRules', 'bossPhases', 'reviewNotes', 'airControl',
                        'graphComplete', 'fixedEdges', 'deadEnds',
                        'unresolvedNodes', 'unavailableByPhase',
                        'uncertainAvailabilityByPhase'):
                if key in prior:
                    result[key] = {**result['machineRules'], **prior[key]} if key == 'machineRules' else prior[key]
            # Some map nodes were supplied from verified route examples rather
            # than the wiki's branching table (e.g. 4-2 B). Preserve them.
            parsed_keys = {(point['from'], point.get('phase')) for point in points}
            result['branchPoints'].extend(point for point in prior['branchPoints']
                                          if (point['from'], point.get('phase')) not in parsed_keys)
            source_changed = (prior['source'].get('branchSectionSha256') != staged['sha256'])
            issues = graph_issues(result)
            if prior.get('evaluation') == 'reviewed' and not source_changed and not issues:
                result['evaluation'] = 'reviewed'
            else:
                result['graphComplete'] = False
                if prior.get('evaluation') == 'reviewed':
                    result['evaluation'] = 'partial'
                if source_changed:
                    print('REVIEW NEEDED', area, 'source SHA changed')
                for issue in issues:
                    print('REVIEW NEEDED', area, issue)
        (OUT / f'{area}.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(area, 'points', len(points), 'exits', sum(len(p['destinations']) for p in points),
              'boss', ','.join(result['bossNodes']) or '-')

if __name__ == '__main__':
    main()
