"""Pipeline runner and quality gate for sortie encounter data.

Runs parse -> backfill -> crosscheck -> report, then enforces the gate
classes agreed for batch expansion:
  1. `~` inheritance gaps (formation / air columns) must be zero.
  2. Node coverage, both directions: every routing-graph node (except the
     virtual start) must appear in the enemy table, and enemy-table nodes
     missing from the routing graph must be ledger-acknowledged.
  3. Enemy api-id back-fill must fully resolve (no unknown/ambiguous ships).
  4. Appearance rates must be node-level with an explicit phase scope; the
     legacy phase-mounted form is rejected.
  5. Air-line self-consistency: 優勢=ceil(敵制空x1.5), 確保=敵制空x3. Any
     deviation must be acknowledged in the adjudication ledger.
  6. Every kcwiki field/composition conflict must be acknowledged in the
     adjudication ledger (status pending until a human rules on it).
  7. Gauge coverage: maps whose wiki page documents HP/arrival gauges must
     have them parsed (reported in the acceptance report for review).

Use --sync-ledger to append currently-unacknowledged conflicts as pending
entries; the default run stays strict so new differences block expansion.
"""
import datetime
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENCOUNTERS = ROOT / 'data/sortie/encounters'
LEDGER = ROOT / 'data/sortie/adjudications.json'
DEFAULT_AREAS = ['1-5', '2-5', '5-5', '6-5', '7-5']

def run(script, areas):
    result = subprocess.run([sys.executable, str(ROOT / 'tools' / 'data' / script)] + areas,
                            capture_output=True, text=True, encoding='utf-8')
    print(result.stdout, end='')
    if result.returncode != 0:
        print(result.stderr, end='')
        raise SystemExit(f'{script} failed')
    return result.stdout

def conflict_key(area, node, pattern, kind, fields):
    return (area, node, pattern, kind, tuple(sorted(fields or [])))

def load_ledger_entries(path=None):
    path = pathlib.Path(path) if path else LEDGER
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding='utf-8'))
    return {conflict_key(e['area'], e['node'], e['pattern'], e['kind'], e.get('fields')):
            e for e in data['entries']}

def collect_current(areas, encounters_dir=None, ledger_path=None):
    encounters_dir = pathlib.Path(encounters_dir) if encounters_dir else ENCOUNTERS
    ledger_entries = load_ledger_entries(ledger_path or LEDGER)
    failures = []
    pending = []
    for area in areas:
        data = json.loads((encounters_dir / f'{area}.json').read_text(encoding='utf-8'))
        if data.get('schemaVersion') != 2:
            failures.append(f'{area}: schemaVersion != 2')
        missing = [n for n in data['coverageCheck']['missingInEnemyTable'] if n != 'start']
        if missing:
            failures.append(f'{area}: 敌编成表缺少图节点 {missing}（不能静默漏点）')
        for extra in (data['coverageCheck'].get('notInGraph') or []):
            key = conflict_key(area, extra, 0, 'nodeNotInGraph', [])
            entry = ledger_entries.get(key)
            if entry is None:
                failures.append(f'{area}: 敌编成表点 {extra} 不在路线图中（反向差异，需对齐 normal_routes 或登记裁定）')
            elif entry['status'] == 'pending':
                pending.append((area, key, entry))
        backfill = data.get('apiIdBackfill', {})
        if backfill.get('unresolvedCount', 0) > 0:
            unresolved = [u[2] for u in backfill.get('unresolved', [])]
            failures.append(f'{area}: {backfill["unresolvedCount"]} 处敌舰 api ID 未解析 '
                            f'{unresolved[:5]}')
        for v in data.get('validation', []):
            if v['severity'] == 'error':
                failures.append(f"{area}: 继承丢失 {v['node']}/P{v['pattern']} {v['field']}")
            else:  # sourceConflict / airLineInconsistency
                key = conflict_key(area, v['node'], v['pattern'], v['kind'], [v['field']])
                entry = ledger_entries.get(key)
                if entry is None:
                    failures.append(f"{area}: 未登记的制空线矛盾 {v['node']}/P{v['pattern']} "
                                    f"{v['field']} recorded={v['recorded']} expected={v['expected']}")
                elif entry['status'] == 'pending':
                    pending.append((area, key, entry))
        for node_id, node in data['nodes'].items():
            for phase_key, phase in node['phases'].items():
                if 'appearanceRates' in phase:
                    failures.append(f'{area}: 出现率仍挂在 phase 上 '
                                    f'{node_id}/{phase_key}（应为节点级作用域）')
            rates = node.get('appearanceRates')
            if rates:
                for scope in rates:
                    if scope not in ('beforeClear', 'afterClear'):
                        failures.append(f'{area}: 未知出现率作用域 {node_id}/{scope}')
        cc = data.get('crossCheck', {})
        for node_id, rep in cc.get('nodes', {}).items():
            for conflict in rep['conflicts']:
                if conflict['type'] == 'fieldConflict':
                    fields = [f['field'] for f in conflict['fieldConflicts']]
                    key = conflict_key(area, node_id, conflict['wikiwikiPattern'],
                                       'fieldConflict', fields)
                    if key not in ledger_entries:
                        failures.append(f'{area}: 未登记的字段冲突 '
                                        f"{node_id}/P{conflict['wikiwikiPattern']} {fields}")
                    elif ledger_entries[key]['status'] == 'pending':
                        pending.append((area, key, ledger_entries[key]))
                elif conflict['type'] == 'compositionConflict':
                    key = conflict_key(area, node_id, conflict['wikiwikiPattern'],
                                       'compositionConflict', [])
                    if key not in ledger_entries:
                        failures.append(f'{area}: 未登记的编成冲突 '
                                        f"{node_id}/P{conflict['wikiwikiPattern']}")
                    elif ledger_entries[key]['status'] == 'pending':
                        pending.append((area, key, ledger_entries[key]))
    return failures, pending

