'use strict';

const {normalizeName}=require('../../shared/name_matching');
const {speed}=require('../fleet/fleet_metrics');
const MET='met',UNMET='unmet',UNKNOWN='unknown';
const all=states=>states.includes(UNMET)?UNMET:states.includes(UNKNOWN)?UNKNOWN:MET;
const any=states=>states.includes(MET)?MET:states.includes(UNKNOWN)?UNKNOWN:UNMET;
const negate=status=>status===UNKNOWN?UNKNOWN:status===MET?UNMET:MET;
const result=value=>value?MET:UNMET;
const TYPES={1:'海防',2:'驱逐',3:'轻巡',4:'雷巡',5:'重巡',6:'航巡',7:'轻空母',8:'高速战舰',9:'战舰',10:'航战',11:'正规空母',13:'潜水舰',14:'潜水空母',16:'水母',17:'扬陆舰',18:'装甲空母',19:'工作舰',20:'潜水母舰',21:'练巡',22:'补给舰'};
const COUNTRIES={US:'美国舰',GB:'英国舰',UK:'英国舰',DE:'德国舰',IT:'意大利舰',FR:'法国舰',RU:'苏联舰',SE:'瑞典舰',AU:'澳大利亚舰',NL:'荷兰舰'};

function selectorLabel(selector={}){
  if(selector.not)return `非${selectorLabel(selector.not)}`;
  if(selector.anyOf)return selector.anyOf.map(selectorLabel).join('／');
  if(selector.allOf)return selector.allOf.filter(s=>s.kind!=='shipType'||s.stypeIds?.length<20).map(selectorLabel).join('且');
  switch(selector.kind){
    case 'ship':case 'shipClass':return selector.name||'指定舰娘';
    case 'shipType':return (selector.stypeIds||[]).map(id=>TYPES[id]||`舰种${id}`).join('／');
    case 'country':return COUNTRIES[selector.code]||`${selector.code}舰`;
    case 'level':return `等级≥${selector.min}`;
    case 'speed':return `速力≥${{5:'低速',10:'高速',15:'高速强化',20:'最速'}[selector.min]||selector.min}`;
    case 'remodelName':return selector.contains;
    case 'shipTypeExclusion':return `非${selector.stypeIds.map(id=>TYPES[id]||id).join('／')}`;
    default:return '条件待确认';
  }
}
function ruleLabel(rule={}){
  if(rule.anyOf)return `任选：${rule.anyOf.map(ruleLabel).join(' 或 ')}`;
  if(rule.allOf)return rule.allOf.filter(r=>r.kind!=='freeSlots').map(ruleLabel).join('，');
  if(rule.kind==='count'){
    const position=rule.positions?.length===1?(rule.positions[0]===1?'旗舰：':`第${rule.positions[0]}舰：`):
      rule.positions?.length?'随伴：':'';
    const quantity=rule.max===0?'不得编入':rule.min===rule.max?`${rule.min}艘`:
      rule.max===undefined?`≥${rule.min||0}艘`:`${rule.min||0}–${rule.max}艘`;
    return `${position}${selectorLabel(rule.selector)} ${quantity}`;
  }
  if(rule.kind==='fleetSize')return `舰数${rule.exact!==undefined?'＝'+rule.exact:rule.max!==undefined?'≤'+rule.max:'≥'+rule.min}`;
  if(rule.kind==='forbiddenCount')return `${selectorLabel(rule.selector)}不得恰好${rule.equal}艘`;
  return rule.kind==='freeSlots'?'自由舰位':'条件待确认';
}

