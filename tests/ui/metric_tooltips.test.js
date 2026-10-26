'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../../src/ui/models/metric_tooltips'),V=require('../../src/ui/models/presentation_model');
const {renderStructured}=require('../../src/ui/components/tooltip');
const fixture=require('../helpers/workbench_fixture');
const doc={createElement:tag=>({tag,className:'',style:{},children:[],textContent:'',appendChild(child){this.children.push(child);}})};
const all=node=>[node,...node.children.flatMap(all)];
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
 assert.deepEqual(data.sections[0].rows,[['火力','+2','爆装','+11'],['回避','-2','射程','长'],['航程','5','','']]);
 assert(data.compact);assert.deepEqual(data.sections[0].numeric,[1,3]);
 const tip=doc.createElement('div');renderStructured(doc,tip,JSON.stringify(data));
 const rendered=all(tip);assert.equal(rendered.filter(n=>n.tag==='dt').length,5);
 assert.equal(rendered.filter(n=>n.tag==='dd').length,5);assert(!rendered.some(n=>n.tag==='th'));
 assert(rendered.some(n=>n.textContent==='-2'&&n.className.includes('is-negative')));
 assert.match(data.title,/★6.*熟练度 7/);assert.match(props['data-tooltip'],/爆装 \+11/);
 const icon=require('../../src/ui/components/equipment_icon')({createElement:(type,props,...children)=>({type,props,children})})({item:card});
 assert.equal(icon.props['data-tooltip-content'],props['data-tooltip-content']);
});

test('equipment hover air power belongs to its ship, destination slot and exact equipment instance',()=>{
 const store=fixture();store.info.equips[101]={api_id:101,api_slotitem_id:501,api_level:6,api_alv:7};store.const.$equips[501]={api_name:'测试舰战',api_type:[0,0,6,6],api_tyku:10};
 const item=V.equipmentItem(store,101,2),reading={status:'range',slots:[{shipId:1,slot:2,itemId:101,min:47,max:49},{shipId:2,slot:2,itemId:102,min:80,max:81}]};
 const contextual=V.withAirPower(item,reading,1),props=V.equipmentTooltipProps(contextual),data=JSON.parse(props['data-tooltip-content']);
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