def sync_ledger(areas):
    data = json.loads((ENCOUNTERS / f'{areas[0]}.json').read_text(encoding='utf-8'))
    existing = load_ledger_entries()
    added = []
    for area in areas:
        doc = json.loads((ENCOUNTERS / f'{area}.json').read_text(encoding='utf-8'))
        for v in doc.get('validation', []):
            if v.get('kind') == 'airLineInconsistency':
                key = conflict_key(area, v['node'], v['pattern'], v['kind'], [v['field']])
                if key not in existing:
                    added.append({'area': area, 'node': v['node'], 'pattern': v['pattern'],
                                  'kind': v['kind'], 'fields': [v['field']],
                                  'wikiwiki': v['recorded'], 'kcwiki': None,
                                  'computed': v['expected'],
                                  'status': 'pending',
                                  'note': f"原表自相矛盾：敌制空{v['enemyAirPower']}×规则值{v['expected']}"
                                          f"≠记载{v['recorded']}；保留原值待核查"})
                    existing[key] = True
        cc = doc.get('crossCheck', {})
        for node_id, rep in cc.get('nodes', {}).items():
            for conflict in rep['conflicts']:
                if conflict['type'] == 'fieldConflict':
                    fields = [f['field'] for f in conflict['fieldConflicts']]
                    key = conflict_key(area, node_id, conflict['wikiwikiPattern'],
                                       'fieldConflict', fields)
                    if key not in existing:
                        vals = {f['field']: {'wikiwiki': f['wikiwiki'], 'kcwiki': f['kcwiki']}
                                for f in conflict['fieldConflicts']}
                        added.append({'area': area, 'node': node_id,
                                      'pattern': conflict['wikiwikiPattern'],
                                      'kind': 'fieldConflict', 'fields': fields,
                                      'values': vals, 'status': 'pending',
                                      'note': 'kcwiki 与 wikiwiki 数值差异，待逐项裁定'})
                        existing[key] = True
                elif conflict['type'] == 'compositionConflict':
                    key = conflict_key(area, node_id, conflict['wikiwikiPattern'],
                                       'compositionConflict', [])
                    if key not in existing:
                        added.append({'area': area, 'node': node_id,
                                      'pattern': conflict['wikiwikiPattern'],
                                      'kind': 'compositionConflict', 'fields': [],
                                      'wikiwikiApiIds': conflict['wikiwikiApiIds'],
                                      'status': 'pending',
                                      'note': '敌舰 ID 序列不一致，待人工裁定'})
                        existing[key] = True
        for extra in (doc['coverageCheck'].get('notInGraph') or []):
            key = conflict_key(area, extra, 0, 'nodeNotInGraph', [])
            if key not in existing:
                added.append({'area': area, 'node': extra, 'pattern': 0,
                              'kind': 'nodeNotInGraph', 'fields': [],
                              'status': 'pending',
                              'note': '敌编成表有该点但带路文本无其边信息；'
                                      '需人工比对地图补全 normal_routes 后移除'})
                existing[key] = True
    if added:
        ledger_doc = {'updated': datetime.datetime.now(datetime.timezone.utc)
                      .isoformat(timespec='seconds'), 'entries': None}
        old = json.loads(LEDGER.read_text(encoding='utf-8')) if LEDGER.exists() else {'entries': []}
        ledger_doc['entries'] = old['entries'] + added
        LEDGER.write_text(json.dumps(ledger_doc, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'ledger: appended {len(added)} pending entries')

def main():
    args = sys.argv[1:]
    sync = False
    if '--sync-ledger' in args:
        sync = True
        args = [a for a in args if a != '--sync-ledger']
    areas = args or DEFAULT_AREAS
    run('parse-wiki-encounters.py', areas)
    run('backfill-enemy-ids.py', areas)
    run('crosscheck-encounters.py', areas)
    if sync:
        sync_ledger(areas)
    failures, pending = collect_current(areas)
    run('report-encounters.py', areas)
    if pending:
        print(f'待裁定条目 {len(pending)} 个（已在台账中登记，状态 pending）：')
        for area, key, entry in pending:
            print(f"  {key[0]} {key[1]}/P{key[2]} {key[3]} {key[4]} — {entry.get('note','')}")
    if failures:
        print('\n门禁未通过：')
        for f in failures:
            print('  ✗', f)
        raise SystemExit(1)
    print('\n门禁通过：无继承丢失、出现率均为节点级作用域、制空线矛盾与交叉核对差异均已在台账登记。')

if __name__ == '__main__':
    main()
