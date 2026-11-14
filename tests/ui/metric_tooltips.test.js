'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../../src/ui/models/metric_tooltips'),V=require('../../src/ui/models/presentation_model');
const {renderStructured,structuredWidth}=require('../../src/ui/components/tooltip');
const fixture=require('../helpers/workbench_fixture');
const doc={createElement:tag=>({tag,className:'',style:{},children:[],textContent:'',appendChild(child){this.children.push(child);},prepend(child){this.children.unshift(child);}}),
 createElementNS:(_ns,tag)=>({tag,className:'',children:[],setAttribute(name,value){this[name]=value;},appendChild(child){this.children.push(child);}})};
const all=node=>[node,...node.children.flatMap(all)];
test('equipment and route metric hover text follows locale without translating game names',()=>{
 const i18n=require('../../src/shared/i18n'),display=require('../../src/ui/i18n/metric_display'),store=fixture();
 store.info.equips[101]={api_id:101,api_slotitem_id:501,api_level:6,api_alv:7};
 store.const.$equips[501]={api_id:501,api_name:'零式水上偵察機',api_type:[0,0,10,10]};
 const item={...V.equipmentItem(store,101,1),airPowerBasis:'制空按当前搭载',gunFitNote:'适重预估'};
 const data=JSON.parse(V.equipmentTooltipProps(item)['data-tooltip-content']);
 const speed=T.speed({valueLabel:'高速',ships:[]},{detail:'C/E/G 点 · 高速+以上'});
 const los=T.los({}, {state:'索敌达标',hint:'门槛 ≥ 29 · G→H · 共 2 处'});
 const render=x=>{const tip=doc.createElement('div');assert(renderStructured(doc,tip,JSON.stringify(x),store));return tip;};
 try{
  i18n.setLocale('ja-JP');let tip=render(data);
  assert.equal(V.equipmentTooltipProps(null)['data-tooltip'],'空きスロット');
  assert.equal(all(tip).find(n=>n.className==='paa-tooltip-heading').textContent,'2 スロット · 零式水上偵察機 ★6 · 熟練度 7');
  assert.match(all(tip).find(n=>n.className.includes('paa-tooltip-notes')).textContent,/現在の搭載数/);
  assert.deepEqual(display.notes(speed),['C/E/G マス · 高速+以上','編成後に各艦の速力を表示します。']);
  assert.match(display.notes(los)[0],/閾値 ≥ 29 · G→H · 全 2 箇所/);
  assert.equal(display.cell({displayKind:'fleet-air'},{columnKeys:['node']},0,'A（第 2 轮）'),'A（第2回）');
  i18n.setLocale('zh-TW');tip=render(data);
  assert.equal(all(tip).find(n=>n.className==='paa-tooltip-heading').textContent,'第 2 格 · 零式水上偵察機 ★6 · 熟練度 7');
  assert.match(all(tip).find(n=>n.className.includes('paa-tooltip-notes')).textContent,/適重為預估/);
  assert.match(display.notes(los)[0],/門檻 ≥ 29 · G→H · 共 2 處/);
  assert.equal(display.cell({displayKind:'fleet-air'},{columnKeys:['node']},0,'A（第 2 轮）'),'A（第 2 輪）');
 }finally{i18n.setLocale('zh-CN');}
});
test('air tooltip only shows the selected route loss table while keeping headline values',()=>{
 const store=fixture();store.info.equips[101]={api_slotitem_id:501,api_level:10};store.const.$equips[501]={api_name:'测试舰战'};
 const reading={status:'range',min:45,max:48,slots:[{shipId:1,slot:2,itemId:101,planes:[18,18],min:30,max:31},{shipId:2,slot:0,itemId:101,planes:[3,4],min:5,max:6},{shipId:1,slot:0,itemId:101,planes:[3,3],min:10,max:11},{shipId:3,slot:0,min:0,max:0}]};
 const step=(before,after)=>({node:'A',round:1,before,after,required:{superiority:30,supremacy:60}});
 const summary={state:'全程空优',reference:{nodes:[{id:'A',enemyAirPower:20}]},estimate:{paths:[{steps:[step({min:45,max:48},{min:40,max:42})]},{steps:[step({min:43,max:47},{min:39,max:41})]}]}};
 const before=JSON.stringify({reading,summary,store}),result=T.air(store,reading,summary);
 assert.equal(result.sections.length,1);
 assert.deepEqual(result.sections[0].columns,['节点','战前制空','敌方制空','预计结果']);
 assert.deepEqual(result.sections[0].rows,[['A','43–48','20','空优']]);
 assert.match(result.title,/综合制空：45–48/);
 assert.equal(JSON.stringify({reading,summary,store}),before);
 const missing=T.air(store,{status:'unknown',slots:[...reading.slots,{shipId:1,slot:1,itemId:999,unknown:'equipmentMaster'}]},null,{current:true});
 assert.match(missing.title,/综合制空：—/);assert.match(missing.notes[0],/实际搭载/);
 assert.equal(missing.sections.length,0,'current-fleet page has no selected-route loss table');
});

