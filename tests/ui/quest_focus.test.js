'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createQuestFocus,rows}=require('../../src/ui/components/quest_focus');
test('task focus uses one viewport bottom and updates when resized',()=>{
  for(const top of [100,145,210]){
    let effect,resize;const styles={},root={scrollTop:120,getBoundingClientRect:()=>({bottom:900})};
    const win={innerHeight:900,addEventListener:(event,fn)=>{if(event==='resize')resize=fn;},removeEventListener(){}};
    const node={closest:()=>root,ownerDocument:{defaultView:win},getBoundingClientRect:()=>({top}),style:{setProperty:(key,value)=>styles[key]=value,removeProperty:key=>delete styles[key]}};
    const use=createQuestFocus({useRef:()=>({current:node}),useLayoutEffect:fn=>{effect=fn;},useEffect:()=>{}});
    use(true,false,()=>{});const cleanup=effect();assert.equal(root.scrollTop,0);
    assert.equal(top+parseInt(styles['--paa-quest-focus-height']),884);
    win.innerHeight=800;resize();assert.equal(top+parseInt(styles['--paa-quest-focus-height']),784);
    cleanup();assert.equal(styles['--paa-quest-focus-height'],undefined);
  }
});
test('compact sections restore the original layout without changing the draft',()=>{
  const h=(type,props,...children)=>({type,props:props||{},children:children.flat()});let closed=0;
  const draft=Object.freeze([{id:1}]),view=rows(h,[{key:'route',label:'路线',value:'—'}],()=>closed++,true);
  assert.equal(view.children.length,1);view.children[0].props.onClick();assert.equal(closed,1);assert.equal(draft[0].id,1);
});
test('a task toggle starts a bounded height transition and respects reduced motion',()=>{
  for(const reduced of [false,true]){
    let timer,changed,forced=0;const attrs={},styles={};
    const win={CSS:{supports:()=>true},matchMedia:()=>({matches:reduced}),setTimeout:fn=>(timer=fn,1),clearTimeout(){}};
    const node={ownerDocument:{defaultView:win},querySelector:()=>({getBoundingClientRect:()=>({height:74})}),
      style:{setProperty:(key,value)=>styles[key]=value,removeProperty:key=>delete styles[key]},
      setAttribute:(key,value)=>attrs[key]=value,removeAttribute:key=>delete attrs[key],get offsetHeight(){forced++;return 200;}};
    const use=createQuestFocus({useRef:()=>({current:node}),useLayoutEffect:()=>{},useEffect:()=>{}});
    const focus=use(false,false,value=>{changed=value;});focus.change(true);assert.equal(changed,true);
    if(reduced){assert.equal(timer,undefined);assert.equal(attrs['data-quest-transition'],undefined);}
    else{assert.equal(attrs['data-quest-transition'],'true');assert.equal(styles['--paa-quest-collapsed-height'],'74px');assert.ok(forced>=1);
      timer();assert.equal(attrs['data-quest-transition'],undefined);assert.equal(styles['--paa-quest-collapsed-height'],undefined);}
  }
});
test('compact headings start at their corresponding original sections',()=>{
  const offsets={},makeRow=(key,top)=>({dataset:{questFocusKey:key},getBoundingClientRect:()=>({top,height:32}),style:{
    setProperty:(name,value)=>{if(name==='--paa-quest-origin-offset')offsets[key]=value;},removeProperty(){}}});
  const rows=[makeRow('training',400),makeRow('opponent',440),makeRow('forecast',480)];
  rows[0].firstElementChild={getBoundingClientRect:()=>({top:126}),style:{setProperty(){},removeProperty(){}}};
  const top={'.paa-practice-training':120,'.paa-practice-training-title':135,'.paa-practice-opponent-section':230,'.paa-practice-forecast-section':320},properties={};
  const win={CSS:{supports:()=>true},matchMedia:()=>({matches:false}),getComputedStyle:()=>({paddingTop:'16px',paddingLeft:'16px',paddingRight:'16px',rowGap:'6px'}),setTimeout:()=>1,clearTimeout(){}};
  const node={ownerDocument:{defaultView:win},closest:()=>({dataset:{kind:'practice'}}),querySelectorAll:()=>rows,
    querySelector:selector=>selector in top?{getBoundingClientRect:()=>({top:top[selector]})}:{getBoundingClientRect:()=>({height:52})},
    style:{setProperty:(key,value)=>{properties[key]=value;},removeProperty:key=>delete properties[key]},setAttribute(){},removeAttribute(){},get offsetHeight(){return 200;}};
  const use=createQuestFocus({useRef:()=>({current:node}),useLayoutEffect:()=>{},useEffect:()=>{}});
  use(false,false,()=>{}).change(true);
  assert.deepEqual(offsets,{training:'-280px',opponent:'-210px',forecast:'-160px'});
  assert.equal(properties['--paa-quest-training-label-offset'],'9px');
});
test('closing preserves the summary height while the transition is initialized',()=>{
  const groupStyle={},group={getBoundingClientRect:()=>({height:112}),style:{setProperty:(key,value)=>groupStyle[key]=value,removeProperty:key=>delete groupStyle[key]}};
  let startingHeight,startingTransition,changed;
  const win={CSS:{supports:()=>true},matchMedia:()=>({matches:false}),setTimeout:()=>1,clearTimeout(){}};
  const node={ownerDocument:{defaultView:win},querySelector:selector=>selector==='.paa-quest-focus-rows'?group:null,
    style:{setProperty(){},removeProperty(){}},setAttribute(){startingHeight=groupStyle.height;startingTransition=groupStyle.transition;},
    removeAttribute(){},get offsetHeight(){return 200;}};
  const use=createQuestFocus({useRef:()=>({current:node}),useLayoutEffect:()=>{},useEffect:()=>{}});
  use(true,false,value=>{changed=value;}).change(false);
  assert.equal(startingHeight,'112px');assert.equal(startingTransition,'none');assert.equal(changed,false);
  assert.deepEqual(groupStyle,{});
});
