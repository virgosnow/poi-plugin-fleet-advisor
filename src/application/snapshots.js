'use strict';
const crypto=require('crypto');
const {normalizeName}=require('../shared/name_matching');
const {createEquipmentPlanner}=require('../domain/fleet/equipment_planner');
const R=require('../domain/fleet/equipment_rules');

// Snapshots are immutable, so a longer cache TTL costs nothing: staleness at
// preview/execute is caught by the live fingerprint, not by this expiry. Each
// read slides the expiry forward because paged agents can sit minutes between
// calls (a fixed 5-minute window used to expire mid-scan).
const TTL_MS=15*60*1000;
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const {error}=require('../shared/errors');
const integer=value=>Number.isSafeInteger(value)&&value>0;

// Sortable keys and projectable fields are fixed allowlists per kind. Every
// sort falls back to instanceId so pages stay deterministic in both
// directions; name uses plain code-unit comparison (locale-aware collation
// would vary with the host ICU build).
const SHIP_SORTS=['instanceId','masterId','name','shipType','level','condition'];
const EQUIPMENT_SORTS=['instanceId','masterId','name','type','improvement','proficiency'];
const SHIP_FIELDS=['instanceId','masterId','name','shipType','level','fleet','position','expedition',
  'repairing','locked','hp','maxHp','condition','fuel','ammo','speed','firepower','torpedo','antiAir',
  'armor','evasion','antiSubmarine','lineOfSight','luck','slots','slotCapacity','expansionOpen',
  'expansionItemId','attributeSource'];
const EQUIPMENT_FIELDS=['instanceId','masterId','name','type','iconType','improvement','proficiency',
  'locked','location','sourceShipId','sourceSlot','baseIndex','sourceAvailable','equipable',
  'equipableReason','baseStats'];

function normalizeSort(query,allowed){
  const sort=query.sort||'instanceId',order=query.order||'asc';
  if(!allowed.includes(sort))throw error('INVALID_QUERY',`sort 仅支持 ${allowed.join('、')}`);
  if(order!=='asc'&&order!=='desc')throw error('INVALID_QUERY','order 仅支持 asc 或 desc');
  return (a,b)=>{
    const av=a[sort],bv=b[sort],direction=order==='desc'?-1:1;
    // null (unknown) sorts last under either direction; ties break by id.
    if(av===null&&bv===null)return a.instanceId-b.instanceId;
    if(av===null)return 1;
    if(bv===null)return -1;
    const compared=typeof av==='string'?(av<bv?-1:av>bv?1:0):av-bv;
    return compared!==0?compared*direction:a.instanceId-b.instanceId;
  };
}

// fields projection keeps instanceId and name even when unlisted: without the
// identity pair a projected row cannot be used in a later scheme.
function normalizeFields(query,allowed){
  if(query.fields===undefined)return null;
  if(!Array.isArray(query.fields)||!query.fields.every(field=>typeof field==='string'))
    throw error('INVALID_QUERY','fields 须为字符串数组');
  const unknown=query.fields.filter(field=>!allowed.includes(field));
  if(unknown.length)throw error('INVALID_QUERY',`未知字段: ${unknown.join('、')}；可用字段 ${allowed.join('、')}`);
  const wanted=new Set(['instanceId','name',...query.fields]);
  return row=>Object.fromEntries([...wanted].map(field=>[field,row[field]===undefined?null:row[field]]));
}

function businessState(state) {
  const info=state?.info,masters=state?.const;
  if(!info||!info.ships||!info.equips||!Array.isArray(info.fleets)||!masters?.$ships||!masters?.$equips)
    throw error('STORE_NOT_READY','poi 尚未提供完整的舰队、舰娘、装备和主数据');
  return {info:{basic:info.basic||null,ships:info.ships,equips:info.equips,fleets:info.fleets,
    repairs:info.repairs||[],airbase:info.airbase||[],resources:info.resources||null,maps:info.maps||{},
    presets:info.presets||null,useitems:info.useitems||{},server:info.server||null},
    const:{$ships:masters.$ships,$equips:masters.$equips,$shipTypes:masters.$shipTypes||{},
      $missions:masters.$missions||{},$maps:masters.$maps||{},$useitems:masters.$useitems||{},
      $equipShip:masters.$equipShip||{},$exslotEquips:masters.$exslotEquips||[],
      $exslotEquipShips:masters.$exslotEquipShips||{},$exslotEquipLimits:masters.$exslotEquipLimits||{}},
    expeditionProgress:state.expeditionProgress||null,
    ...(state.selectorTables?{selectorTables:state.selectorTables}:{})};
}

