"""Fetch wikiwiki per-map branching sections into ignored local staging files.

The staged wiki text is research input only; it is not included in npm pack.
"""
import hashlib
import html
import json
import pathlib
import re
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT.parent / 'tmp' / 'wiki_branches'
REGIONS = {1: '鎮守府海域', 2: '南西諸島海域', 3: '北方海域',
           4: '西方海域', 5: '南方海域', 6: '中部海域', 7: '南西海域'}
AREAS = [f'{world}-{map_no}' for world in range(1, 8)
         for map_no in range(1, (6 if world == 1 else 5) + 1)]

def extract_fold(source, name):
    start = source.find(f'#fold({name})')
    if start < 0:
        return ''
    opening = source.find('{', start)
    if opening < 0:
        return ''
    depth = 0
    for index in range(opening, len(source)):
        if source[index] == '{':
            depth += 1
        elif source[index] == '}':
            depth -= 1
            if depth == 0:
                return source[start:index + 1]
    return ''

def fetch(area):
    world = int(area[0])
    page = f'{REGIONS[world]}/{area}'
    url = 'https://wikiwiki.jp/kancolle/::cmd/source?page=' + urllib.parse.quote(page, safe='')
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'poi-plugin-fleet-advisor route research/1.0'}), timeout=20) as response:
        body = response.read().decode('utf-8')
    match = re.search(r'<pre id="source"[^>]*><code>(.*?)</code></pre>', body, re.S)
    if not match:
        raise RuntimeError(f'{area}: wiki source missing')
    source = html.unescape(match.group(1))
    section = extract_fold(source, 'ルート分岐法則')
    if not section:
        raise RuntimeError(f'{area}: branch section missing or unbalanced')
    enemy_section = extract_fold(source, '敵編成')
    boss_nodes = sorted(set(re.findall(r'([A-Z][0-9]?)[:：][^|\n]{0,80}ボス(?!前)', enemy_section)))
    terminal_nodes = sorted(set(re.findall(r'([A-Z][0-9]?)[:：][^|\n]{0,80}(?:ゴール|終点)', enemy_section)))
    return area, {'area': area, 'page': page,
                  'url': 'https://wikiwiki.jp/kancolle/' + urllib.parse.quote(page),
                  'sha256': hashlib.sha256(section.encode()).hexdigest(),
                  'bossVersion': 2, 'sectionVersion': 3,
                  'bossNodes': boss_nodes, 'terminalNodes': terminal_nodes,
                  'section': section}

def main():
    OUT.mkdir(exist_ok=True)
    for area in AREAS:
        existing = OUT / f'{area}.json'
        if existing.exists():
            cached = json.loads(existing.read_text(encoding='utf-8'))
            if cached.get('bossVersion') == 2 and (cached.get('sectionVersion') == 3 or
                ('#fold(' not in cached['section'][cached['section'].find('\n') + 1:] and
                 '{{{' not in cached['section'].splitlines()[0])):
                continue
        for attempt in range(4):
            try:
                area, value = fetch(area)
                (OUT / f'{area}.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
                print(area, len(value['section']), flush=True)
                break
            except urllib.error.HTTPError as exc:
                if exc.code != 429 or attempt == 3:
                    print('ERROR', area, exc, flush=True)
                    break
                time.sleep(15 * (attempt + 1))
            except Exception as exc:
                print('ERROR', area, exc, flush=True)
                break
        time.sleep(2)

if __name__ == '__main__':
    main()