test('route air rows report exact and crossing state thresholds without claiming air supremacy for zero friendly aircraft',()=>{
 const store=fixture(),read=(before,enemy,extra={})=>T.air(store,{status:'range',min:0,max:0,slots:[]},{reference:{nodes:[{id:'A',enemyAirPower:enemy,...extra}]},estimate:{paths:[{steps:[{node:'A',round:1,before,required:{superiority:Math.max(1,Math.ceil((enemy??extra.upperBound)*1.5)),supremacy:Math.max(1,(enemy??extra.upperBound)*3)}}]}]}}).sections[0].rows[0];
 assert.deepEqual(read({min:60,max:60},20),['A','60','20','空确']);
 assert.equal(read({min:59,max:60},20)[3],'空优～空确');
 assert.equal(read({min:29,max:30},20)[3],'空均～空优');
 assert.equal(read({min:10,max:10},20)[3],'空劣');
 assert.equal(read({min:6,max:6},20)[3],'空丧');
 assert.equal(read({min:0,max:0},0)[3],'无制空');
 assert.equal(read({min:1,max:1},0)[3],'空确');
 assert.equal(read({min:60,max:60},null,{upperBound:20})[2],'20（上限）');
 assert.equal(read({min:60,max:60},null)[3],'待确认');
});
test('base-air attrition displays its conservative enemy range and possible results',()=>{
 const summary={reference:{landBase:true,nodes:[{id:'M',enemyAirPower:100}]},estimate:{paths:[{steps:[{
   node:'M',round:1,before:{min:80,max:90},required:{superiority:150,supremacy:300},
   requiredLow:{superiority:1,supremacy:1},enemyAirPowerRange:{min:0,max:100}}]}]}};
 const result=T.air(fixture(),{status:'range',min:80,max:90},summary);
 assert.deepEqual(result.sections[0].rows[0],['M','80–90','0–100','空均～空确']);
 assert(result.notes.some(note=>note.includes('非极限或保证')));
});
test('base-air displayed results use the post-base enemy range rather than its original air power',()=>{
 const step={node:'M',round:1,before:{min:90,max:90},required:{superiority:150,supremacy:300},
   requiredLow:{superiority:75,supremacy:150},enemyAirPowerRange:{min:50,max:60}};
 const summary={reference:{landBase:true,nodes:[{id:'M',enemyAirPower:100}]},estimate:{paths:[{steps:[step]}]}};
 const result=T.air(fixture(),{status:'range',min:90,max:90},summary);
 assert.deepEqual(result.sections[0].rows[0],['M','90','50–60','空优']);
});
test('speed rows preserve uncertain readings and distinguish native and boosted speed',()=>{
 const r=T.speed({valueLabel:'高速',ships:[{name:'甲',label:'高速',baseLabel:'低速',boosted:true,boostEquipment:['新型高温高圧缶 ★7','改良型艦本式タービン']},{name:'乙',label:'高速',boostEquipment:[]},{name:'丙',status:'unknown',label:'高速',reason:'资料缺失'}]},{detail:'D 点 · 高速以上'});
 assert.deepEqual(r.sections[0].rows[0],['旗舰','甲','低速 → 高速','新型高温高圧缶 ★7、改良型艦本式タービン']);
 assert.equal(r.sections[0].rows[2][2],'待确认');assert(r.notes.includes('D 点 · 高速以上'));
});
test('route LoS table uses every node coefficient instead of the current-fleet coefficient four default',()=>{
 const reading={status:'computed',scoresByCoefficient:{1:20,2:45,3:70,4:95}},summary={state:'索敌不足',checks:[{edge:'A→B',coefficient:1,requiredScore:25,score:20},{edge:'C→D',coefficient:2,requiredScore:40,score:45}]};
 assert.deepEqual(T.los(reading,summary).sections[0].rows,[['A→B','1','≥ 25','20.0'],['C→D','2','≥ 40','45.0']]);
 assert.deepEqual(T.los(reading,null,{current:true}).sections[0].rows,[['1','20.0'],['2','45.0'],['3','70.0'],['4','95.0']]);
});
test('equipment card rows, picker items and icon tooltips share signed base stats and improvement identity',()=>{
 const store=fixture();store.info.equips[101]={api_id:101,api_slotitem_id:501,api_level:6,api_alv:7};
 store.const.$equips[501]={api_name:'<测试飞机>',api_type:[0,0,7,7],api_houg:2,api_baku:11,api_houk:-2,api_tyku:0,api_leng:3,api_distance:5};
 const card=V.fleetRows(store,{ships:[{id:1,slots:[101],ex:0}]}).flatMap(s=>s.gearIcons)[0];
 const picker=V.equipmentItem(store,101,0);assert.deepEqual(card,picker);
 const props=V.equipmentTooltipProps(card),data=JSON.parse(props['data-tooltip-content']);
 assert.equal(data.equipmentTypeId,7);assert.match(props['data-tooltip'],/装备类型：舰上爆击机/);
 assert.equal(data.equipmentIcon,card.icon);
 assert.deepEqual(data.notes,[],'ordinary equipment does not repeat a generic explanatory paragraph');
 assert.deepEqual(data.sections[0].rows,[['火力','+2','爆装','+11'],['回避','-2','射程','长'],['航程','5','','']]);
 assert(data.compact);assert.equal(data.kind,'equipment');assert.deepEqual(data.sections[0].numeric,[1,3]);
 const tip=doc.createElement('div');renderStructured(doc,tip,JSON.stringify(data));
 assert.equal(tip.children[1].className,'paa-tooltip-equipment-type');assert.equal(tip.children[1].textContent,'装备类型：舰上爆击机');
 assert.match(tip.className,/paa-tooltip-equipment/);assert.equal(structuredWidth(data,1200),320);assert.equal(structuredWidth(data,210),194);
 const rendered=all(tip);assert.equal(rendered.filter(n=>n.tag==='dt').length,5);
 assert.equal(rendered.filter(n=>n.tag==='svg').length,5);assert.equal(rendered.find(n=>n.tag==='img').src,card.icon);
 assert.equal(rendered.filter(n=>n.tag==='dd').length,5);assert(!rendered.some(n=>n.tag==='th'));
 assert.deepEqual(rendered.filter(n=>n.className==='paa-tooltip-equipment-stat').map(n=>n.children.map(c=>[c.tag,c.textContent])),
   [[['dt','火力'],['dd','+2']],[['dt','爆装'],['dd','+11']],[['dt','回避'],['dd','-2']],[['dt','射程'],['dd','长']],[['dt','航程'],['dd','5']]]);
 assert(rendered.some(n=>n.textContent==='-2'&&n.className.includes('is-negative')));
 assert.match(data.title,/★6.*熟练度 7/);assert.match(props['data-tooltip'],/爆装 \+11/);
 const icon=require('../../src/ui/components/equipment_icon')({createElement:(type,props,...children)=>({type,props,children})})({item:card});
 assert.equal(icon.props['data-tooltip-content'],props['data-tooltip-content']);
});

