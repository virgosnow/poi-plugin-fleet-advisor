"""Fetch wikiwiki per-map raw source pages into tmp/sortie_sources for encounter research.

Saves the full wiki source of each map page plus extracted fold sections
(ルート分岐法則, 敵編成, 海域情報 etc.) with URL, retrievedAt and SHA-256 so
structured data in data/sortie/encounters/ can be traced back to the原文.
Staged text is research input only; it is not included in npm pack.
"""
import datetime
import hashlib
import html
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]

OUT = ROOT.parent / 'tmp/sortie_sources/maps'
REGIONS = {1: '鎮守府海域', 2: '南西諸島海域', 3: '北方海域',
           4: '西方海域', 5: '南方海域', 6: '中部海域', 7: '南西海域'}
FOLDS = ['海域情報', 'ルート分岐法則', '敵編成', 'ドロップ', 'トラップ',
         '任務', '基地航空隊', 'お仕置き', '海域攻略', 'コメント']

def extract_fold(source, name):
    """Return the #fold(name){...} block, brace-balanced."""
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
    req = urllib.request.Request(url, headers={
        'User-Agent': 'poi-plugin-fleet-advisor encounter research/1.0',
        'Accept-Language': 'ja',
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode('utf-8')
    match = re.search(r'<pre id="source"[^>]*><code>(.*?)</code></pre>', body, re.S)
    if not match:
        raise RuntimeError(f'{area}: wiki source missing')
    source = html.unescape(match.group(1))
    folds = {}
    for name in FOLDS:
        section = extract_fold(source, name)
        if section:
            folds[name] = section
    if '敵編成' not in folds:
        raise RuntimeError(f'{area}: enemy fold missing; folds={list(folds)}')
    return {
        'area': area,
        'page': page,
        'url': f'https://wikiwiki.jp/kancolle/' + urllib.parse.quote(page),
        'sourceUrl': url,
        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'sha256': hashlib.sha256(source.encode()).hexdigest(),
        'sourceLength': len(source),
        'rawSource': source,
        'folds': {name: {'sha256': hashlib.sha256(s.encode()).hexdigest(),
                         'length': len(s), 'section': s}
                  for name, s in folds.items()},
    }

def main():
    areas = sys.argv[1:] or ['1-5', '2-5', '5-5', '6-5', '7-5']
    OUT.mkdir(parents=True, exist_ok=True)
    for area in areas:
        target = OUT / f'{area}.json'
        for attempt in range(4):
            try:
                value = fetch(area)
                target.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
                print(area, 'ok', value['sourceLength'], 'chars, folds:',
                      {k: v['length'] for k, v in value['folds'].items()}, flush=True)
                break
            except urllib.error.HTTPError as exc:
                if exc.code != 429 or attempt == 3:
                    print('ERROR', area, exc, flush=True)
                    break
                time.sleep(15 * (attempt + 1))
            except Exception as exc:
                print('ERROR', area, exc, flush=True)
                break
        time.sleep(3)

if __name__ == '__main__':
    main()