function familyIndex(masters){
  const parent=new Map();
  const find=id=>{if(!parent.has(id))parent.set(id,id);let p=parent.get(id);if(p!==id){p=find(p);parent.set(id,p);}return p;};
  for(const [key,master] of Object.entries(masters)){
    const id=Number(master.api_id||key),after=Number(master.api_aftershipid);
    find(id);if(after>0&&masters[after])parent.set(find(after),find(id));
  }
  return find;
}
function context(state,slots,shared){
  const masters=shared?.masters||state?.const?.$ships||{},find=shared?.find||familyIndex(masters);
  const rows=(slots||[]).map((entry,index)=>{
    const id=Number(entry?.id??entry?.shipId??entry),ship=state?.info?.ships?.[id];
    if(!(id>0))return null;
    const master=ship&&masters[ship.api_ship_id];
    return {id,ship,master,position:index+1,entry:typeof entry==='object'?entry:{id},
      family:master?find(Number(ship.api_ship_id)):null};
  }).filter(Boolean);
  return {state,rows,masters,find,speed:new Map()};
}
function selectorStatus(selector,row,ctx){
  if(selector?.not)return negate(selectorStatus(selector.not,row,ctx));
  if(selector?.anyOf)return any(selector.anyOf.map(s=>selectorStatus(s,row,ctx)));
  if(selector?.allOf)return all(selector.allOf.map(s=>selectorStatus(s,row,ctx)));
  if(!selector||!row.ship||!row.master)return UNKNOWN;
  const master=row.master;
  switch(selector.kind){
    case 'ship':{
      if(selector.masterIds?.includes(Number(row.ship.api_ship_id)))return MET;
      const name=normalizeName(master.api_name||''),wanted=normalizeName(selector.name||'');
      // Ordinary suffix remodels preserve the requested form. Rename and
      // aircraft-carrier conversions are never accepted by family alone.
      if(wanted&&name===wanted)return MET;
      if(wanted&&name.startsWith(wanted)&&/^(?:改(?:二|三|四)?[甲乙丙丁戊重特]?|[甲乙丙丁戊重特])$/.test(name.slice(wanted.length)))return MET;
      const requestedForm=wanted.match(/^(.*)改([二三四]?)([甲乙丙丁戊重特]?)$/);
      const currentForm=name.match(/^(.*)改([二三四]?)([甲乙丙丁戊重特]?)$/);
      if(requestedForm&&currentForm&&requestedForm[1]===currentForm[1]&&!requestedForm[3]){
        const rank={'':1,二:2,三:3,四:4};
        if(rank[currentForm[2]]>=rank[requestedForm[2]])return MET;
      }
      const related=selector.masterIds?.some(id=>ctx.masters[id]&&ctx.find(id)===row.family);
      return related?UNKNOWN:UNMET;
    }
    case 'country':return selector.masterIds?.length?result(selector.masterIds.includes(Number(row.ship.api_ship_id))):UNKNOWN;
    case 'shipType':return master.api_stype===undefined?UNKNOWN:result(selector.stypeIds.includes(Number(master.api_stype)));
    case 'shipClass':return master.api_ctype===undefined?UNKNOWN:result(selector.ctypeIds.includes(Number(master.api_ctype)));
    case 'shipTypeExclusion':return master.api_stype===undefined?UNKNOWN:result(!selector.stypeIds.includes(Number(master.api_stype)));
    case 'remodelName':return master.api_name?result(normalizeName(master.api_name).includes(normalizeName(selector.contains))):UNKNOWN;
    case 'level':return row.ship.api_lv===undefined?UNKNOWN:result(Number(row.ship.api_lv)>=selector.min);
    case 'speed':{
      if(!ctx.speed.has(row.id)){
        try{
          const before={slots:row.ship.api_slot||[],ex:row.ship.api_slot_ex??-1};
          const after={slots:row.entry.slots||before.slots,ex:row.entry.ex??before.ex};
          ctx.speed.set(row.id,speed(ctx.state,[{id:row.id,ship:row.ship,master,before,after}]).fleetSpeedCode??null);
        }catch{ctx.speed.set(row.id,null);}
      }
      const value=ctx.speed.get(row.id);return value===null?UNKNOWN:result(value>=selector.min);
    }
    default:return UNKNOWN;
  }
}

function countReading(rule,ctx){
  const readings=ctx.rows.filter(row=>!rule.positions||rule.positions.includes(row.position)).map(row=>({row,status:selectorStatus(rule.selector,row,ctx)}));
  const yes=readings.filter(r=>r.status===MET).map(r=>r.row.position),maybe=readings.filter(r=>r.status!==UNMET).map(r=>r.row.position);
  const low=yes.length,high=maybe.length,min=Number(rule.min||0),max=rule.max??Infinity;
  const status=low>max||high<min?UNMET:low>=min&&high<=max?MET:UNKNOWN;
  return {status,low,high,yes,maybe};
}