test('equipment type is localized at render time and missing or new types use safe fallbacks',()=>{
 const i18n=require('../../src/shared/i18n'),types=require('../../src/ui/i18n/equipment_types');
 const data=JSON.parse(V.equipmentTooltipProps({name:'test',equipmentTypeId:7,stats:[['火力','+2']]})['data-tooltip-content']);
 try{
  for(const [locale,expected] of [['zh-CN','装备类型：舰上爆击机'],['ja-JP','装備種別：艦上爆撃機'],['zh-TW','裝備類型：艦上爆擊機']]){
   i18n.setLocale(locale);const tip=doc.createElement('div');assert(renderStructured(doc,tip,JSON.stringify(data)));
   assert.equal(tip.children[1].textContent,expected);
  }
  i18n.setLocale('zh-CN');assert.equal(types.label(8),'舰上攻击机');assert.equal(types.label(10),'水上侦察机');
  assert.equal(types.label(null),'待确认');assert.equal(types.label(777,'新種別'),'新種別');
  assert.equal(V.equipmentTooltipProps(null)['data-tooltip'],'空槽');
 }finally{i18n.setLocale('zh-CN');}
});

test('equipment tooltip shows current owned copies across improvements and equipped instances in every locale',()=>{
 const i18n=require('../../src/shared/i18n'),store=fixture();
 store.info.equips={101:{api_slotitem_id:501,api_level:0},102:{api_slotitem_id:501,api_level:10,api_alv:7},103:{api_slotitem_id:502}};
 store.info.ships[1].api_slot=[101,-1];store.const.$equips[501]={api_name:'舰爆',api_type:[0,0,7,7]};
 const item=V.equipmentItem(store,101,0),data=JSON.parse(V.equipmentTooltipProps(item)['data-tooltip-content']);
 assert.equal(data.equipmentMasterId,501);
 try{
  for(const [locale,expected] of [['zh-CN','持有 2 件'],['ja-JP','所持 2 個'],['zh-TW','持有 2 件']]){
   i18n.setLocale(locale);const tip=doc.createElement('div');assert(renderStructured(doc,tip,JSON.stringify(data),store));
   assert.equal(all(tip).find(n=>n.className==='paa-tooltip-equipment-owned').textContent,expected);
  }
  delete store.info.equips[102];const fresh=doc.createElement('div');renderStructured(doc,fresh,JSON.stringify(data),store);
  assert.equal(all(fresh).find(n=>n.className==='paa-tooltip-equipment-owned').textContent,'持有 1 件');
  delete store.info.equips[101];const empty=doc.createElement('div');renderStructured(doc,empty,JSON.stringify(data),store);
  assert.equal(all(empty).find(n=>n.className==='paa-tooltip-equipment-owned').textContent,'持有 0 件');
  const unknown=doc.createElement('div');renderStructured(doc,unknown,JSON.stringify(data),{});
  assert(!all(unknown).some(n=>n.className==='paa-tooltip-equipment-owned'));
 }finally{i18n.setLocale('zh-CN');}
});

