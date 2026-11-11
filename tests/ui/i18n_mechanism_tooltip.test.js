'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const locale=require('../../src/shared/i18n'),tooltip=require('../../src/ui/components/tooltip');
const doc={createElement:()=>({className:'',style:{},children:[],textContent:'',appendChild(child){this.children.push(child);}})};
const all=n=>[n,...n.children.flatMap(all)],find=(n,cls)=>all(n).filter(x=>x.className.split(' ').includes(cls));
const render=(text,kind)=>{const tip=doc.createElement();tooltip.renderContent(doc,tip,text,kind);return tip;};

test('mechanism attack tooltip parses original data before translating, preserving names, powers and alignment',()=>{
  const raw='发动率：43.3%\n\n第 1 位 Nelson改\n昼战攻击力：192 × 1击\n夜战攻击力：待确认 × 1击';
  try{
    locale.setLocale('ja-JP');const ja=render(raw,'special-shelling');
    assert.match(ja.children[0].textContent,/発動率：43.3%/);
    assert.deepEqual(find(ja,'paa-tooltip-attack-title').map(n=>n.textContent),['Nelson改']);
    assert.deepEqual(find(ja,'paa-tooltip-attack-value').map(n=>n.textContent),['192 × 1回','要確認 × 1回']);
    assert.equal(find(ja,'paa-tooltip-attack-table').length,1);
    locale.setLocale('zh-TW');const tw=render(raw,'special-shelling');
    assert.deepEqual(find(tw,'paa-tooltip-attack-value').map(n=>n.textContent),['192 × 1擊','待確認 × 1擊']);
    assert.equal(find(tw,'paa-tooltip-attack-title')[0].textContent,'Nelson改');
  }finally{locale.setLocale('zh-CN');}
});

test('anti-air tooltip keeps its parsed columns and uncertainty in both languages',()=>{
  const raw='参考发动率：待确认\n\n1型：30.0%，固定击坠×1.4，保底+5机\n2型：待确认，击落加成待确认';
  try{
    locale.setLocale('ja-JP');const ja=render(raw,'aaci');
    const cells=find(ja,'paa-tooltip-aa-effect').map(n=>n.textContent);
    assert(cells.some(s=>s.includes('固定撃墜×1.4')&&s.includes('+5機')));
    assert(cells.some(s=>s.includes('未確認')||s.includes('要確認')));
    assert.equal(find(ja,'paa-tooltip-aa-grid').length,1);
    locale.setLocale('zh-TW');const tw=render(raw,'aaci');
    assert(find(tw,'paa-tooltip-aa-effect').some(n=>n.textContent.includes('固定擊墜×1.4')));
    assert.equal(find(tw,'paa-tooltip-aa-grid').length,1);
  }finally{locale.setLocale('zh-CN');}
});

test('mechanism badges localize only presentation while retaining raw tooltip and game-rule fields',()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const badges=require('../../src/ui/components/mechanism_badges')(React);
  const badge={key:'ground',label:'对地·登陆作战',variant:'landing',state:'ready',categories:[{id:'landing',label:'对地·登陆作战'}],detail:'攻击陆上目标时固定生效\n\n攻击力：100 × 1击'};
  try{
    locale.setLocale('ja-JP');let node=badges([badge])[0];
    assert(node.children.includes('対地・上陸作戦'));assert.equal(node.props['data-tooltip'],badge.detail);
    assert.equal(node.props['data-mechanism'],'ground');assert.match(node.props['aria-label'],/攻撃力：100 × 1回/);
    locale.setLocale('zh-TW');node=badges([badge])[0];assert(node.children.includes('對陸·登陸作戰'));
    assert.equal(badge.label,'对地·登陆作战');assert.equal(badge.categories[0].id,'landing');
  }finally{locale.setLocale('zh-CN');}
});

test('structured aircraft and special attack tooltips use attack fields rather than detail wording',()=>{
  const React={createElement:(type,props,...children)=>({type,props:props||{},children:children.flat()})};
  const badges=require('../../src/ui/components/mechanism_badges')(React);
  const aircraft={key:'opening-air',state:'ready',label:'开幕航空攻击',detail:'unrelated text',
    tooltipData:{kind:'aircraft',activation:'有可用攻击机时固定发动',notes:['按出击前满载；未计损耗、触接与暴击。']},
    attacks:[{slot:0,name:'瑞雲',planes:18,powers:[74,138]}]};
  const special={key:'special-shelling',state:'conditional',label:'Nelson Touch',detail:'changed wording',
    tooltipData:{kind:'special',activation:'发动率：43.3%',notes:[]},
    attacks:[{position:1,name:'Nelson改',day:192,night:null,hits:1}]};
  const night={key:'night',effect:'torpedo',state:'ready',label:'夜战雷击 CI',detail:'changed wording',
    tooltipData:{kind:'modes',activation:'changed wording',activationRows:[{key:'rate',percent:.433},{key:'mode',label:'鱼雷×2',percent:.2}],notes:[]},
    attacks:[{id:'torpedoDouble',label:'鱼雷×2',power:192,hits:2}]};
  const ground={key:'ground',state:'ready',label:'对地攻击',detail:'changed wording',
    tooltipData:{kind:'ground',activation:'攻击陆上目标时固定生效',notes:[],canDay:true,surfaceNight:true},
    attacks:[{label:'集積地棲姫',day:190,dayHits:2,night:210,nightHits:1}]};
  const antiAir={key:'aaci',state:'ready',label:'对空特攻',detail:'changed wording',
    tooltipData:{kind:'antiAir',rate:.3,fleetRate:.5,showFleetRate:true,notes:['提升全队击落，每战择一。'],cutins:[{id:1,rate:.3,multiplier:1.4,fixed:5}]}};
  try{
    for(const language of ['ja-JP','zh-TW']){
      locale.setLocale(language);
      const renderBadge=badge=>{const node=badges([badge])[0],tip=doc.createElement();
        assert(tooltip.renderStructured(doc,tip,node.props['data-tooltip-content']));return tip;};
      const a=renderBadge(aircraft),s=renderBadge(special);
      assert.match(find(a,'paa-tooltip-attack-title')[0].textContent,/瑞雲/);
      assert.match(find(a,'paa-tooltip-attack-value')[0].textContent,/74.*138/);
      assert.equal(find(s,'paa-tooltip-attack-title')[0].textContent,'Nelson改');
      assert.match(find(s,'paa-tooltip-attack-value')[0].textContent,/192/);
      assert(!all(a).some(n=>n.textContent.includes('unrelated text')));
      const n=renderBadge(night),g=renderBadge(ground);
      assert.match(n.children[0].textContent,/43\.3%/);
      assert.match(n.children[0].textContent,/魚雷×2/);
      assert.match(find(n,'paa-tooltip-attack-value')[0].textContent,/192/);
      assert.equal(find(g,'paa-tooltip-attack-title')[0].textContent,'集積地棲姫');
      assert.equal(find(g,'paa-tooltip-attack-value').length,2);
      const aa=renderBadge(antiAir);assert.equal(find(aa,'paa-tooltip-aa-grid').length,1);
      assert.match(find(aa,'paa-tooltip-aa-effect').at(-1).textContent,/1\.4/);
    }
  }finally{locale.setLocale('zh-CN');}
});