// A complete anyOf branch is chosen before assigning roles. A flagship or
// companion may fill one distinct role, never two requirements at once.
function plans(node){
  if(Array.isArray(node.anyOf))return node.anyOf.flatMap(plans);
  if(Array.isArray(node.allOf))return node.allOf.reduce((acc,child)=>acc.flatMap(a=>plans(child).map(b=>a.concat(b))),[[]]);
  return [[node]];
}
function assignmentPossible(groups,allowUnknown){
  const demands=groups.flatMap(group=>Array.from({length:Number(group.min||0)},()=>allowUnknown?group.reading.maybe:group.reading.yes)).sort((a,b)=>a.length-b.length);
  const assign=(index,used)=>index===demands.length||demands[index].some(position=>!used.has(position)&&assign(index+1,new Set([...used,position])));
  return demands.length<=6&&assign(0,new Set());
}
function planStatus(plan,ctx,distinct){
  const groups=[],statuses=[];
  for(const rule of plan){
    if(rule.kind==='freeSlots'){if(rule.required)statuses.push(UNKNOWN);continue;}
    if(rule.kind==='count'){
      const reading=countReading(rule,ctx);statuses.push(reading.status);
      if(rule.scope!=='fleetTotal')groups.push({...rule,reading});
    }else if(rule.kind==='fleetSize'){
      const size=ctx.rows.length;statuses.push(result((rule.exact===undefined||size===rule.exact)&&(rule.min===undefined||size>=rule.min)&&(rule.max===undefined||size<=rule.max)));
    }else if(rule.kind==='forbiddenCount'){
      const reading=countReading({...rule,min:0},ctx);
      statuses.push(reading.low===reading.high?result(reading.low!==rule.equal):rule.equal<reading.low||rule.equal>reading.high?MET:UNKNOWN);
    }else statuses.push(UNKNOWN);
  }
  if(distinct&&groups.length){
    statuses.push(assignmentPossible(groups,false)?MET:assignmentPossible(groups,true)?UNKNOWN:UNMET);
  }
  return all(statuses);
}
function evaluateFleetRequirements(fleet,state,slots,deckId,shared){
  const ctx=context(state,slots,shared),checks=[];
  const add=(label,status,actual,required)=>checks.push({label,status,...actual!==undefined?{actual}:{},...required!==undefined?{required}:{}});
  const size=ctx.rows.length;
  if(!size)add('请先选择舰娘',UNKNOWN);
  for(const [key,sign,test] of [['sizeMin','≥',(a,b)=>a>=b],['sizeMax','≤',(a,b)=>a<=b],['sizeExact','＝',(a,b)=>a===b]]){
    if(fleet[key]!==undefined)add(`舰数${sign}${fleet[key]}`,result(test(size,fleet[key])),size,fleet[key]);
  }
  if(fleet.fleetIndex!==undefined)add(`第${fleet.fleetIndex}舰队`,deckId===undefined?UNKNOWN:result(Number(deckId)===fleet.fleetIndex),deckId,fleet.fleetIndex);
  if(fleet.uniqueShipFamilies){
    const known=ctx.rows.filter(row=>row.family!==null).map(row=>row.family);
    const status=new Set(known).size!==known.length?UNMET:known.length!==size?UNKNOWN:MET;
    if(status!==MET)add('同舰娘的不同实例／形态不能重复计入',status);
  }
  const expression={allOf:fleet.allOf||[]};
  const top=fleet.anyOf?{anyOf:fleet.anyOf}:expression;
  const flatten=node=>node.allOf&&!node.anyOf?node.allOf.flatMap(flatten):[node];
  const nodes=top.anyOf?[top]:top.allOf.flatMap(flatten);
  for(const rule of nodes){
    if(rule.kind==='freeSlots')continue;
    if(rule.kind==='fleetSize'&&['exact','min','max'].every(key=>rule[key]===undefined||
      fleet[{exact:'sizeExact',min:'sizeMin',max:'sizeMax'}[key]]===rule[key]))continue;
    const status=any(plans(rule).map(plan=>planStatus(plan,ctx,!!fleet.distinctCompositionGroups)));
    const reading=rule.kind==='count'?countReading(rule,ctx):null;
    add(ruleLabel(rule),status,reading?(reading.low===reading.high?reading.low:`${reading.low}–${reading.high}`):undefined);
  }
  const total=any(plans(top).map(plan=>planStatus(plan,ctx,!!fleet.distinctCompositionGroups)));
  if(total!==MET&&all(checks.map(c=>c.status))===MET)add('每艘舰娘分别满足一个指定舰位／编成角色',total);
  return {status:all([total,...checks.map(check=>check.status)]),checks};
}

function createFleetRequirementEvaluator(state){
  const masters=state?.const?.$ships||{},shared={masters,find:familyIndex(masters)};
  return (fleet,slots,deckId)=>evaluateFleetRequirements(fleet,state,slots,deckId,shared);
}
module.exports={evaluateFleetRequirements,createFleetRequirementEvaluator,selectorLabel,ruleLabel};
