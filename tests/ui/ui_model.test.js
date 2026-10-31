'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../../src/ui/shell/model');
test('host renders do not forward changing game props into the memoized panel',()=>{
  let inner;
  const React={createElement:(type,props)=>({type,props}),memo:component=>{inner=component;return {memoized:component};}};
  const Panel=require('../../src/ui/shell/panel')(React,{getController:()=>null,getStore:()=>({}),subscribe:()=>()=>{}});
  const first=Panel({gameResponse:1}),next=Panel({gameResponse:2});
  assert.equal(first.type,next.type);assert.equal(first.type.memoized,inner);
  assert.equal(first.props,undefined);assert.equal(next.props,undefined);
});
test('scheme parser rejects array/null and accepts a valid empty document',()=>{
  for(const value of ['null','[]','{fleet:1}'])assert(M.parse(value).error);
  assert.deepEqual(M.parse(M.format({fleet:2,ships:[]})).value,{fleet:2,ships:[]});
});

test('tail-only organization removal reports its exact fleet position',()=>{
  assert.equal(M.progressText({phase:'remove-escort',fleet:2,slot:6},{}),'第 2 舰队 · 正在移除第 6 位多余舰娘');
});

test('panel preview and execution finish without asynchronous log errors and record the final state',async()=>{
  const createPanel=require('../../src/ui/shell/panel');
  const React={createElement:(type,props,...children)=>({type,props:props||{},children}),
    useState:init=>[typeof init==='function'?init():init,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}};
  const plan={kind:'fleet',fleet:1,organization:{fleet:1,current:[{ships:[1]}],targets:[1],done:true},
    equipment:{fleet:1,ships:[],donors:[],done:true},done:true};
  const state={info:{ships:{1:{api_ship_id:1,api_lv:1}}},const:{$ships:{1:{api_name:'ship'}}}};
  const button=(node,label)=>{
    if(!node||typeof node!=='object')return null;
    if(node.type==='button'&&node.children.includes(label))return node;
    for(const child of node.children||[]){const found=button(child,label);if(found)return found;}
    return null;
  };
  for(const [preview,run,expected] of [[()=>plan,async()=>({ok:true,done:true,changed:0}),/success · 已符合方案/],
    [()=>{throw Error('preview failed');},async()=>({}),/error · 未能完成 · preview failed/]]){
    const logs=[];
    const Panel=createPanel(React,{getController:()=>({preview,run,getExperimentalSettings:()=>({automaticOperations:true})}),getStore:()=>state,subscribe:()=>()=>{},appendLog:x=>logs.push(x)});
    const findWorkbench=node=>node?.type?.name==='Workbench'?node:
      (node?.children||[]).flat(Infinity).map(findWorkbench).find(Boolean);
    const workbench=findWorkbench(Panel());
    await workbench.props.onApply({fleet:1,ships:[{id:1}]});
    assert.equal(logs.length,1);assert.equal(logs[0].kind,'fleet');assert.match(logs[0].status,expected);
  }
});
