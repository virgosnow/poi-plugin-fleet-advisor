"""Minimal constructed Wiki tables; no full upstream pages in public fixtures."""
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('expedition_wiki', ROOT / 'tools/data/import-expedition-wiki.py')
TOOL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TOOL)


class ExpeditionImportTests(unittest.TestCase):
    def test_regeneration_preserves_unrelated_reference_formatting(self):
        old = '{"reference": { "one": 1, "two": 2 }, "other":0}'
        changed = {'reference': {'one': 1, 'two': 2}, 'other': 3}
        text = TOOL.serialized(changed, old, 'reference', 2)
        self.assertIn('{ "one": 1, "two": 2 }', text)
        self.assertEqual(json.loads(text), changed)

    def test_ids_and_rewards_are_read_from_the_wiki_reward_row(self):
        text = '\n'.join([
            '|B1|Example&aname(idB1);|A|desc|00:30:00|50%|20%|',
            '|~|~|Lv40&br;&color(red){Lv150};|>|>|>|10EXP、鋼材×20、ボーキサイト×30、家具箱×99|',
            '|~|~|~|>|>|>|最低6隻。艦隊の合計値で、対空200 / 対潜200 / 索敵140 以上必要|',
            '|D2|Example&aname(idD2);|A|desc|10:00:00|50%|20%|',
            '|~|~|Lv65|>|>|>|50EXP、燃料×%%900%%1,000、弾薬×200|',
            '|~|~|~|>|>|>|全6隻。艦種自由|',
            '|33|Support|E|desc|00:15:00|50%|80%|',
        ])
        data = TOOL.parse_details(text)
        self.assertEqual(data[110]['resources'], [0, 0, 20, 30])
        self.assertEqual(data[110]['levelSum'], 150)
        self.assertEqual(data[110]['totals'], {'antiAir': 200, 'asw': 200, 'los': 140})
        self.assertEqual(data[132]['resources'], [1000, 200, 0, 0])
        self.assertEqual(data[33]['resources'], [0, 0, 0, 0])

    def test_incomplete_or_ambiguous_tables_fail_closed(self):
        with self.assertRaises(ValueError):
            TOOL.parse_details('|1|Broken|E|')
        with self.assertRaises(ValueError):
            TOOL.parse_details('|1|Ambiguous|E|\n|~|~|Lv1|>|>|>|燃料×30～50|\n|~|~|~|>|>|>|最低2隻|')
        with self.assertRaises(ValueError):
            TOOL.parse_details('not a table')

    def test_great_success_reference_preserves_wiki_tables_and_named_mission_ids(self):
        source = '**成功条件・大成功条件 [#success]\n#accordion(Example,**,close){{\n'
        source += '|~ID|~遠征名|~必要キラ隻数|\n'
        for label in ['21', '24', '37', '38', '40', '44', 'E2']:
            source += f'|BGCOLOR(#fff):{label}|Example|4|3|4|\n'
        source += '※ note\n'
        for n, (low, high) in enumerate(zip([5,20,35,50,65,80,95], [40,55,70,85,101,116,131])):
            source += f'|{n}隻|{low}%|BGCOLOR(goldenrod):{high}%|\n'
        source += '「必要数2」\n16 + 15 × example\nこの条件が適用される、または適用される可能性がある遠征は以下\n[[A2>#idA2]]・[[D2>#idD2]]\n-帰投時'
        kinds, model = TOOL.parse_great_success(source, {1: {}, 21: {}, 101: {}, 132: {}})
        self.assertEqual(kinds[101]['kind'], 'flagship')
        self.assertEqual(kinds[132]['kind'], 'flagship')
        self.assertEqual(kinds[21]['carriers'], 3)
        self.assertEqual(kinds[1]['kind'], 'sparkled')
        self.assertEqual(model['drum']['full'][4], 101)
        with self.assertRaises(ValueError):
            TOOL.parse_great_success(source.replace('|6隻|95%|BGCOLOR(goldenrod):131%|', ''), {21: {}})


if __name__ == '__main__':
    unittest.main()
