"""Build reviewed 5-6 data from the retained NGA snapshot and staged game assets.

Input: ../tmp/5-6/06_{info,image}{,18,20,36}.{json,png}, fetched from
https://w16s.kancolle-server.com/kcs2/resources/map/005/ on 2026-10-14.
Additional assets are indexed by the previous spot count, as in the game.
Enemy data is imported separately with the standard encounter pipeline.
"""
import copy
import hashlib
import json
import math
import re
import subprocess
import os
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
STAGED = ROOT.parent / 'tmp/5-6'
WIKI = 'https://zh.kcwiki.cn/wiki/%E5%8D%97%E6%96%B9%E6%B5%B7%E5%9F%9F/5-6'
BASE = 'https://w16s.kancolle-server.com/kcs2/resources/map/005/'
def read(p): return json.loads(p.read_text(encoding='utf8'))
def write(p, v): p.write_text(json.dumps(v, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
def sha(b): return hashlib.sha256(b).hexdigest()
def count(types, **bounds): return {'count': {'stypes': types, **bounds}}
def allof(*v): return {'all': list(v)}
def anyof(*v): return {'any': list(v)}
def rule(when, to): return {'when': when, 'to': to}
BB = [8,9,10,12]
CV = [7,11,18]
DD = [1,2]
FAST = {'speedAtLeast': 'fast'}
SLOW = {'not': FAST}
LOS = lambda n: {'los': {'coefficient': 4, 'gte': n}}
AKITSU = {'shipName': {'prefixes': ['あきつ丸']}}
def heavies(**bounds): return {'count': {'stypes': BB+[7], 'prefixes': ['あきつ丸'], **bounds}}

def navigation():
    source_path = os.environ.get('FLEET_ADVISOR_NGA_SOURCE')
    if not source_path:
        raise SystemExit('Set FLEET_ADVISOR_NGA_SOURCE to the separately stored NGA source JSON.')
    snapshot = Path(source_path)
    post = next(p for p in read(snapshot)['posts'] if p['map']=='5-6')
    body = post['body_ubb_text_only']
    clauses = {}
    for title, content in re.findall(r'\[tr\]\s*\[td\](.*?)\[/td\]\s*\[td\](.*?)\[/td\]', body, re.S):
        title = re.sub(r'\[.*?\]', '', title).strip()
        if title=='分歧点': continue
        clauses[title] = re.sub(r'\[.*?\]', '', content.replace('[*]', '• ')).strip()
    start1 = [rule(count([11,18],min=1),'A1'), rule(count(DD,max=1),'A1'),
        rule(allof(count(BB,min=2),count(DD,exact=2)),'A1'),
        rule(count([16,17],min=2),'A'),rule(count([1],min=3),'A'),rule(count(DD,min=4),'A'),rule(True,'A2')]
    forced1 = anyof(count([16,17],min=1),count([1],min=2),allof(count(BB,min=2),SLOW))
    later_start = [rule(allof(forced1, r['when']), r['to']) for r in start1] + [rule(True,'I')]
    rules = {
        'start': start1, 'start#gauge1': start1, 'start#gimmick': start1,
        'start#gauge2': later_start, 'start#gauge3': later_start,
        'A': [rule(heavies(min=1),'B'),rule(allof(count([5,6],min=1),SLOW),'B'),rule(True,'C2')],
        'A2': [rule(SLOW,'B'),rule(count([11,18],min=1),'B'),rule(count([5,6],min=2),'B'),
            rule(count(DD,max=1),'B'),rule(allof(count(BB,min=1),count(BB+[7],min=2),count([3,1,2],max=3)),'B'),rule(True,'C')],
        'B': [rule(allof(count([10],exact=2),count(DD,exact=4)),'C2'),rule(count([11,18],min=1),'C1'),
            rule(allof(FAST,heavies(max=1)),'C'),rule(allof(FAST,count([16,17],min=1)),'C'),
            rule(allof(FAST,count([3],min=1),count(DD,min=2)),'C1'),rule(allof(FAST,count(DD,min=4)),'C1'),rule(FAST,'C'),
            rule(allof(heavies(exact=0),count(DD,min=2)),'C'),rule(allof(heavies(exact=1),count(DD,exact=3)),'C'),rule(True,'C1')],
        'C1': [rule({'pathIncludes':'A'},'C2'),rule(True,'C')],
        'E': [rule(allof(count(BB,exact=0),LOS(58)),'G'),rule(allof(count(BB,min=1),LOS(65)),'G'),rule(True,'F')],
        'I': [{'when':True,'uncertain':True,'choices':[{'to':'J'},{'to':'O'}],'note':'能動分岐（出击者选择）'}],
        'J': [rule(allof(count([11,18],min=2),SLOW),'K1'),rule(count([2],min=2),'K'),rule(True,'K1')],
        'K': [rule(allof(count(BB+CV,max=2),count([3],min=1),FAST),'L'),rule(True,'K2')],
        'L': [rule(LOS(80),'N'),rule(True,'M')],
        'O': [{'when':True,'uncertain':True,'choices':[{'to':'P'},{'to':'Q'}],'note':'能動分岐（出击者选择）'}],
        'Q': [rule({'speedAtLeast':'fastPlus'},'W'),rule(allof(count([3],min=1),count([2],min=3),FAST),'W'),
            rule(count([11,18],min=3),'Q2'),rule(allof(count(BB,min=2),count([3],exact=0)),'Q2'),
            rule(count([2],max=1),'Q2'),rule(True,'U')],
        'Q#gauge2': [rule(True,'Q2')],
        # The source has no numeric threshold at Q1. Preserve that unknown;
        # the guide routes do not pass Q1, and it must not become guaranteed.
        'Q1': [rule({'unknown':'Q1点索敌门槛尚未明确'},'S'),rule(count([2],min=2),'T'),rule(True,'Q2')],
        'Q2': [rule({'pathIncludes':'P'},'T'),rule({'pathIncludes':'Q'},'V')],
        'V': [rule(count(BB+CV,min=4),'W'),rule(count([11,18],min=3),'W'),rule(count([2],max=1),'W'),rule(True,'X')],
        'X': [rule(LOS(88),'Z'),rule(True,'Y')],
    }
    fixed = {'A1':'A2','C2':'D','D':'E','C':'H','H':'R','K1':'K','K2':'L','P':'Q1','U':'X','W':'X'}
    branches=[]
    for key, rows in rules.items():
        node, _, phase = key.partition('#')
        if node=='start':
            text = clauses['出发点']+'\n第一出发点：\n'+clauses['1']
            if phase in ('gauge1','gimmick'): text='第二出发点未解锁，使用第一出发点。\n'+text
            elif phase: text='本阶段以第二出发点已解锁为前提。\n'+text
        else: text=clauses.get(node,'能動分岐')
        destinations=list(dict.fromkeys(t for r in rows for t in ([r['to']] if 'to' in r else [c['to'] for c in r['choices']])))
        branches.append({'from':node,**({'phase':phase} if phase else {}),'destinations':destinations,
            'clauses':[text],'source':post['source']})
    for node,to in fixed.items(): branches.append({'from':node,'destinations':[to],'clauses':['固定连接：游戏路线素材与Wiki海图核对']})
    late = ['I','J','K','K1','K2','L','M','N','O','P','Q','Q1','Q2','S','T','U','V','W','X','Y','Z']
    result={'area':'5-6','name':'ラバウル方面海域','source':{'url':WIKI,'authority':'nga-16820397',
        'postUrl':post['source'],'threadUrl':'https://bbs.nga.cn/read.php?tid=16820397','postId':post['pid'],
        'capturedDate':'2026-10-13','bodySha256':sha(body.encode()),
        'snapshotSha256':sha(snapshot.read_bytes())},'bossNodes':['G','N','Z'],'terminalNodes':['R'],
        'bossPhases':{'gauge1':['G'],'gauge2':['N'],'gauge3':['Z']},
        'phaseNotes':{'gauge1':'运输阶段；第二出发点尚未解锁。','gauge2':'需先完成运输并抵达 R 点，解锁第二出发点。',
                      'gauge3':'需先击破第二血条，开放 Q→U、Q→W 及 Z 点。'},
        'branchPoints':branches,'machineRules':rules,'fixedEdges':fixed,'deadEnds':['F','M','R','S','T','Y','Q2#gauge2'],
        'unavailableByPhase':{'gauge1':['H','R']+late,'gimmick':late,'gauge2':['S','T','U','V','W','X','Y','Z']},
        'graphComplete':True,'evaluation':{'mode':'reviewedMachineRules','notes':['所选阶段表示规划前提，不执行或自动判断解锁。Q1索敌数值仍未知。']},
        'ngaReview':{'date':'2026-10-14','priority':'用户指定NGA原文为主来源','changedNodes':[],
            'addedNodes':list(rules),'referenceNotes':['Q1索敌门槛未给出，不猜数值。'],
            'supplementaryNodes':list(fixed)+['I','O']},
        'airControl':{'source':WIKI,'coverage':'routeEncounterTables','profiles':[]}}
    encounter_path = ROOT/'data/sortie/encounters/5-6.json'
    if encounter_path.exists():
        encounters = read(encounter_path)
        for phase, nodes in [('gauge1',['C','C1','D','G']),('gauge2',['L','N']),('gauge3',['X','Z'])]:
            for node in nodes:
                rows = [p for group in encounters['nodes'][node]['phases'].values() for p in group['patterns']]
                powers = [p.get('enemyAirPower') for p in rows if isinstance(p.get('enemyAirPower'), (int,float))]
                if powers:
                    power = max(powers)
                    result['airControl']['profiles'].append({'id':phase+node,'node':node,'label':node+' 点',
                        'phase':phase,'superiority':math.ceil(power*1.5),'supremacy':power*3})
    write(ROOT/'data/normal_routes/5-6.json',result)
    guides=read(ROOT/'data/normal_route_guides.json')
    entries=[('gauge1',[('轻型运输流',['A','C2','D','E','G'],[[16,3,2,2,2,2],[6,3,2,2,2,2]]),
                         ('航战运输流',['A','B','C2','D','E','G'],[[10,10,2,2,2,2]])]),
             ('gauge2',[('高速空母流',['I','J','K','L','N'],[[11,11,6,3,2,2],[11,7,6,3,2,2]])]),
             ('gauge3',[('U点推进流',['I','O','Q','U','X','Z'],[[8,11,5,3,2,2],[8,8,11,3,2,2]]),
                         ('轻巡驱逐流',['I','O','Q','W','X','Z'],[[8,11,3,2,2,2],[11,11,3,2,2,2]])])]
    for phase,rows in entries:
        routes=[]
        for name,nodes,templates in rows:
            r={'name':name,'nodes':nodes,'templates':[[[t] for t in row] for row in templates]}
            if name=='航战运输流': r['fleetRequirement']=count([10],exact=2)
            if name=='高速空母流': r['fleetRequirement']=count(CV,min=1)
            if name=='轻巡驱逐流': r['fleetRequirement']=allof(count([3],min=1),count([2],min=3))
            routes.append(r)
        guides['maps']['5-6:'+phase]={'source':WIKI,'retrievedAt':'2026-10-14','routingSource':post['source'],
            'nameReview':{'date':'2026-10-14','basis':'中文Wiki推荐配置、NGA带路规则与游戏实际坐标；按血条阶段和舰种/经由点命名。'},'routes':routes}
    write(ROOT/'data/normal_route_guides.json',guides)

def assets():
    references=Path(os.environ.get('FLEET_ADVISOR_MAP_REFERENCES') or ROOT.parent/'map-references/fleet-advisor').expanduser().resolve()
    if references.is_relative_to(ROOT):
        raise ValueError('Map reference directory must be outside the project')
    references.mkdir(parents=True,exist_ok=True)
    # Node/edge identities reviewed against the labelled game sprites and Wiki
    # map. Their geometry never supplies branching rules to the route engine.
    ids=['1','A1','A2','A','B','C1','C2','C','D','E','F','G','A2','B','C2','C2','C','C','H','R',
         'I','J','K1','K','K2','L','M','N','O','P','Q','Q1','Q2','K','L','2','S','T','U','V','W','X','Y','Z','X','X','Q2','T','W']
    origins=[None,'1','1','1','A2','B','A','A2','C2','D','E','E','A1','A','B','C1','B','C1','C','H',
             '2','I','J','J','K','K','L','L','I','O','O','P','Q1','K1','K2',None,'Q1','Q1','Q','Q2','V','W','X','X','V','U','Q','Q2','Q']
    parts=[]; hashes=[];resources=[];height=0;frames={};spots={};lines={}
    for suffix in ['', '18','20','36']:
        info=read(STAGED/f'06_info{suffix}.json');atlas=read(STAGED/f'06_image{suffix}.json')
        im=Image.open(STAGED/f'06_image{suffix}.png').convert('RGBA');parts.append((im,height))
        resources.append(dict(path=f'/kcs2/resources/map/005/06_image{suffix}.png',
            sha256=sha((STAGED/f'06_image{suffix}.png').read_bytes()),width=im.width,height=im.height,offsetY=height,
            fallbackUrl=BASE+f'06_image{suffix}.png'))
        for name,frame in atlas['frames'].items():
            frame=copy.deepcopy(frame);frame['frame']['y']+=height;frames[name]=frame
        for s in info['spots']:
            n=s['no'];id=ids[n];spots[id]=[s['x'],s['y'],'start' if id in ['1','2'] else 'node']
            if 'line' not in s: continue
            img=s['line'].get('img',f'route_{n}');names=[k for k in frames if k.endswith('_'+img)]
            if len(names)!=1: raise ValueError((n,img,names))
            lines[origins[n]+'>'+id]={'x':s['x']+s['line']['x'],'y':s['y']+s['line']['y'],'sprite':frames[names[0]]}
        for name in [f'06_info{suffix}.json',f'06_image{suffix}.json',f'06_image{suffix}.png']:
            hashes.append({'url':BASE+name,'sha256':sha((STAGED/name).read_bytes())})
        height+=im.height
    packed=Image.new('RGBA',(max(i.width for i,_ in parts),height))
    for im,y in parts: packed.paste(im,(0,y))
    dest=references/'5-6.png';packed.save(dest)
    manifest=read(ROOT/'data/sortie/maps/index.json')
    manifest['maps']['5-6']={'image':'5-6.png','width':1200,'height':720,'spriteWidth':packed.width,'spriteHeight':packed.height,
        'backgrounds':[frames['map00506_map5-6']], 'spots':spots,'starts':['1','2'],'lines':lines,
        'missingCoordinates':[],'missingLineSprites':[],'resources':resources,
        'source':{'kind':'gamePhasedAtlas','url':WIKI,'retrievedAt':'2026-10-14','sha256':sha(dest.read_bytes()),
                  'assets':hashes,'packing':'lossless vertical atlas; source frame positions offset only'}}
    write(ROOT/'data/sortie/maps/index.json',manifest)

if __name__=='__main__':
    navigation()
    assets()
    references=os.environ.get('FLEET_ADVISOR_MAP_REFERENCES') or str(ROOT.parent/'map-references/fleet-advisor')
    subprocess.run([sys.executable, str(ROOT/'tools/data/optimize-map-assets.py'),
                    '--reference-dir',references,'--areas','5-6'], check=True)
    subprocess.run([sys.executable, str(ROOT/'tools/data/generate-route-label-anchors.py'),
                    '--reference-dir',references,'--areas','5-6'], check=True)
    print('Built 5-6 route rules, five guide routes and full phased game atlas.')