test('reward item inventory uses materials or use items and localizes unknown values',()=>{
 const i18n=require('../../src/shared/i18n'),inventory=require('../../src/ui/models/reward_inventory');
 const store={info:{basic:{api_fcoin:123},resources:[1,2,3,4,50,60,70,80],useitems:{59:{api_count:3},57:{api_count:0}}},
   const:{$useitems:{59:{api_name:'給糧艦「伊良湖」'},57:{api_name:'勲章'}}}};
 assert.equal(inventory.rewardItemId({kind:13,id:1},store),1);
 assert.equal(inventory.rewardItemId({name:'开发资材'},store),3);
 assert.equal(inventory.rewardItemId({name:'勋章'},store),57);
 assert.equal(inventory.rewardItemId({name:'給糧艦「伊良湖」'},store),59);
 assert.equal(inventory.rewardItemId({kind:11,id:59},store),null);
 assert.deepEqual([1,2,3,4,31,32,33,34,44,57,59,96].map(id=>inventory.rewardOwnedCount(store,id)),[60,50,70,80,1,2,3,4,123,0,3,0]);
 assert.equal(inventory.rewardOwnedCount({info:{}},59),null);
 assert.equal(inventory.rewardOwnedCount({info:{resources:[]}},1),null);
 assert.equal(inventory.rewardOwnedCount({info:{useitems:{59:{api_count:-1}}}},59),null);
 try{
  for(const [locale,expected,unknown] of [['zh-CN','持有 3 件','持有数量待确认'],['ja-JP','所持 3 個','所持数は要確認'],['zh-TW','持有 3 件','持有數量待確認']]){
   i18n.setLocale(locale);const data=JSON.stringify({kind:'reward-item',title:'伊良湖',rewardItemId:59,sections:[]});
   const tip=doc.createElement('div');renderStructured(doc,tip,data,store);
   assert.equal(all(tip).find(n=>n.className==='paa-tooltip-reward-owned').textContent,expected);
   assert.equal(tip.children.length,1,'item tooltip only shows the owned count');
   const missing=doc.createElement('div');renderStructured(doc,missing,data,{});
   assert.equal(all(missing).find(n=>n.className==='paa-tooltip-reward-owned').textContent,unknown);
  }
 }finally{i18n.setLocale('zh-CN');}
});

