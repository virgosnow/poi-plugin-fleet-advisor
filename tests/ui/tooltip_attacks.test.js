'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{renderContent}=require('../../src/ui/components/tooltip');
const doc={createElement:()=>({className:'',style:{},children:[],textContent:'',appendChild(child){this.children.push(child);}})};
const render=(text,kind='special-shelling')=>{const tip=doc.createElement();renderContent(doc,tip,text,kind);return tip;};
const descendants=node=>[node,...node.children.flatMap(descendants)];
const find=(node,cls)=>descendants(node).filter(n=>n.className.split(' ').includes(cls));
test('special attack table keeps participants, day/night columns and reference powers associated',()=>{
 const body='第 1 位 Nelson改\n昼战攻击力：168 × 1击\n夜战攻击力：240 × 1击\n第 3 位 长门改二\n昼战参考攻击力：99 × 1击\n夜战攻击力：180 × 1击';
 const tip=render('发动率：75.9%\n要求阵型：复纵阵\n\n'+body+'\n\n每次出击 1 次。');
 assert.equal(tip.children.length,3);assert.equal(find(tip,'paa-tooltip-attack-table').length,1);
 assert.deepEqual(find(tip,'paa-tooltip-attack-title').map(n=>n.textContent),['Nelson改','长门改二']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-label').map(n=>n.textContent),['位置','参与舰','昼战','夜战']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-index').map(n=>n.textContent),['位置','1','3']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-reference').map(n=>n.textContent),['参考']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-value').map(n=>n.textContent),['168 × 1击','240 × 1击','99 × 1击','180 × 1击']);
 assert.equal(tip.children[0].textContent,'发动率：75.9%\n要求阵型：复纵阵');assert.equal(tip.children[2].textContent,'每次出击 1 次。');
});

test('night-only and missing metrics never shift a power into the wrong table column',()=>{
 const night=render('发动率：50.0%\n\n第 1 位 金刚\n夜战攻击力：312 × 1击\n第 2 位 榛名\n夜战攻击力：324 × 1击','special-night');
 assert.deepEqual(find(night,'paa-tooltip-attack-label').map(n=>n.textContent),['位置','参与舰','夜战']);
 const mixed=render('待确认\n\n第 1 位 甲\n昼战攻击力：100 × 2击\n夜战攻击力：200 × 1击\n第 2 位 乙\n夜战参考攻击力：待确认\n缺少属性。');
 assert.deepEqual(find(mixed,'paa-tooltip-attack-value').map(n=>n.textContent),['100 × 2击','200 × 1击','—','待确认']);
 const rows=find(mixed,'paa-tooltip-attack-table')[0].children[1].children;
 assert.equal(rows[1].children[0].textContent,'2');assert.equal(rows[1].children[1].textContent,'乙');
 assert.equal(rows[2].children[0].colSpan,4);assert.equal(rows[2].children[0].textContent,'缺少属性。');
});
test('slot attacks, CI alternatives and named ground targets each form their own group',()=>{
 for(const kind of ['opening-air','carrier-ci','night','ground']){
  const titles=kind==='opening-air'?['第 1 槽 流星改（24 架）','第 2 槽 彗星（18 架）']:kind==='ground'?['港湾棲姫（B 点）','炮台小鬼']:['FBA','BA'];
  const tip=render('发动率：50.0%\n\n'+titles.map((t,i)=>t+'\n攻击力：'+(100-i*20)+' × 1击').join('\n'),kind);
  assert.deepEqual(find(tip,'paa-tooltip-attack-title').map(n=>n.textContent),kind==='opening-air'?['流星改（24 架）','彗星（18 架）']:titles);assert.equal(tip.children.length,2);
  if(kind==='opening-air')assert.deepEqual(find(tip,'paa-tooltip-attack-label').map(n=>n.textContent),['槽位','装备','攻击力']);
 }
});

test('real jet badges render the same indexed aircraft table as opening air and keep steel outside it',()=>{
 const store=require('../helpers/workbench_fixture')(),jet=require('../../src/domain/combat/jet_aviation');
 store.info.resources=[1000,1000,1000,1000];
 Object.assign(store.const.$ships[1],{api_stype:18,api_maxeq:[34,12]});
 store.const.$shipTypes[18]={api_equip_type:{57:1}};
 const items=[199,200].map((mid,i)=>{
  const id=101+i,master={api_id:mid,api_name:i?'橘花改':'噴式景雲改',api_type:[0,0,57,57],api_baku:i?11:15};
  const instance={api_id:id,api_slotitem_id:mid,api_level:0};store.info.equips[id]=instance;store.const.$equips[mid]=master;
  return {id,type:57,master,instance};
 });
 const target={id:1,master:store.const.$ships[1],items,after:{slots:[101,102]}};
 const badge=jet.assaultBadge(target,store),tip=render(badge.detail,badge.key);
 const ordinary=render('有可用攻击机时固定发动\n\n第 1 槽 流星改（34 架）\n攻击力：74 或 138 × 1击\n第 2 槽 彗星（12 架）\n攻击力：67 × 1击\n\n开幕航空战中攻击敌舰。','opening-air');
 assert.deepEqual(find(tip,'paa-tooltip-attack-label').map(n=>n.textContent),['槽位','装备','攻击力']);
 assert.equal(find(tip,'paa-tooltip-attack-table')[0].className,find(ordinary,'paa-tooltip-attack-table')[0].className);
 assert.deepEqual(find(tip,'paa-tooltip-attack-index').map(n=>n.textContent),['槽位','1','2']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-title').map(n=>n.textContent),['噴式景雲改（34 架）','橘花改（12 架）']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-value').map(n=>n.textContent),['112 × 1击','63 × 1击']);
 assert.match(tip.children[2].textContent,/本舰钢材消耗：126／次/);
 assert.equal(find(tip,'paa-tooltip-attack-notes').length,0,'no repeated per-slot steel rows');
});

