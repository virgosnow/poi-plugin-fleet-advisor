"""Fetch wikiwiki individual enemy ship pages into tmp/sortie_sources/enemies/pages.

Page set is derived from the wikiTargets already parsed into
data/sortie/encounters/*.json, so only enemies actually appearing on the
covered maps are fetched. Each page carries its api id (No.xxxx) and battle
stats, which the catalog builder turns into data/sortie/enemy_catalog.json.
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

ENCOUNTERS = ROOT / 'data/sortie/encounters'
OUT = ROOT.parent / 'tmp/sortie_sources/enemies/pages'

def collect_pages(areas):
    pages = set()
    for area in areas:
        data = json.loads((ENCOUNTERS / f'{area}.json').read_text(encoding='utf-8'))
        for node in data['nodes'].values():
            for phase in node['phases'].values():
                for pattern in phase['patterns']:
                    for ship in (pattern.get('enemyShips') or []):
                        target = ship.get('wikiTarget')
                        if target:
                            pages.add(target.split('#')[0])
                        else:
                            pages.add(ship['name'])
                    for ship in ((pattern.get('escortFleet') or {}).get('enemyShips') or []):
                        target = ship.get('wikiTarget')
                        if target:
                            pages.add(target.split('#')[0])
                        else:
                            pages.add(ship['name'])
    return sorted(pages)

def fetch(page):
    url = 'https://wikiwiki.jp/kancolle/::cmd/source?page=' + urllib.parse.quote(page, safe='')
    req = urllib.request.Request(url, headers={
        'User-Agent': 'poi-plugin-fleet-advisor enemy catalog research/1.0',
        'Accept-Language': 'ja'})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode('utf-8')
    match = re.search(r'<pre id="source"[^>]*><code>(.*?)</code></pre>', body, re.S)
    if not match:
        raise RuntimeError('wiki source missing')
    return html.unescape(match.group(1))

def main():
    areas = sys.argv[1:] or ['1-5', '2-5', '5-5', '6-5', '7-5']
    pages = collect_pages(areas)
    OUT.mkdir(parents=True, exist_ok=True)
    print(f'{len(pages)} enemy pages to fetch')
    for page in pages:
        safe = re.sub(r'[^\w\u3040-\u30ff\u4e00-\u9fff-]+', '_', page)
        target = OUT / f'{safe}.json'
        if target.exists():
            cached = json.loads(target.read_text(encoding='utf-8'))
            if cached.get('page') == page:
                continue
        for attempt in range(4):
            try:
                source = fetch(page)
                record = {
                    'page': page,
                    'url': 'https://wikiwiki.jp/kancolle/' + urllib.parse.quote(page),
                    'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
                    'sha256': hashlib.sha256(source.encode()).hexdigest(),
                    'rawSource': source,
                }
                target.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
                print(page, 'ok', len(source), flush=True)
                break
            except urllib.error.HTTPError as exc:
                if exc.code != 429 or attempt == 3:
                    print('ERROR', page, exc, flush=True)
                    break
                time.sleep(15 * (attempt + 1))
            except Exception as exc:
                print('ERROR', page, exc, flush=True)
                break
        time.sleep(2.5)

if __name__ == '__main__':
    main()