test('equipment tooltip stays compact with no stats without affecting other structured tables',()=>{
 const data=JSON.parse(V.equipmentTooltipProps({name:'没有属性',stats:[]})['data-tooltip-content']);
 const tip=doc.createElement('div');assert(renderStructured(doc,tip,JSON.stringify(data)));
 assert.match(tip.className,/paa-tooltip-equipment/);assert.equal(data.notes[0],'无属性加成');
 assert.equal(structuredWidth(data,800),250);
 const equip=count=>({kind:'equipment',sections:[{layout:'equipment-stats',columns:['属性','数值','属性','数值'],rows:Array.from({length:count},(_,i)=>[`属性${i}`,String(i)])}]});
 assert.equal(structuredWidth(equip(1),800),250);assert.equal(structuredWidth(equip(2),800),250);
 assert.equal(structuredWidth(equip(3),800),285);assert.equal(structuredWidth(equip(4),800),320);assert.equal(structuredWidth(equip(8),800),320);
 assert.equal(structuredWidth(equip(4),320),304);
 assert.equal(structuredWidth({compact:true,sections:[{columns:['a','b','c','d'],rows:[]}]},800),360);
 assert.equal(structuredWidth({sections:[{columns:['a','b','c','d'],rows:[]}]},800),480);
});

test('equipment accuracy colors follow fit adjustment rather than total accuracy',()=>{
 const render=(accuracy,delta)=>{
   const props=V.equipmentTooltipProps({name:'主炮',stats:[['命中',accuracy],['火力','+3']],gunFit:{known:true,delta}});
   const data=JSON.parse(props['data-tooltip-content']),tip=doc.createElement('div');
   assert(renderStructured(doc,tip,JSON.stringify(data)));
   return {data,accuracy:all(tip).find(n=>n.tag==='dd'&&n.textContent===accuracy),fire:all(tip).find(n=>n.tag==='dd'&&n.textContent==='+3')};
 };
 const positive=render('-1（+5）',5);assert.equal(positive.data.sections[0].fitTone,'positive');
 assert.match(positive.accuracy.className,/is-fit-positive/);assert.doesNotMatch(positive.accuracy.className,/is-negative/);
 const negative=render('+1（-5）',-5);assert.equal(negative.data.sections[0].fitTone,'negative');
 assert.match(negative.accuracy.className,/is-fit-negative/);assert.doesNotMatch(negative.fire.className,/is-fit/);
 const zero=render('+3',0);assert.equal(zero.data.sections[0].fitTone,null);assert.doesNotMatch(zero.accuracy.className,/is-fit/);
});

test('equipment hover air power belongs to its ship, destination slot and exact equipment instance',()=>{
 const store=fixture();store.info.equips[101]={api_id:101,api_slotitem_id:501,api_level:6,api_alv:7};store.const.$equips[501]={api_name:'测试舰战',api_type:[0,0,6,6],api_tyku:10};
 const item=V.equipmentItem(store,101,2),reading={status:'range',slots:[{shipId:1,slot:2,itemId:101,min:47,max:49},{shipId:2,slot:2,itemId:102,min:80,max:81}]};
 const contextual=V.withAirPower(item,reading,1),props=V.equipmentTooltipProps(contextual),data=JSON.parse(props['data-tooltip-content']);
 assert.deepEqual(data.notes,['制空按出击前满载']);
 assert.deepEqual(data.sections[0].rows,[['对空','+10','制空值','47–49']]);assert.match(props['data-tooltip'],/制空值：47–49/);assert.equal(item.airPowerText,undefined);
 assert.equal(V.withAirPower(item,reading,2).airPowerText,'待确认','same slot on another ship does not reuse a different instance');
 assert.equal(V.withAirPower({...item,slot:1},reading,1).airPowerText,'待确认');
 assert.equal(V.withAirPower(item,null,1).airPowerText,'待计算');
 assert.equal(V.withAirPower(item,{slots:[{shipId:1,slot:2,itemId:101,min:0,max:0}]},1,{current:true}).airPowerText,'0');
 assert.equal(V.withAirPower(item,{slots:[{shipId:1,slot:2,itemId:101,unknown:'proficiency'}]},1).airPowerText,'待确认');
 assert.equal(V.withAirPower({...item,aircraftType:10},reading,1).airPowerText,'0','non-participating reconnaissance planes have no air contribution');
 assert.equal(V.withAirPower({...item,aircraftType:1},reading,1).airPowerText,undefined,'guns do not gain an aircraft-only value');
});
test('structured tooltip renders semantic table headers, numeric columns, totals and escaped text',()=>{
 const tip=doc.createElement('div'),data={title:'<img src=x>',sections:[{title:'贡献',columns:['舰娘','制空'],rows:[['<b>测试舰</b>','10–12']],numeric:[1],footer:['合计','10–12']}],notes:['未计道中损耗。']};
 assert(renderStructured(doc,tip,JSON.stringify(data)));
 const nodes=all(tip);assert.equal(nodes.find(n=>n.tag==='table').children[0].tag,'thead');
 assert.equal(nodes.find(n=>n.tag==='th').scope,'col');assert(nodes.some(n=>n.textContent==='<img src=x>'));
 assert(nodes.some(n=>n.textContent==='<b>测试舰</b>'));assert(nodes.some(n=>n.tag==='tfoot'));assert(!nodes.some(n=>n.tag==='img'||n.innerHTML));
 assert.equal(renderStructured(doc,doc.createElement('div'),'invalid'),false);
});

