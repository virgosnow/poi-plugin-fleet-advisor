"""Offline regression tests for the encounter table parser and its gate.

Covers the two incidents found in review:
- `~` in the air columns must inherit COLUMN-WISE (air=24 with 優勢/確保 as
  `~` after a 24/36/72 row must read 24/36/72, not 24/24/24);
- the expansion gate must fail on missing graph nodes and unresolved enemy
  api ids, not just print them in the report.
"""
import importlib.util
import json
import pathlib
import re
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]

def load_tool(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'),
                                                  ROOT / 'tools' / 'data' / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

parser = load_tool('parse-wiki-encounters')
gate = load_tool('update-encounters')
catalog_tool = load_tool('build-enemy-catalog')

FOLD = '''#fold(敵編成){{
''敵編成''
|~出現場所|~パターン|~EXP|~出現艦船|~陣形|~[[敵制空値>航空戦#AirSupremacy]]|~優勢|~確保|
|A：&br;敵機動部隊|パターン1|100|[[軽母ヌ級elite]]、[[軽巡ヘ級flagship]]、[[駆逐イ級]]|輪形|24|36|72|
|~|パターン2|110|パターン1と同編成|~|~|~|~|
|~|パターン3|120|[[軽母ヌ級flagship]]、[[軽巡ヘ級flagship]]、[[駆逐イ級]]|~|24|~|~|
|~|パターン4|130|[[軽母ヌ級flagship]]、[[軽母ヌ級flagship]]、[[駆逐イ級]]|~|''46''|69|138|
|B：戦闘なし|||敵影を見ず。|||||
}}'''

BOSS_FOLD = '''#fold(敵編成){{
''敵編成''
|~出現場所|~パターン|~EXP|~出現艦船|~陣形|~[[敵制空値>航空戦#AirSupremacy]]|~優勢|~確保|
|''&color(Red){J：ボス&br;敵主力};''&br;ゲージ破壊後の出現率&br;パターン1: 60%&br;パターン2: 40%|パターン1|600|[[空母ヲ級flagship]]、[[戦艦ル級flagship]]|単縦|''264''|''394''|792|
|~|パターン2|620|[[空母ヲ級flagship]]、[[空母ヲ級flagship]]|~|~|~|~|
}}'''

AIRLINE_FOLD = '''#fold(敵編成){{
''敵編成''
|~出現場所|~パターン|~EXP|~出現艦船|~陣形|~[[敵制空値>航空戦#AirSupremacy]]|~優勢|~確保|
|A：&br;敵増援機動部隊|パターン1|200|[[軽母ヌ級改elite]]、[[軽巡ツ級]]|輪形|264|394|792|
}}'''

class ParseAirInheritanceTest(unittest.TestCase):
    def parse_patterns(self, fold):
        nodes, _order, _cols = parser.parse_enemy_fold(fold, '9-9', {}, {'bossNodes': ['J']})
        return nodes

    def test_column_wise_tilde_inheritance(self):
        # P3 restates air=24 but leaves 優勢/確保 as `~`: they must inherit
        # 36/72 from the previous ROW's columns, not the air value (24/24/24)
        nodes = self.parse_patterns(FOLD)
        p3 = nodes['A']['phases']['base']['patterns'][2]
        self.assertEqual(p3['enemyAirPower'], 24)
        self.assertEqual(p3['airSuperiority'], 36)
        self.assertEqual(p3['airSupremacy'], 72)
        self.assertEqual(p3['airStatus'], 'verified')

    def test_full_row_tilde_inheritance(self):
        nodes = self.parse_patterns(FOLD)
        p2 = nodes['A']['phases']['base']['patterns'][1]
        self.assertEqual((p2['enemyAirPower'], p2['airSuperiority'], p2['airSupremacy']),
                         (24, 36, 72))
        self.assertEqual(p2['airStatus'], 'inherited')
        self.assertEqual(p2['sameAsPattern'], 1)

    def test_bold_values_and_no_false_airline_flags(self):
        nodes = self.parse_patterns(FOLD)
        p4 = nodes['A']['phases']['base']['patterns'][3]
        self.assertEqual((p4['enemyAirPower'], p4['airSuperiority'], p4['airSupremacy']),
                         (46, 69, 138))
        findings = parser.validate_nodes(nodes)
        self.assertEqual([f for f in findings if f['kind'] == 'airLineInconsistency'], [])
        self.assertEqual([f for f in findings if f['kind'] == 'inheritanceGap'], [])

    def test_no_battle_node_effect(self):
        nodes = self.parse_patterns(FOLD)
        self.assertEqual(nodes['B']['kind'], 'noBattle')
        self.assertEqual(nodes['B']['effect']['raw'], '敵影を見ず。')

    def test_post_clear_rates_scope(self):
        nodes = self.parse_patterns(BOSS_FOLD)
        entry = nodes['J']
        self.assertIn('afterClear', entry.get('appearanceRates') or {})
        self.assertNotIn('appearanceRates', entry['phases']['base'])
        rates = entry['appearanceRates']['afterClear']
        self.assertEqual(rates['patterns'], [1, 2])
        self.assertEqual(rates['rates'], [60, 40])

    def test_airline_inconsistency_detected_with_expected(self):
        nodes = self.parse_patterns(AIRLINE_FOLD)
        findings = parser.validate_nodes(nodes)
        flags = [f for f in findings if f['kind'] == 'airLineInconsistency']
        self.assertEqual(len(flags), 1)
        self.assertEqual(flags[0]['recorded'], 394)
        self.assertEqual(flags[0]['expected'], 396)

class GateTest(unittest.TestCase):
    def write_doc(self, tmp, doc, area='9-9'):
        tmp = pathlib.Path(tmp)
        tmp.mkdir(parents=True, exist_ok=True)
        (tmp / f'{area}.json').write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')

    def base_doc(self, **overrides):
        doc = {
            'area': '9-9', 'schemaVersion': 2,
            'validation': [],
            'coverageCheck': {'graphNodes': ['A', 'B'], 'coveredNodes': ['A', 'B'],
                              'missingInEnemyTable': [], 'notInGraph': []},
            'apiIdBackfill': {'resolved': 10, 'unresolvedCount': 0, 'unresolved': []},
            'nodes': {'A': {'phases': {'base': {'patterns': []}}}},
            'crossCheck': {'nodes': {}},
        }
        doc.update(overrides)
        return doc

    def collect(self, doc, ledger_entries=None):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_doc(tmp, doc)
            ledger_path = pathlib.Path(tmp) / 'ledger.json'
            if ledger_entries is not None:
                ledger_path.write_text(json.dumps(
                    {'entries': ledger_entries}, ensure_ascii=False), encoding='utf-8')
            return gate.collect_current(['9-9'], encounters_dir=tmp,
                                        ledger_path=ledger_path)

    def test_missing_graph_node_fails_gate(self):
        failures, _ = self.collect(self.base_doc(
            coverageCheck={'graphNodes': ['A', 'B', 'Z'], 'coveredNodes': ['A', 'B'],
                           'missingInEnemyTable': ['Z'], 'notInGraph': []}))
        self.assertTrue(any('缺少图节点' in f and 'Z' in f for f in failures), failures)

    def test_virtual_start_ignored(self):
        failures, _ = self.collect(self.base_doc(
            coverageCheck={'graphNodes': ['A', 'B'], 'coveredNodes': ['A', 'B'],
                           'missingInEnemyTable': ['start'], 'notInGraph': []}))
        self.assertFalse([f for f in failures if '缺少图节点' in f], failures)

    def test_unresolved_api_ids_fail_gate(self):
        failures, _ = self.collect(self.base_doc(
            apiIdBackfill={'resolved': 8, 'unresolvedCount': 2,
                           'unresolved': [['A', 1, '新ボス', 'unknown']]}))
        self.assertTrue(any('未解析' in f and '新ボス' in f for f in failures), failures)

    def test_phase_mounted_rates_fail_gate(self):
        doc = self.base_doc()
        doc['nodes']['A']['phases']['base']['appearanceRates'] = {'x': 1}
        failures, _ = self.collect(doc)
        self.assertTrue(any('挂在 phase' in f for f in failures), failures)

    def test_unledgered_field_conflict_fails(self):
        doc = self.base_doc(crossCheck={'nodes': {'A': {'conflicts': [
            {'type': 'fieldConflict', 'wikiwikiPattern': 3,
             'fieldConflicts': [{'field': 'enemyAirPower', 'wikiwiki': 24, 'kcwiki': 23}]},
        ]}}})
        failures, _ = self.collect(doc)
        self.assertTrue(any('未登记的字段冲突' in f for f in failures), failures)

    def test_ledgered_pending_conflict_passes_but_pends(self):
        doc = self.base_doc(crossCheck={'nodes': {'A': {'conflicts': [
            {'type': 'fieldConflict', 'wikiwikiPattern': 3,
             'fieldConflicts': [{'field': 'enemyAirPower', 'wikiwiki': 24, 'kcwiki': 23}]},
        ]}}})
        ledger = [{'area': '9-9', 'node': 'A', 'pattern': 3, 'kind': 'fieldConflict',
                   'fields': ['enemyAirPower'], 'status': 'pending', 'note': 'test'}]
        failures, pending = self.collect(doc, ledger_entries=ledger)
        self.assertFalse([f for f in failures if '字段冲突' in f], failures)
        self.assertEqual(len(pending), 1)

    def test_unledgered_airline_fails(self):
        doc = self.base_doc(validation=[
            {'severity': 'sourceConflict', 'kind': 'airLineInconsistency',
             'node': 'A', 'pattern': 1, 'field': 'airSuperiority',
             'recorded': 394, 'expected': 396}])
        failures, _ = self.collect(doc)
        self.assertTrue(any('制空线矛盾' in f for f in failures), failures)


RAW_DUAL_GAUGE = """|~第一ゲージ|戦力ゲージ(Gマス)&br;ボス艦隊旗艦の撃沈で1/3減少&br;3回撃沈でゲージ破壊、H～Mマスが出現|~|
|~第二ゲージ|戦力ゲージ(Mマス)&br;ボス艦隊旗艦の撃沈で1/4減少&br;4回撃沈で海域クリア|~|
"""

RAW_ARRIVAL_GAUGE = '|~ゲージ|Nマスに到達するたびに1/7減少&br;7回目の到達でゲージが消滅し、海域クリア|~|'

RAW_DESTROY_GAUGE = '|~戦力HPゲージ|ボス艦隊旗艦の破壊で5分の1減少&br;5回破壊でクリア|~|'

AERIAL_FOLD = """#fold(敵編成){{
''敵編成''
|~出現場所|~パターン|~EXP|~出現艦船|~陣形|~[[敵制空値>航空戦#AirSupremacy]]|~優勢|~確保|
|D：&color(Green){''航空戦''};&br;敵任務部隊 機動部隊本隊|パターン1|200|[[軽母ヌ級elite]]、[[軽母ヌ級elite]]|輪形|46|69|138|
}}"""

class HeaderParsingTest(unittest.TestCase):
    def test_dual_plain_gauge_labels(self):
        info = parser.parse_header_info(RAW_DUAL_GAUGE, '9-9')
        self.assertEqual([(g['label'], g['killsToClear'], g['bossNode'], g['mechanism'])
                          for g in info['gauges']],
                         [('第一ゲージ', 3, 'G', 'bossSunk'),
                          ('第二ゲージ', 4, 'M', 'bossSunk')])

    def test_arrival_gauge(self):
        info = parser.parse_header_info(RAW_ARRIVAL_GAUGE, '9-9')
        self.assertEqual([(g['label'], g['killsToClear'], g['bossNode'], g['mechanism'])
                          for g in info['gauges']],
                         [('ゲージ', 7, 'N', 'arrival')])

    def test_destroy_wording_gauge(self):
        info = parser.parse_header_info(RAW_DESTROY_GAUGE, '9-9')
        self.assertEqual(info['gauges'][0]['killsToClear'], 5)
        self.assertEqual(info['gauges'][0]['mechanism'], 'bossSunk')

    def test_aerial_combat_kind(self):
        nodes, _o, _c = parser.parse_enemy_fold(AERIAL_FOLD, '9-9', {}, {'bossNodes': []})
        self.assertEqual(nodes['D']['kind'], 'aerialCombat')

class GaugeBackfillTest(unittest.TestCase):
    def parse_gauges(self, raw, boss_nodes):
        info = parser.parse_header_info(raw, '9-9')
        route_bosses = boss_nodes
        for gauge in info['gauges']:
            if gauge.get('bossNode'):
                gauge['bossNodeSource'] = 'wiki血条行'
            elif len(route_bosses) == 1:
                gauge['bossNode'] = route_bosses[0]
                gauge['bossNodeSource'] = 'normal_routes唯一bossNodes回退'
        return info['gauges']

    def test_single_boss_fallback(self):
        raw = '|~戦力HPゲージ|ボス艦隊旗艦の撃沈で25%減少&br;4回撃沈で海域クリア|~|'
        gauges = self.parse_gauges(raw, ['J'])
        self.assertEqual(gauges[0]['bossNode'], 'J')
        self.assertEqual(gauges[0]['bossNodeSource'], 'normal_routes唯一bossNodes回退')

    def test_multi_boss_not_backfilled(self):
        raw = '|~戦力HPゲージ|ボス艦隊旗艦の撃沈で25%減少&br;4回撃沈で海域クリア|~|'
        gauges = self.parse_gauges(raw, ['G', 'M'])
        self.assertNotIn('bossNode', gauges[0])
        self.assertNotIn('bossNodeSource', gauges[0])

    def test_wiki_row_wins_over_fallback(self):
        gauges = self.parse_gauges(RAW_DUAL_GAUGE, ['M'])
        self.assertEqual([(g['bossNode'], g['bossNodeSource']) for g in gauges],
                         [('G', 'wiki血条行'), ('M', 'wiki血条行')])

class ConsumptionTest(unittest.TestCase):
    def test_asw_remark_classifies_node_without_changing_later_air_section(self):
        nodes = {n: {'kind': 'battle'} for n in ['E', 'F']}
        parser.apply_consumption(nodes, {'remarksRaw': '・対潜マスについて\nE：潜水艦エフェクトあり・燃料8%消費、弾薬消費せず\n・空襲戦マスについて\nF：燃料4%、弾薬8%消費'})
        self.assertEqual(nodes['E']['kind'], 'asw')
        self.assertEqual(nodes['F']['kind'], 'battle')
        self.assertEqual(nodes['E']['ammoFraction'], 0)

    def apply(self, remarks):
        nodes = {n: {'fuelFraction': None, 'ammoFraction': None}
                 for n in 'ABCDEFGHIJKLMNP'}
        parser.apply_consumption(nodes, {'remarksRaw': remarks})
        return nodes

    def test_multi_node_list_fills_all(self):
        nodes = self.apply('・夜戦マスについて\nI、J、K、N、P：燃料弾薬ともに10%消費|CENTER:')
        for n in 'IJKNP':
            self.assertEqual((nodes[n]['fuelFraction'], nodes[n]['ammoFraction']),
                             (0.1, 0.1), n)

    def test_boss_annotation_variants(self):
        nodes = self.apply('・対潜マスについて\nK (ボス)：潜水艦エフェクトあり・燃料弾薬ともに20%消費\n'
                           'G（ボス1）：潜水艦エフェクトあり・燃料弾薬ともに20%消費')
        for n in 'KG':
            self.assertEqual((nodes[n]['fuelFraction'], nodes[n]['ammoFraction']),
                             (0.2, 0.2), n)

    def test_paren_wrapped_lists(self):
        nodes = self.apply('・対潜マス(M)：潜水艦エフェクトあり・燃料8%消費、弾薬消費せず\n'
                           '・空襲マス(D,F,G,I)：燃料4%、弾薬8%消費')
        self.assertEqual((nodes['M']['fuelFraction'], nodes['M']['ammoFraction']), (0.08, 0.0))
        for n in 'DFGI':
            self.assertEqual((nodes[n]['fuelFraction'], nodes[n]['ammoFraction']),
                             (0.04, 0.08), n)

    def test_split_air_values(self):
        nodes = self.apply('・空襲戦マスについて\nH：燃料6%、弾薬4%消費')
        self.assertEqual((nodes['H']['fuelFraction'], nodes['H']['ammoFraction']), (0.06, 0.04))

class GateNotInGraphTest(unittest.TestCase):
    def write_doc(self, tmp, doc, area='9-9'):
        tmp = pathlib.Path(tmp)
        tmp.mkdir(parents=True, exist_ok=True)
        (tmp / f'{area}.json').write_text(json.dumps(doc, ensure_ascii=False), encoding='utf-8')

    def base_doc(self, **overrides):
        doc = {
            'area': '9-9', 'schemaVersion': 2, 'validation': [],
            'coverageCheck': {'graphNodes': ['A'], 'coveredNodes': ['A', 'Z'],
                              'missingInEnemyTable': [], 'notInGraph': ['Z']},
            'apiIdBackfill': {'resolved': 1, 'unresolvedCount': 0, 'unresolved': []},
            'nodes': {'A': {'phases': {'base': {'patterns': []}}}},
            'crossCheck': {'nodes': {}},
        }
        doc.update(overrides)
        return doc

    def collect(self, doc, ledger_entries=None):
        with tempfile.TemporaryDirectory() as tmp:
            self.write_doc(tmp, doc)
            ledger_path = pathlib.Path(tmp) / 'ledger.json'
            if ledger_entries is not None:
                ledger_path.write_text(json.dumps(
                    {'entries': ledger_entries}, ensure_ascii=False), encoding='utf-8')
            return gate.collect_current(['9-9'], encounters_dir=tmp,
                                        ledger_path=ledger_path)

    def test_not_in_graph_fails_unacknowledged(self):
        failures, _ = self.collect(self.base_doc())
        self.assertTrue(any('不在路线图中' in f and 'Z' in f for f in failures), failures)

    def test_not_in_graph_pending_passes_with_ledger(self):
        ledger = [{'area': '9-9', 'node': 'Z', 'pattern': 0, 'kind': 'nodeNotInGraph',
                   'fields': [], 'status': 'pending', 'note': 'test'}]
        failures, pending = self.collect(self.base_doc(), ledger_entries=ledger)
        self.assertFalse([f for f in failures if '不在路线图中' in f], failures)
        self.assertEqual(len(pending), 1)


class BannerNameHygieneTest(unittest.TestCase):
    def test_single_name_lines_and_no_markup(self):
        # Synthetic lines cover aliases, single names and markup rejection without a full wiki dump.
        body = ('|1544|装甲空母鬼=<div class=\"hfBox\">{{{1}}}</div>\n'
                '|1607|港湾水鬼3|港湾水鬼3=<div class=\"hfBox\">banner</div>\n'
                '|1501|驱逐I级|駆逐イ級=<div>[[文件:test.png|image]]</div>\n'
                '|1502|1503|测试别名|テスト別名=<span>ignored</span>\n'
                '|1504|{{invalid}}|bad=<div>discard</div>\n')
        seen = {}
        for sid, zh, ja in catalog_tool._banner_entries(body):
            seen[sid] = (zh, ja)
        self.assertEqual(seen['1544'], ('装甲空母鬼', '装甲空母鬼'))
        self.assertEqual(seen['1607'], ('港湾水鬼3', '港湾水鬼3'))
        self.assertEqual(seen['1501'], ('驱逐I级', '駆逐イ級'))
        self.assertEqual(seen['1502'], seen['1503'])
        self.assertNotIn('1504', seen)
        junk = re.compile(r'[<>\[\]{=]|hfBox|文件|�')
        for sid, (zh, ja) in seen.items():
            self.assertFalse(junk.search(zh) or junk.search(ja), (sid, zh, ja))

class NewMapMetadataTests(unittest.TestCase):
    def test_transport_and_boss_gauges_with_unlock_note(self):
        info = parser.parse_header_info('|~作戦名|>|ラバウル基地空襲阻止作戦|\n'
            '|~第一ゲージ|輸送ゲージ(Gマス)&br;TP~280|\n'
            '|~第二ゲージ|Rマス到達1回&br;戦力ゲージ(Nマス)&br;2回撃沈でゲージ破壊|\n', '5-6')
        self.assertEqual(info['operationName'], 'ラバウル基地空襲阻止作戦')
        self.assertEqual(info['gauges'][0]['transportPoints'], 280)
        self.assertEqual(info['gauges'][0]['mechanism'], 'transport')
        self.assertEqual(info['gauges'][1]['mechanism'], 'bossSunk')
        self.assertEqual(info['gauges'][1]['bossNode'], 'N')

    def test_recon_heading_keeps_qualified_variant_name(self):
        tool = load_tool('backfill-enemy-ids')
        entries = [{'name':'飛行場姫','variantLabel':f'飛行場姫(偵察) ({v}) 偵察',
                    'sourcePage':'飛行場姫(偵察)','apiId':1889+i,'anchor':None if i==0 else v.lower()}
                   for i,v in enumerate('ABC')]
        result, _ = tool.resolve({'name':'飛行場姫(偵察)(A)','wikiTarget':'飛行場姫(偵察)'},
                                  *tool.build_indexes({'enemies':entries}))
        self.assertEqual(result['apiId'],1889)

if __name__ == '__main__':
    unittest.main()