function fingerprint(state) {
  const s=businessState(state);
  const {$maps,$useitems,...executionMasters}=s.const;
  // A conservative whole-account fingerprint makes a stale preview fail
  // closed. It excludes UI state, clocks and unrelated quest/map changes.
  return hash({basic:s.info.basic,ships:s.info.ships,equips:s.info.equips,fleets:s.info.fleets,
    repairs:s.info.repairs,airbase:s.info.airbase,masters:executionMasters,selectorTables:s.selectorTables});
}

function paginate(snapshot,kind,rows,query) {
  const limit=query.limit===undefined?50:Number(query.limit);
  if(!Number.isInteger(limit)||limit<1||limit>100)throw error('INVALID_QUERY','limit 须为 1–100');
  const key=hash({snapshotId:snapshot.id,kind,query:{...query,cursor:undefined,limit:undefined}});
  let offset=0;
  if(query.cursor){
    try{
      const parsed=JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8'));
      if(parsed.key!==key||!Number.isSafeInteger(parsed.offset)||parsed.offset<0||parsed.offset>rows.length)throw Error('cursor mismatch');
      offset=parsed.offset;
    }catch(_){throw error('INVALID_CURSOR','游标不属于此快照或筛选条件');}
  }
  const page=rows.slice(offset,offset+limit);
  const next=offset+limit<rows.length?Buffer.from(JSON.stringify({key,offset:offset+limit})).toString('base64url'):null;
  return {snapshotId:snapshot.id,total:rows.length,items:page,nextCursor:next};
}

function ownership(store) {
  const owned=new Map();
  for(const [sid,ship] of Object.entries(store.info.ships)){
    (ship.api_slot||[]).forEach((id,index)=>{if(id>0)owned.set(Number(id),{location:'ship',sourceShipId:Number(sid),sourceSlot:index});});
    if(ship.api_slot_ex>0)owned.set(Number(ship.api_slot_ex),{location:'ship',sourceShipId:Number(sid),sourceSlot:'ex'});
  }
  (store.info.airbase||[]).forEach((base,baseIndex)=>(base.api_plane_info||[]).forEach((plane,index)=>{
    if(plane?.api_slotid>0)owned.set(Number(plane.api_slotid),{location:'airbase',baseIndex,sourceSlot:index});
  }));
  return owned;
}

