'use strict';
// A hypothetical, unmodified equipment outfit for an opponent. These are
// developable items, not observed equipment and not the player's inventory.
// Development references: https://wikiwiki.jp/kancolle/開発 and item pages.
const {canEquip}=require('../fleet/equipment_rules');
const AIRCRAFT=new Set([6,7,8,9,10,11,25,26,41,45,56,57,58,59]);
const GUN_SMALL=[3,2],GUN_LIGHT=[340,5,65],GUN_HEAVY=[356,90,5],GUN_LARGE=[298,245,9,8];
const TORPEDO=[15],SUB_TORPEDO=[213,15],RECON=[59],BOMBER=[207,26],SONAR=[47],PROJECTOR=[45],DEPTH=[226],RADAR=[27];
const FIGHTER=[22,21],DIVE=[57],ATTACK=[52],MIDGET=[41];
// Transport ships have unusually restricted gun mounts. E-type and the 8 cm
// secondary gun are developable; anti-air guns cover unarmed auxiliaries.
const AUX_GUN=[382,66,4,3,2],MACHINE_GUN=[40,39];
const role=(ids,ordering='ordinary')=>({ids,ordering});
const repeat=(ids,count,ordering)=>Array.from({length:count},()=>role(ids,ordering));
function roles(type){
  switch(type){
    case 1:return [role(SONAR),role(PROJECTOR),role(DEPTH),role(SONAR),role(GUN_SMALL),role(RADAR)];
    case 2:return [...repeat(GUN_SMALL,2),role(RADAR),role(TORPEDO),role(SONAR),role(GUN_SMALL)];
    case 3:case 21:return [...repeat(GUN_LIGHT,2),role(RECON,'airSmall'),role(TORPEDO),role(RADAR),role(SONAR)];
    case 4:return [role(MIDGET),...repeat(GUN_LIGHT,2),role(RECON,'airSmall'),role(TORPEDO),role(RADAR)];
    case 5:return [...repeat(GUN_HEAVY,2),role(RECON,'airSmall'),role(TORPEDO),role(RADAR),role(GUN_HEAVY)];
    case 6:return [...repeat(GUN_HEAVY,2),role(BOMBER,'airLarge'),role(RECON,'airSmall'),role(TORPEDO),role(RADAR)];
    case 7:case 11:case 18:return [role(ATTACK,'airLarge'),role(DIVE,'airLarge'),...repeat(FIGHTER,4,'airSmall'),role(RADAR),role(GUN_LIGHT)];
    case 8:case 9:case 12:return [...repeat(GUN_LARGE,2),role(RECON,'airSmall'),role([36]),role(RADAR),role(GUN_LARGE)];
    case 10:return [...repeat(GUN_LARGE,2),role(BOMBER,'airLarge'),role([36]),role(RECON,'airSmall'),role(RADAR)];
    case 13:case 14:return repeat(SUB_TORPEDO,6);
    case 16:return [role(MIDGET),role(BOMBER,'airLarge'),role(RECON,'airSmall'),...repeat(GUN_LIGHT,2),role(RADAR)];
    case 17:case 19:case 20:return [...repeat(AUX_GUN,2),role(RADAR),role(SONAR),role(MACHINE_GUN),role(GUN_SMALL)];
    case 22:return [role(BOMBER,'airLarge'),role(AUX_GUN),role(RECON,'airSmall'),role(RADAR),...repeat(MACHINE_GUN,2)];
    default:return null;
  }
}
const unknown=reason=>({status:'unknown',reason});
function generate(store,enemy){
  if(!enemy?.known||!Array.isArray(enemy.ships)||!enemy.ships.length)return unknown('对手舰队资料待同步');
  if(!store?.const?.$ships||!store?.const?.$equips||!store.const.$shipTypes)return unknown('装备主数据或舰种规则缺失');
  // A private virtual store gives each template ship/item its own instance.
  // Its inventory is independent of the user's fleet, owned gear, and caches.
  const virtual={const:store.const,selectorTables:store.selectorTables,info:{ships:{},equips:{}}};
  const result=[];let equipInstance=0;
  for(let index=0;index<enemy.ships.length;index++){
    const source=enemy.ships[index],masterId=Number(source.masterId),master=store.const.$ships[masterId],type=Number(master?.api_stype);
    if(!master||!Number.isSafeInteger(masterId)||masterId<=0)return unknown('对手舰娘主数据缺失');
    const plan=roles(type);if(!plan)return unknown('该舰种的参考配装尚未收录');
    const count=master.api_slot_num;
    // api_maxeq is padded for many ships; its length does not prove slot count.
    if(!Number.isSafeInteger(count)||count<0||count>6||count>0&&(!Array.isArray(master.api_maxeq)||master.api_maxeq.length<count||
      master.api_maxeq.slice(0,count).some(n=>!Number.isSafeInteger(n)||n<0)))return unknown('对手舰娘槽位资料缺失');
    const sid=index+1;virtual.info.ships[sid]={api_id:sid,api_ship_id:masterId,api_slot_ex:0};
    const used=new Set(),slots=[];
    for(const group of plan){
      const free=Array.from({length:count},(_,i)=>i).filter(i=>!used.has(i));if(!free.length)break;
      const priority=free.sort((a,b)=>group.ordering==='airLarge'?master.api_maxeq[b]-master.api_maxeq[a]||a-b:
        master.api_maxeq[a]-master.api_maxeq[b]||a-b);
      let found=false,anyMaster=false;
      for(const equipId of group.ids){
        const item=store.const.$equips[equipId];if(!item||!Array.isArray(item.api_type))continue;
        anyMaster=true;
        const instance=++equipInstance;virtual.info.equips[instance]={api_slotitem_id:equipId,api_level:0};
        for(const slot of priority){
          if(AIRCRAFT.has(Number(item.api_type[2]))&&master.api_maxeq[slot]<=0)continue;
          let legal;try{legal=canEquip(virtual,sid,instance,slot);}catch(_){return unknown('舰娘装备资格资料缺失');}
          if(!legal)continue;
          slots.push({slot,masterId:equipId,master:item});used.add(slot);found=true;break;
        }
        if(found)break;
      }
      if(!anyMaster)return unknown('参考装备主数据缺失');
    }
    const armed=new Set([1,2,3,4,5,7,8,11,14,15,22,32,57,58]);
    // Some oilers cannot mount offensive weapons at all (e.g. Nankai).
    // A legal defensive-only fit is still a valid estimate for those ships.
    const defensiveOnly=type===22&&slots.some(item=>[12,14,21].includes(Number(item.master.api_type[2])));
    if(count>0&&!defensiveOnly&&!slots.some(item=>armed.has(Number(item.master.api_type[2]))))return unknown('该舰暂无可用的参考武器');
    if(count>0&&[7,11,18].includes(type)&&!slots.some(item=>[7,8,57,58].includes(Number(item.master.api_type[2]))))
      return unknown('该空母暂无可用的参考攻击机');
    slots.sort((a,b)=>a.slot-b.slot);
    result.push({masterId,level:source.level??null,master,slots});
  }
  return {status:'estimated',ships:result};
}
module.exports={generate};
