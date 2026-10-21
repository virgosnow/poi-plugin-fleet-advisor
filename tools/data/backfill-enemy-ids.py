"""Back-fill enemy api ids in encounters JSONs from enemy_catalog.json.

Each ship reference in data/sortie/encounters/<area>.json keeps its original
wiki name; apiId is resolved via the catalog using the wiki link target page
plus anchor first, falling back to display-name matching. Unresolved or
ambiguous references keep apiId null with a status note instead of a guess.
"""
import json
import sys
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parents[2]

ENCOUNTERS = ROOT / 'data/sortie/encounters'
CATALOG = ROOT / 'data/sortie/enemy_catalog.json'

def norm_parens(text):
    return text.replace('（', '(').replace('）', ')')

def _desc_key(desc):
    desc = desc.replace('、', '').replace(' ', '')
    desc = desc.replace('司令部レベル低', '弱')
    if desc in ('前哨戦', '最終形態'):
        desc += '強'
    return desc

def display_keys(entry):
    """Display-name keys a map table may use for this catalog entry.

    Map tables write variants as 名前（A）/名前（前哨戦 強）; enemy page blocks
    are labeled 名前 (A) / 名前(A) / 名前 ([[map-link]] 前哨戦、司令部レベル低).
    Keys normalize to halfwidth parens without inner spaces, with 強 = no
    low-level note and 弱 = 司令部レベル低, so both spellings meet.
    """
    name = entry['name'] or ''
    if not name:
        return set()
    label = re.sub(r'\[\[[^\]]*\]\]', '', entry.get('variantLabel') or '')
    keys = {name}
    # spaced-token form: 名前 (A) 艦載機白 / 名前 (B)　陸爆中
    tokens = [t for t in re.split(r'[ 　]+', label) if t]
    letters = [t for t in tokens[1:] if re.fullmatch(r'[（(][A-Z][）)]', norm_parens(t))]
    for t in letters:
        keys.add(f'{name}{norm_parens(t)}')
        # Some pages use a qualified display heading (e.g. 飛行場姫(偵察))
        # while the stat card keeps the shared base name 飛行場姫.
        keys.add(f'{norm_parens(tokens[0])}{norm_parens(t)}')
    desc = _desc_key(''.join(t for t in tokens[1:] if t not in letters))
    if desc:
        keys.add(f'{name}({desc})')
    # trailing paren form (with or without spaces): 名前(A) / 名前 ( 前哨戦)
    m = re.search(r'[（(]([^（）()]*)[）)]\s*$', label)
    if m and m.group(1).strip():
        inner = m.group(1).strip()
        if re.fullmatch(r'[A-Z]', inner):
            keys.add(f'{name}({inner})')
        else:
            keys.add(f'{name}({_desc_key(inner)})')
    return {norm_parens(k) for k in keys}

def query_key(name):
    name = norm_parens(name)
    m = re.match(r'^(.*)\(([^)]*)\)$', name)
    if m and m.group(2):
        return f'{m.group(1)}({m.group(2).replace(" ", "")})'
    return name

def is_default_variant(entry):
    label = entry.get('variantLabel') or ''
    tokens = [t for t in re.split(r'[ 　]+', label) if t]
    extras = [t for t in tokens[1:] if t]
    # a bare (A) marks the page's base block; map tables reference it by the
    # plain name (e.g. 軽母ヌ級flagship without plane-color annotation)
    return not extras or extras == ['(A)']

def build_indexes(catalog):
    by_page_anchor = {}
    by_page = {}
    by_display = {}
    for e in catalog['enemies']:
        by_page_anchor[(e['sourcePage'], e.get('anchor'))] = e
        by_page.setdefault(e['sourcePage'], []).append(e)
        for k in display_keys(e):
            by_display.setdefault(k, []).append(e)
    return by_page_anchor, by_page, by_display

def resolve(ship, by_page_anchor, by_page, by_display, area=None):
    name = query_key(ship['name'])
    target = ship.get('wikiTarget')
    if target:
        page = target.split('#')[0]
        anchor = target.split('#')[1] if '#' in target else None
        entry = by_page_anchor.get((page, anchor))
        if entry:
            return entry, 'verified(wikiTarget)'
        candidates = by_page.get(page, [])
        named = [e for e in candidates if name in display_keys(e)]
        if len(named) > 1 and area:
            # pages hosting versions of several maps (北方棲姫: 3-5 vs AL/MI)
            # disambiguate by the map id embedded in the block label
            hinted = [e for e in named if f'{area}>' in (e.get('variantLabel') or '')]
            if len(hinted) == 1:
                named = hinted
        if len(named) == 1:
            return named[0], 'verified(page+variant)'
        if len(named) > 1:
            defaults = [e for e in named if is_default_variant(e)]
            if len(defaults) == 1:
                return defaults[0], 'verified(default variant)'
            return None, f'ambiguous({len(named)} variants on page {page})'
        if len(candidates) == 1:
            return candidates[0], 'verified(page unique)'
        if candidates:
            return None, f'ambiguous({len(candidates)} variants on page {page}, no name match)'
    hits = by_display.get(name, [])
    unique = {e['apiId']: e for e in hits}
    if len(unique) == 1:
        return next(iter(unique.values())), 'verified(name)'
    if len(unique) > 1:
        defaults = [e for e in unique.values() if is_default_variant(e)]
        if len(defaults) == 1:
            return defaults[0], 'verified(default variant)'
        return None, f'ambiguous({len(unique)} ids for name)'
    return None, 'unknown'

def main():
    catalog = json.loads(CATALOG.read_text(encoding='utf-8'))
    by_page_anchor, by_page, by_display = build_indexes(catalog)
    stats = {}
    for path in sorted(ENCOUNTERS.glob('*.json')):
        if sys.argv[1:] and path.stem not in sys.argv[1:]:
            continue
        data = json.loads(path.read_text(encoding='utf-8'))
        resolved = 0
        unresolved = []
        for node in data['nodes'].values():
            for phase in node['phases'].values():
                for pattern in phase['patterns']:
                    fleets = [pattern.get('enemyShips') or [],
                              (pattern.get('escortFleet') or {}).get('enemyShips') or []]
                    for fleet in fleets:
                        for ship in fleet:
                            entry, status = resolve(ship, by_page_anchor, by_page, by_display, area=data['area'])
                            if entry:
                                ship['apiId'] = entry['apiId']
                                ship['apiIdStatus'] = status
                                resolved += 1
                            else:
                                ship['apiId'] = None
                                ship['apiIdStatus'] = status
                                unresolved.append((node['node'], pattern['pattern'],
                                                   ship['name'], status))
        data['apiIdBackfill'] = {
            'catalogGeneratedAt': catalog['generatedAt'],
            'resolved': resolved,
            'unresolvedCount': len(unresolved),
            'unresolved': unresolved,
        }
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        stats[data['area']] = (resolved, unresolved)
        print(f"{data['area']}: resolved={resolved} unresolved={len(unresolved)}")
        for u in unresolved[:10]:
            print('   ', u)

if __name__ == '__main__':
    main()
