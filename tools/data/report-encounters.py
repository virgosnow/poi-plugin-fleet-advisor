"""Generate the sample acceptance report for parsed encounter data.

Per map: node coverage vs normal_routes graphs, pattern counts, kinds,
consumption coverage, scoped appearance rates, air-line self-consistency
flags, api-id back-fill stats, and the kcwiki cross-check broken down into
字段级一致 / 字段差异 / 编成差异 with ledger (adjudication) status. Written to
reports/sortie-encounters-sample-report.md for human review.

「字段级一致」= api ID 序列一致，且双方均记载的经验/敌制空/阵形/护卫/最终形态
全部一致。仅舰名对上不算一致，也不称“完全一致”。
"""
import datetime
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]

ENCOUNTERS = ROOT / 'data/sortie/encounters'
LEDGER = ROOT / 'data/sortie/adjudications.json'
REPORT = ROOT / 'reports/sortie-encounters-sample-report.md'

def ledger_index():
    if not LEDGER.exists():
        return {}
    data = json.loads(LEDGER.read_text(encoding='utf-8'))
    return {(e['area'], e['node'], e['pattern'], e['kind'], tuple(sorted(e.get('fields') or []))):
            e for e in data['entries']}

def main():
    areas = sys.argv[1:] or ['1-5', '2-5', '5-5', '6-5', '7-5']
    ledger = ledger_index()
    lines = ['# 常规图敌编成样本验收报告（' + ' / '.join(areas) + '）', '']
    lines.append(f'生成时间：{datetime.datetime.now().isoformat(timespec="seconds")}')
    lines.append('')
    lines.append('数据文件 `data/sortie/encounters/*.json`（schemaVersion 2），原始存档 '
                 '`tmp/sortie_sources/maps/`（wikiwiki + kcwiki），敌舰目录 '
                 '`data/sortie/enemy_catalog.json`，裁定台账 `data/sortie/adjudications.json`。')
    lines.append('')
    lines.append('> 「字段级一致」指 api ID 序列一致，且双方均记载的经验、敌制空、阵形、护卫舰队、'
                 '最终形态全部一致；仅舰名对上不计数，不称“完全一致”。')
    lines.append('')
    total_pending = 0
    for area in areas:
        data = json.loads((ENCOUNTERS / f'{area}.json').read_text(encoding='utf-8'))
        cc = data['crossCheck']
        nodes = data['nodes']
        pattern_total = sum(len(p['patterns']) for e in nodes.values() for p in e['phases'].values())
        kinds = {}
        for e in nodes.values():
            kinds[e['kind']] = kinds.get(e['kind'], 0) + 1
        cons = [nid for nid, e in nodes.items() if e.get('fuelFraction') is not None]
        rates = []
        for nid, e in nodes.items():
            for scope in (e.get('appearanceRates') or {}):
                rates.append(f'{nid}/{scope}')
        backfill = data.get('apiIdBackfill', {})
        summary = cc['summary']
        lines.append(f'## {area}')
        lines.append('')
        lines.append(f'- 出处：{data["source"]["url"]}（{data["source"]["retrievedAt"]}，'
                     f'sha256 `{data["source"]["sha256"][:12]}…`）')
        missing = [n for n in data['coverageCheck']['missingInEnemyTable'] if n != 'start']
        lines.append(f'- 点位：{len(nodes)} / 图节点 {len(data["coverageCheck"]["graphNodes"]) - 1}'
                     f'（不含虚拟起点）；缺失 {missing or "无"}；'
                     f'多出 {data["coverageCheck"]["notInGraph"] or "无"}')
        lines.append(f'- 敌编成 pattern 总数：{pattern_total}；点位类别：' +
                     '、'.join(f'{k}×{v}' for k, v in sorted(kinds.items())))
        gauges = '; '.join(
            f'{g["label"]}: kills={g.get("killsToClear")}'
            + (f'@{g["bossNode"]}' if g.get('bossNode') else '')
            + (f'/{g["mechanism"]}' if g.get('mechanism') else '')
            for g in data['gauges']) or '无记载'
        lines.append(f'- 血条：{gauges}')
        for extra in (data['coverageCheck'].get('notInGraph') or []):
            key = (area, extra, 0, 'nodeNotInGraph', ())
            entry = ledger.get(key)
            status = entry.get('status', '未登记') if entry else '未登记'
            if status == 'pending':
                total_pending += 1
            lines.append(f'- 反向差异：敌表点 {extra} 不在路线图中；台账 {status}')
        lines.append(f'- 明确记载燃弹例外的点：{", ".join(cons) if cons else "无"}')
        lines.append(f'- 有记载出现率的点位/作用域：{", ".join(rates) if rates else "无"}')
        lines.append(f'- 敌舰 api ID：{backfill.get("resolved", "?")} 处回填、'
                     f'{backfill.get("unresolvedCount", "?")} 处未解析')
        lines.append(f'- 交叉核对：字段级一致 {summary["patternsFullyConsistent"]} / {pattern_total}；'
                     f'字段差异 {summary["fieldConflictPatterns"]} 个 pattern；'
                     f'编成差异 {summary["compositionConflictPatterns"]} 个 pattern；'
                     f'另有结构差异（点缺失/数量不同）'
                     f'{summary["conflictCount"] - summary["fieldConflictPatterns"] - summary["compositionConflictPatterns"]} 处')
        airline = [v for v in data.get('validation', []) if v.get('kind') == 'airLineInconsistency']
        for v in airline:
            key = (area, v['node'], v['pattern'], v['kind'], tuple([v['field']]))
            entry = ledger.get(key, {})
            lines.append(f'- ⚠ 制空线自相矛盾：{v["node"]}/P{v["pattern"]} '
                         f'{v["field"]} 记载 {v["recorded"]}，按敌制空 {v["enemyAirPower"]} '
                         f'应为 {v["expected"]}；保留原值，台账状态 '
                         f'{entry.get("status", "未登记")}')
        for nid, rep in cc['nodes'].items():
            for c in rep['conflicts']:
                if c['type'] == 'fieldConflict':
                    fields = tuple(sorted(f['field'] for f in c['fieldConflicts']))
                    key = (area, nid, c['wikiwikiPattern'], 'fieldConflict', fields)
                    entry = ledger.get(key)
                    detail = '; '.join(
                        f"{f['field']}: wikiwiki {f['wikiwiki']} vs kcwiki {f['kcwiki']}"
                        + (f"（{f['relation']}）" if f.get('relation') else '')
                        for f in c['fieldConflicts'])
                    status = entry.get('status', '未登记') if entry else '未登记'
                    if status == 'pending':
                        total_pending += 1
                    lines.append(f'- 差异 {nid}/P{c["wikiwikiPattern"]}：{detail}'
                                 f'；台账 {status}')
                elif c['type'] == 'compositionConflict':
                    key = (area, nid, c['wikiwikiPattern'], 'compositionConflict', ())
                    entry = ledger.get(key)
                    status = entry.get('status', '未登记') if entry else '未登记'
                    if status == 'pending':
                        total_pending += 1
                    lines.append(f'- 差异 {nid}/P{c["wikiwikiPattern"]}：敌舰 ID 序列不一致'
                                 f'（wikiwiki {c["wikiwikiApiIds"]}）；台账 {status}')
        lines.append('')
    lines.append(f'待人工裁定条目：{total_pending} 个（台账 `data/sortie/adjudications.json`，'
                 '状态 pending 的条目裁定前不得据此做推荐口径）。')
    lines.append('')
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text('\n'.join(lines), encoding='utf-8')
    print('\n'.join(lines))

if __name__ == '__main__':
    main()
