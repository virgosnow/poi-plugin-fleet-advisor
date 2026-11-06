'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const picker=require('../../src/ui/components/ship_picker');
test('ship picker presents status or next remodel in a single secondary line',()=>{
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
 const ShipPicker=picker(React),store={info:{ships:{1:{api_ship_id:9,api_lv:42,api_cond:49,api_nowhp:8,api_maxhp:20}}},const:{$ships:{9:{api_aftershipid:'10',api_afterlv:50}}}};
 const row={id:1,name:'测试舰',type:'驱逐',level:42,fleet:1,cond:49,preferenceReasons:['测试筛选']};
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 assert(!walk(ShipPicker({index:0,rows:[row],store,kind:'normal',hint:'换入后自动推荐装备'})).some(n=>n.props.className==='paa-muted paa-ship-picker-hint'));
 for(const [kind,expected] of [['normal','驱逐 · Lv.42 · 中破'],['expedition','驱逐 · Lv.42 · 中破'],['practice','驱逐 · Lv.42 · 下一改造 Lv.50']]){
   const tree=ShipPicker({index:0,rows:[row],store,kind});const button=walk(tree).find(n=>n.type==='button'&&n.props.key===1);
   const lines=walk(button).filter(n=>n.type==='small');assert.equal(lines.length,1);assert.deepEqual(lines[0].children,[expected]);
   assert(walk(button).every(n=>!n.props['data-tooltip']&&!n.props.title));
   const unavailable=ShipPicker({index:0,rows:[{...row,unavailable:'远征中'}],store,kind});
   const disabled=walk(unavailable).find(n=>n.type==='button'&&n.props.key===1);
   assert.equal(disabled.props.disabled,true);assert.match(walk(disabled).find(n=>n.type==='small').children[0],/远征中/);
   assert(walk(disabled).every(n=>!n.props['data-tooltip']&&!n.props.title));
 }
 assert.equal(picker.currentStatus(store.info.ships[1],{unavailable:'远征中'}),'远征中');
 assert.equal(picker.nextRemodel({api_aftershipid:'0'},store.info.ships[1]),'无后续改造');
 assert.equal(picker.nextRemodel({},store.info.ships[1]),'改造等级待确认');
 assert.equal(picker.matchesLock(store,1,'all'),true);
 assert.equal(picker.matchesLock(store,1,'locked'),false);
 assert.equal(picker.matchesLock(store,1,'unlocked'),false,'unknown lock state is not treated as unlocked');
 store.info.ships[1].api_locked=0;assert.equal(picker.matchesLock(store,1,'unlocked'),true);
 store.info.ships[1].api_locked=1;assert.equal(picker.matchesLock(store,1,'locked'),true);
});

test('ship picker keeps a bounded scroll window and preserves selection and availability',()=>{
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})},ShipPicker=picker(React);
 const rows=Array.from({length:100},(_,i)=>({id:i+1,name:`舰娘 ${i+1}`,type:'驱逐',level:i+1,unavailable:i===77?'远征中':null}));
 const store={info:{ships:{}},const:{$ships:{}}};let selected=null;
 const render=windowScroll=>ShipPicker({index:0,rows,store,kind:'normal',windowScroll,onPick:row=>{selected=row.id;}});
 const walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];
 let tree=render(0),buttons=walk(tree).filter(n=>n.props['data-ship-index']!==undefined);
 assert.equal(buttons.length,20);assert.equal(buttons[0].props['data-ship-index'],0);
 tree=render(57*79);buttons=walk(tree).filter(n=>n.props['data-ship-index']!==undefined);
 assert.equal(buttons.find(n=>n.props['data-ship-index']===77).props.disabled,true);
 tree=render(57*99);buttons=walk(tree).filter(n=>n.props['data-ship-index']!==undefined);
 assert.equal(buttons.length,20);assert.equal(buttons.at(-1).props['data-ship-index'],99);
 buttons.at(-1).props.onClick();assert.equal(selected,100);
 assert.match(walk(tree).find(n=>n.props.className==='paa-ship-picker-count').children[0],/100 艘/);
});

test('keyboard navigation reaches ships beyond the previous limit and skips unavailable rows',()=>{
 const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})},ShipPicker=picker(React);
 const rows=Array.from({length:500},(_,i)=>({id:i+1,name:`舰娘 ${i+1}`,type:'驱逐',level:1,unavailable:i===81?'远征中':null}));
 const store={info:{ships:{}},const:{$ships:{}}},walk=node=>node&&typeof node==='object'?[node,...(node.children||[]).flatMap(walk)]:[];let scroll=0,focus='',prevented=false;
 const tree=ShipPicker({index:0,rows,store,kind:'normal',windowScroll:57*65,onWindowScroll:value=>{scroll=value;}});
 const list=walk(tree).find(n=>n.props['aria-label']==='舰娘列表');
 const element={scrollTop:0,ownerDocument:{defaultView:{requestAnimationFrame:fn=>fn()}},querySelector:selector=>({focus:()=>{focus=selector;}})};
 list.props.onKeyDown({key:'Tab',target:{closest:()=>({dataset:{shipIndex:'80'}})},currentTarget:element,preventDefault:()=>{prevented=true;}});
 assert(prevented);assert.equal(scroll,57*78);assert.equal(element.scrollTop,scroll);assert.match(focus,/82/);
});