class Snapshots {
  constructor(getStore,now=()=>Date.now()) {this.getStore=getStore;this.now=now;this.items=new Map();}
  create() {
    const capturedAt=this.now(),store=clone(businessState(this.getStore()));
    const id=crypto.randomUUID(),snapshot={id,store,capturedAt,expiresAt:capturedAt+TTL_MS};
    this.items.set(id,snapshot);
    for(const [key,value] of this.items)if(value.expiresAt<=capturedAt||this.items.size>5)this.items.delete(key);
    return {snapshotId:id,capturedAt:new Date(capturedAt).toISOString(),lastGameUpdateAt:null,
      lastGameUpdateReason:'poi store 未提供统一的最近更新时刻',expiresAt:new Date(snapshot.expiresAt).toISOString(),
      shipCount:Object.keys(store.info.ships).length,equipmentCount:Object.keys(store.info.equips).length,
      fleets:store.info.fleets.map((fleet,index)=>({fleet:index+1,shipIds:(fleet.api_ship||[]).filter(id=>id>0)})),
      resources:store.info.resources};
  }
  get(id) {
    const item=this.items.get(id);
    if(!item||item.expiresAt<=this.now())throw error('SNAPSHOT_EXPIRED','快照不存在或已过期，请重新读取账号');
    item.expiresAt=this.now()+TTL_MS;
    return item;
  }
  queryShips(query) {
    const snapshot=this.get(query.snapshotId),s=snapshot.store,name=query.name?normalizeName(query.name):null;
    const fleetPosition=new Map();s.info.fleets.forEach((fleet,index)=>(fleet.api_ship||[]).forEach((id,position)=>{
      if(id>0)fleetPosition.set(Number(id),{fleet:index+1,position:position+1,expedition:Number(fleet.api_mission?.[0])!==0});
    }));
    const repairs=new Set((s.info.repairs||[]).map(d=>Number(typeof d==='object'?d.api_ship_id:d)));
    const rows=Object.entries(s.info.ships).map(([key,ship])=>{
      const id=Number(key),master=s.const.$ships[ship.api_ship_id]||{},position=fleetPosition.get(id)||null;
      return {instanceId:id,masterId:Number(ship.api_ship_id),name:master.api_name||'',shipType:Number(master.api_stype)||null,
        level:Number(ship.api_lv)||null,fleet:position?.fleet||null,position:position?.position||null,
        expedition:position?.expedition||false,repairing:repairs.has(id)||ship.api_situation===2,
        locked:!!ship.api_locked,hp:ship.api_nowhp??null,maxHp:ship.api_maxhp??null,condition:ship.api_cond??null,
        fuel:ship.api_fuel??null,ammo:ship.api_bull??null,speed:ship.api_soku??null,
        firepower:ship.api_karyoku??null,torpedo:ship.api_raisou??null,antiAir:ship.api_taiku??null,
        armor:ship.api_soukou??null,evasion:ship.api_kaihi??null,
        antiSubmarine:ship.api_taisen??null,lineOfSight:ship.api_sakuteki??null,luck:ship.api_lucky??null,
        slots:(ship.api_slot||[]).slice(0,master.api_slot_num??ship.api_slotnum??ship.api_slot.length).map(Number),
        slotCapacity:(ship.api_onslot||[]).slice(0,master.api_slot_num??ship.api_slotnum??ship.api_slot.length),
        expansionOpen:ship.api_slot_ex!==0,expansionItemId:ship.api_slot_ex>0?Number(ship.api_slot_ex):null,
        attributeSource:'poi info.ships raw; 裸装/装备加成未拆分'};
    }).filter(row=>(!name||normalizeName(row.name).includes(name))
      &&(query.fleet===undefined||row.fleet===query.fleet)
      &&(query.shipType===undefined||row.shipType===query.shipType))
      .sort(normalizeSort(query,SHIP_SORTS));
    const project=normalizeFields(query,SHIP_FIELDS),result=paginate(snapshot,'ships',rows,query);
    if(project)result.items=result.items.map(project);
    return result;
  }
  queryEquipment(query) {
    const snapshot=this.get(query.snapshotId),s=snapshot.store,name=query.name?normalizeName(query.name):null,owners=ownership(s);
    const planner=createEquipmentPlanner(()=>s);
    const rows=Object.entries(s.info.equips).map(([key,item])=>{
      const id=Number(key),master=s.const.$equips[item.api_slotitem_id]||{},source=owners.get(id)||{location:'free'};
      const sourceAvailable=source.location==='free'||source.location==='ship'&&planner.availableShip(source.sourceShipId);
      const row={instanceId:id,masterId:Number(item.api_slotitem_id),name:master.api_name||'',
        type:Number(master.api_type?.[2])||null,iconType:Number(master.api_type?.[3])||null,
        improvement:Number(item.api_level)||0,proficiency:Number(item.api_alv)||0,
        locked:!!item.api_locked,...source,sourceAvailable,
        baseStats:Object.fromEntries(['api_houg','api_raig','api_tyku','api_tais','api_saku','api_baku','api_souk','api_houm']
          .filter(key=>master[key]!==undefined).map(key=>[key,master[key]]))};
      if(query.targetShipId!==undefined){
        try{
          const slot=query.slot===undefined?0:query.slot;
          row.equipable=R.canEquip(s,query.targetShipId,id,slot)&&sourceAvailable&&
            (source.location!=='ship'||source.sourceShipId===query.targetShipId||R.acceptsOtherSlot(s,query.targetShipId,id,slot));
          row.equipableReason=row.equipable?null:!sourceAvailable?'装备在基地或来源舰不可借用':'舰娘或槽位不允许此装备';
        }catch(e){row.equipable=null;row.equipableReason=e.message;}
      }
      return row;
    }).filter(row=>(!name||normalizeName(row.name).includes(name))
      &&(query.location===undefined||row.location===query.location)
      &&(query.type===undefined||row.type===query.type)
      &&(query.improvement===undefined||row.improvement===query.improvement)
      &&(query.availableOnly!==true||row.sourceAvailable===true)
      &&(query.equipableOnly!==true||row.equipable===true))
      .sort(normalizeSort(query,EQUIPMENT_SORTS));
    const project=normalizeFields(query,EQUIPMENT_FIELDS),result=paginate(snapshot,'equipment',rows,query);
    if(project)result.items=result.items.map(project);
    return result;
  }
}
module.exports={Snapshots,businessState,fingerprint,ownership,error,
  TTL_MS,SHIP_SORTS,EQUIPMENT_SORTS,SHIP_FIELDS,EQUIPMENT_FIELDS};
