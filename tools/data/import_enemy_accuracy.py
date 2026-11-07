#!/usr/bin/env python3
"""Extract reference enemy accuracy inputs from a saved kcwiki enemy-list HTML.

Usage: python tools/data/import_enemy_accuracy.py path/to/enemy-list.html
Rows are joined by both ID and Japanese name to the existing enemy catalogue;
conflicting, incomplete and unrecognized rows are not imported.
"""
import collections
import hashlib
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

class Rows(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.row, self.cell, self.skip = [], None, None, 0

    def handle_starttag(self, tag, attrs):
        if tag == 'tr': self.row = []
        if self.row is not None and tag in ('td', 'th'): self.cell = []
        if self.cell is not None and tag in ('div', 'br', 'span'): self.cell.append(' ')
        if tag in ('style', 'script'): self.skip += 1

    def handle_endtag(self, tag):
        if tag in ('style', 'script'): self.skip -= 1
        if self.cell is not None and tag in ('div', 'span'): self.cell.append(' ')
        if tag in ('td', 'th') and self.row is not None and self.cell is not None:
            self.row.append(''.join(self.cell).strip())
            self.cell = None
        if tag == 'tr' and self.row is not None:
            self.rows.append(self.row)
            self.row = None

    def handle_data(self, text):
        if not self.skip and self.cell is not None: self.cell.append(text)

def extract(html, catalog):
    known = {str(row['apiId']): row for row in catalog['enemies'] if row.get('apiId')}
    parser = Rows()
    parser.feed(html)
    candidates = collections.defaultdict(list)
    for row in parser.rows:
        if len(row) < 11 or not re.fullmatch(r'\d{4}', row[0]) or not row[2].isdigit() or not row[8].isdigit():
            continue
        enemy = known.get(row[0])
        if not enemy or not enemy.get('name') or enemy['name'] not in row[1]: continue
        if any(x in row[10] for x in ('?', '？', '未知', '不明')): continue
        values = re.findall(r'命中\s*([+\-]\s*\d+)', row[10])
        accuracy = sum(int(value.replace(' ', '')) for value in values)
        candidates[row[0]].append((int(row[2]), int(row[8]), accuracy))
    return {key: {'level': values[0][0], 'luck': values[0][1], 'equipmentAccuracy': values[0][2]}
            for key, values in sorted(candidates.items(), key=lambda item: int(item[0])) if len(set(values)) == 1}

def main(html_file):
    catalog = json.loads((ROOT / 'data/sortie/enemy_catalog.json').read_text(encoding='utf8'))
    source = Path(html_file).read_bytes()
    entries = extract(source.decode('utf8'), catalog)
    # Fail closed if the upstream table changes layout or identity.
    if entries.get('1571') != {'level': 50, 'luck': 30, 'equipmentAccuracy': 0} or \
       entries.get('1572') != {'level': 50, 'luck': 45, 'equipmentAccuracy': 0} or len(entries) < 100:
        raise ValueError('Enemy table layout or required cross-checks changed')
    data = {'source': 'https://zh.kcwiki.cn/wiki/深海栖舰列表',
            'sourceSha256': hashlib.sha256(source).hexdigest(),
            'notes': '等级为百科参考值，部分敌舰的真实等级仍有争议；不完整或冲突记录未导入。', 'enemies': entries}
    (ROOT / 'data/sortie/enemy_accuracy.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
    print(f'Imported {len(entries)} reference enemy records')

if __name__ == '__main__':
    if len(sys.argv) != 2: raise SystemExit(__doc__)
    main(sys.argv[1])