test('attack table headers and cells share alignment with bounded position, name and power columns',()=>{
 const tip=render('发动率：50.0%\n\n第 1 位 Nelson改\n昼战攻击力：168 × 1击\n夜战攻击力：240 × 1击\n第 3 位 长门改二\n昼战攻击力：99 × 1击\n夜战攻击力：140 × 1击');
 const table=find(tip,'paa-tooltip-attack-table')[0],head=table.children[0].children[0].children,row=table.children[1].children[0].children;
 assert(head[0].className.includes('paa-tooltip-align-center'));assert(row[0].className.includes('paa-tooltip-align-center'));
 assert(head[1].className.includes('paa-tooltip-align-left'));assert(row[1].className.includes('paa-tooltip-align-left'));
 for(const i of [2,3]){assert(head[i].className.includes('paa-tooltip-align-right'));assert(row[i].className.includes('paa-tooltip-align-right'));}
 const widths=head.map(cell=>parseFloat(cell.style.width));assert.equal(widths.reduce((a,b)=>a+b,0),100);assert(Math.max(...widths)/Math.min(...widths)<=2);
});

test('unrecognized or mixed position headings remain intact instead of guessing a position',()=>{
 const tip=render('固定发动\n\n旗舰 Nelson改\n昼战攻击力：168 × 1击\n第 3 位 长门改二\n昼战攻击力：99 × 1击');
 assert.equal(find(tip,'paa-tooltip-attack-indexed').length,0);
 assert.deepEqual(find(tip,'paa-tooltip-attack-title').map(n=>n.textContent),['旗舰 Nelson改','第 3 位 长门改二']);
});
test('ASW powers use formation and power column headers while keeping notes and unknown values',()=>{
 const tip=render('固定发动\n\n单横攻击力：133 × 1击\n单纵攻击力：61 × 1击\n提高对潜伤害。\n\n同航战。','asw-synergy');
 assert.deepEqual(find(tip,'paa-tooltip-attack-title').map(n=>n.textContent),['单横','单纵']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-label').map(n=>n.textContent),['阵型','攻击力']);
 assert.deepEqual(find(tip,'paa-tooltip-attack-value').map(n=>n.textContent),['133 × 1击','61 × 1击']);
 assert.equal(find(tip,'paa-tooltip-attack-notes')[0].textContent,'提高对潜伤害。');
 const unknown=render('待确认\n\n单横攻击力：待确认 × 1击\n单纵攻击力：待确认 × 1击','asw');
 assert.deepEqual(find(unknown,'paa-tooltip-attack-value').map(n=>n.textContent),['待确认 × 1击','待确认 × 1击']);
});

test('torpedo aircraft alternative powers stay together without fraction notation or inline probability',()=>{
 const tip=render('有可用攻击机时固定发动\n\n第 1 槽 流星改（24 架）\n攻击力：74 或 138 × 1击\n第 2 槽 彗星（18 架）\n攻击力：67 × 1击\n\n舰攻两档威力各约50%。','opening-air');
 assert.deepEqual(find(tip,'paa-tooltip-attack-short').map(n=>n.textContent),['74 或 138 × 1击','67 × 1击']);
 assert.equal(tip.children[2].textContent,'舰攻两档威力各约50%。');
});

test('single named opening, day and night attacks keep both method and power columns',()=>{
 for(const [kind,method] of [['torpedo','鱼雷'],['spotting','昼战连击'],['night','鱼雷×2'],['night-air','夜间航空攻击'],['carrier-ci','FBA']]){
  const tip=render('固定发动\n\n'+method+'\n攻击力：123 × 1击',kind);
  assert.deepEqual(find(tip,'paa-tooltip-attack-label').map(n=>n.textContent),['攻击方式','攻击力']);
  assert.deepEqual(find(tip,'paa-tooltip-attack-title').map(n=>n.textContent),[method]);
  assert.deepEqual(find(tip,'paa-tooltip-attack-value').map(n=>n.textContent),['123 × 1击']);
 }
});
test('single attacks have one power column without a redundant mechanism name; unfamiliar text stays literal',()=>{
 const simple=render('发动率：43.3%\n\n攻击力：192 × 1击','night');
 assert.equal(find(simple,'paa-tooltip-attack-single').length,1);assert.equal(find(simple,'paa-tooltip-attack-title').length,0);
 assert.deepEqual(find(simple,'paa-tooltip-attack-label').map(n=>n.textContent),['攻击力']);
 assert.deepEqual(find(simple,'paa-tooltip-attack-value').map(n=>n.textContent),['192 × 1击']);
 const unknown=render('待确认\n\n新的说明\n附加说明');assert.equal(unknown.children[1].textContent,'新的说明\n附加说明');
 const unsafe=render('固定发动\n\n<b>舰名</b>\n攻击力：待确认 × 1击\n原因：<img src=x>');
 assert.equal(find(unsafe,'paa-tooltip-attack-title')[0].textContent,'<b>舰名</b>');
 assert.equal(find(unsafe,'paa-tooltip-attack-notes')[0].textContent,'原因：<img src=x>');
});
