import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('enemy_accuracy_import', ROOT / 'tools/data/import_enemy_accuracy.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

def row(enemy_id, name, level, luck, equipment):
    cells = [str(enemy_id), f'({enemy_id}){name}', str(level), '50', '0', '0', '0', '20', str(luck), '短', equipment]
    return '<tr>' + ''.join(f'<td>{cell}</td>' for cell in cells) + '</tr>'

class EnemyAccuracyImportTest(unittest.TestCase):
    def test_separates_adjacent_equipment_and_rejects_conflicts_and_wrong_names(self):
        known = {'enemies': [{'apiId': 1571, 'name': '潜水ソ級elite'},
                             {'apiId': 1613, 'name': '敵舰'}, {'apiId': 1614, 'name': '别的舰'}]}
        equipment = '<div>炮</div><div>命中+4</div><div>15英寸炮</div><div>命中+4</div>'
        html = '<table>' + row(1571, '潜水ソ級elite', 50, 30, equipment)
        html += row(1613, '敵舰', 1, 60, '') + row(1613, '敵舰', 1, 70, '')
        html += row(1614, '错误身份', 1, 10, '') + '</table>'
        self.assertEqual(MODULE.extract(html, known), {'1571': {'level': 50, 'luck': 30, 'equipmentAccuracy': 8}})

if __name__ == '__main__':
    unittest.main()
