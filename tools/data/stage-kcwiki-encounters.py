"""Fetch kcwiki (zh) per-map wikitext into tmp/sortie_sources for cross-checking.

wikiwiki is the primary source; kcwiki pages are fetched with ?action=raw so
encounter data can be cross-checked and discrepancies kept side by side.
"""
import datetime
import hashlib
import json
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2]

OUT = ROOT.parent / 'tmp/sortie_sources/maps'
REGIONS = {1: '镇守府海域', 2: '南西群岛海域', 3: '北方海域',
           4: '西方海域', 5: '南方海域', 6: '中部海域', 7: '南西海域'}

def fetch(area):
    page = f'{REGIONS[int(area[0])]}/{area}'
    url = 'https://zh.kcwiki.cn/wiki/' + urllib.parse.quote(page) + '?action=raw'
    req = urllib.request.Request(url, headers={
        'User-Agent': 'poi-plugin-fleet-advisor encounter research/1.0'})
    with urllib.request.urlopen(req, timeout=30) as response:
        body = response.read().decode('utf-8')
    return {
        'area': area,
        'page': page,
        'url': 'https://zh.kcwiki.cn/wiki/' + urllib.parse.quote(page),
        'sourceUrl': url,
        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'sha256': hashlib.sha256(body.encode()).hexdigest(),
        'rawSource': body,
    }

def main():
    areas = sys.argv[1:] or ['1-5', '2-5', '5-5', '6-5', '7-5']
    for area in areas:
        target = OUT / f'{area}.kcwiki.json'
        for attempt in range(4):
            try:
                value = fetch(area)
                target.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')
                print(area, 'ok', len(value['rawSource']), 'chars', flush=True)
                break
            except urllib.error.HTTPError as exc:
                if exc.code not in (429, 503) or attempt == 3:
                    print('ERROR', area, exc, flush=True)
                    break
                time.sleep(15 * (attempt + 1))
            except Exception as exc:
                print('ERROR', area, exc, flush=True)
                break
        time.sleep(3)

if __name__ == '__main__':
    main()