test('unsupported structured attack tables fall back without appending partial content',()=>{
  const tip=doc.createElement();
  const data={kind:'mechanism',sections:[],layout:'ground',mechanism:'ground',activation:'activation',canDay:true,surfaceNight:true,
    attacks:[{label:'A',day:100,dayHits:1,night:90,nightHits:1},{label:'B',day:120,dayHits:2,night:90,nightHits:1}]};
  assert.equal(tooltip.renderStructured(doc,tip,JSON.stringify(data)),false);
  assert.equal(tip.children.length,0);
});

test('aircraft title translates plane count only and jet steel remains a separate line',()=>{
  const raw='有可用攻击机时固定发动\n\n第 1 槽 噴式景雲改（34 架）\n攻击力：74 或 138 × 1击\n\n本舰钢材消耗：126／次';
  try{
    locale.setLocale('ja-JP');const tip=render(raw,'jet-assault');
    assert.equal(find(tip,'paa-tooltip-attack-title')[0].textContent,'噴式景雲改（34 機）');
    assert.equal(find(tip,'paa-tooltip-attack-value')[0].textContent,'74 または 138 × 1回');
    assert.match(tip.children[2].textContent,/鋼材消費：126／回/);
    locale.setLocale('zh-TW');const tw=render(raw,'jet-assault');
    assert.equal(find(tw,'paa-tooltip-attack-title')[0].textContent,'噴式景雲改（34 架）');
    assert.match(tw.children[2].textContent,/鋼材消耗：126／次/);
  }finally{locale.setLocale('zh-CN');}
});

test('cached fleet metrics translate at display time without changing raw ship names or numeric data',()=>{
  const T=require('../../src/ui/models/metric_tooltips');
  const raw=T.speed({valueLabel:'高速',ships:[{name:'瑞鶴改二',status:'known',boosted:true,baseLabel:'低速',label:'高速',boostEquipment:['新型高温高圧缶']}]});
  const serialized=JSON.stringify(raw),renderMetric=()=>{const tip=doc.createElement();assert.equal(tooltip.renderStructured(doc,tip,serialized),true);return tip;};
  try{
    locale.setLocale('ja-JP');const ja=renderMetric();
    assert.equal(find(ja,'paa-tooltip-heading')[0].textContent,'艦隊速力：高速');
    const cells=all(ja).filter(n=>n.className.includes('paa-tooltip-align')).map(n=>n.textContent);
    assert(cells.includes('瑞鶴改二'));assert(cells.includes('低速 → 高速'));assert(cells.includes('新型高温高圧缶'));
    locale.setLocale('zh-TW');const tw=renderMetric();assert.equal(find(tw,'paa-tooltip-heading')[0].textContent,'艦隊速力：高速');
    assert.equal(JSON.stringify(raw),serialized);
  }finally{locale.setLocale('zh-CN');}
});

test('metric notes preserve game names even when identical to translated labels',()=>{
  const T=require('../../src/ui/models/metric_tooltips');
  const reading={valueLabel:'高速',ships:[{name:'士气',status:'unknown',label:'高速',reason:'资料缺失'}]};
  const raw=T.speed(reading),serialized=JSON.stringify(raw),tip=doc.createElement();
  try{
    locale.setLocale('zh-TW');assert.equal(tooltip.renderStructured(doc,tip,serialized),true);
    const note=all(tip).find(n=>n.className.includes('paa-tooltip-notes'));assert(note);
    assert.equal(note.textContent,'士气：资料缺失');assert.equal(reading.ships[0].name,'士气');
  }finally{locale.setLocale('zh-CN');}
});

test('mechanism display keeps game equipment names even when they match translated words',()=>{
  const display=require('../../src/ui/i18n/mechanism_display');
  try{
    locale.setLocale('zh-TW');assert.equal(display.text('提速装备：士气'),'提速裝備：士气');
    locale.setLocale('ja-JP');assert.equal(display.aircraftTitle('瑞雲（待确认 架）'),'瑞雲（要確認 機）');
    assert.match(display.text('本舰钢材消耗：待确认／次'),/要確認／回/);
  }finally{locale.setLocale('zh-CN');}
});