test('hover tables align identifiers centrally and numbers right without unbalanced paired attribute widths',()=>{
 const inspect=data=>{const tip=doc.createElement('div');renderStructured(doc,tip,JSON.stringify(data));const table=all(tip).find(n=>n.tag==='table');return {head:table.children[0].children[0].children,row:table.children[1].children[0].children};};
 const route=inspect(T.los({scoresByCoefficient:{1:20}},{checks:[{edge:'A→B',coefficient:1,requiredScore:25,score:20}]}));
 for(const [i,align]of ['left','center','right','right'].entries()){assert(route.head[i].className.includes('paa-tooltip-align-'+align));assert(route.row[i].className.includes('paa-tooltip-align-'+align));}
 const gear=inspect({compact:true,sections:[{columns:['属性','数值','属性','数值'],numeric:[1,3],rows:[['火力','+2','制空值','47–49']]}]});
 assert.deepEqual(gear.head.map(c=>c.style.width),['25%','25%','25%','25%']);
 for(const [i,align]of ['left','right','left','right'].entries())assert(gear.row[i].className.includes('paa-tooltip-align-'+align));
 const air=inspect({sections:[{columns:['节点','战前制空','敌方制空','预计结果'],numeric:[1,2],rows:[['A','180–190','100','空优']]}]});
 assert(air.row[0].className.includes('paa-tooltip-align-center'));assert(air.row[3].className.includes('paa-tooltip-align-center'));
});

test('tooltip alignment and fit color use semantic identifiers when labels change language',()=>{
 const reading={status:'range',min:45,max:45},summary={reference:{nodes:[{id:'A',enemyAirPower:20}]},estimate:{paths:[{steps:[{
   node:'A',round:1,before:{min:45,max:45},required:{superiority:30,supremacy:60}
 }]}]}};
 const air=T.air(fixture(),reading,summary);
 air.sections[0].columns=['マス','戦闘前','敵制空','判定'];
 const tip=doc.createElement('div');assert(renderStructured(doc,tip,JSON.stringify(air)));
 const table=all(tip).find(n=>n.tag==='table'),header=table.children[0].children[0].children,row=table.children[1].children[0].children;
 assert.deepEqual(header.map(c=>c.style.width),['18%','28%','28%','26%']);
 for(const [i,align]of ['center','right','right','center'].entries()){
  assert(header[i].className.includes('paa-tooltip-align-'+align));
  assert(row[i].className.includes('paa-tooltip-align-'+align));
 }
 const data=JSON.parse(V.equipmentTooltipProps({name:'主砲',stats:[['命中','-1（+5）'],['火力','+3']],gunFit:{known:true,delta:5}})['data-tooltip-content']);
 data.sections[0].rows[0][0]='命中率';
 const gear=doc.createElement('div');assert(renderStructured(doc,gear,JSON.stringify(data)));
 assert.match(all(gear).find(n=>n.tag==='dd'&&n.textContent==='-1（+5）').className,/is-fit-positive/);
});

test('tooltip headers and stat names translate without modifying the data or changing the layout',()=>{
 const {setLocale}=require('../../src/shared/i18n');
 const data={sections:[{columns:['节点','战前制空','敌方制空','预计结果'],columnKeys:['node','friendlyAir','enemyAir','outcome'],
   rows:[['A','45','20','空优']],numeric:[1,2]}]};
 const before=JSON.stringify(data);
 try{
  setLocale('ja-JP');const tip=doc.createElement('div');assert(renderStructured(doc,tip,JSON.stringify(data)));
  const table=all(tip).find(n=>n.tag==='table'),head=table.children[0].children[0].children;
  assert.deepEqual(head.map(c=>c.textContent),['マス','戦闘前制空値','敵制空値','予測結果']);
  assert.deepEqual(head.map(c=>c.style.width),['18%','28%','28%','26%']);
  assert.equal(JSON.stringify(data),before);
 }finally{setLocale('zh-CN');}
});
