'use strict';
const {findDefinition}=require('../domain/quests/quest_requirements');
const periods={'日常':'daily','周常':'weekly','月常':'monthly','季常':'quarterly','年常':'yearly','单次':'once',
  '限时单次':'limited','限时周常':'limited','限时日常':'limited'};
const categories={2:'sortie',3:'practice',4:'expedition',8:'sortie',9:'sortie'};
const states={1:'available',2:'active',3:'complete'};
const labelPeriods={1:'once',2:'daily',3:'weekly',6:'monthly',7:'quarterly'};

function queryQuests(result,args={},now=Date.now()){
  if(result?.status!=='ready'||!Array.isArray(result.tasks))return {
    status:result?.status||'unavailable',complete:false,items:[],total:null,
    note:'Task list was not collected completely. Wait for the game home screen to be idle and retry; do not infer missing quests.'};
  const rows=result.tasks.map(task=>{
    const definition=findDefinition(task,now);
    const label=Number(task.api_label_type);
    const period=periods[definition?.period]||(label>=101&&label<=112?'yearly':labelPeriods[label])||null;
    const category=definition?.category==='D'?'expedition':definition?.category==='B'?'sortie':categories[task.api_category]||'other';
    return {id:task.api_no,title:task.api_title??null,description:task.api_detail??null,
      category,gameCategory:task.api_category??null,state:states[task.api_state]||'unknown',
      progressFlag:task.api_progress_flag??null,period,code:definition?.code??null,
      goals:definition?.goals??null,source:definition?.source?.url??null,
      rewards:task.api_get_material??null,selectRewards:task.api_select_rewards??null};
  });
  const unknownPeriodCount=rows.filter(row=>!row.period).length;
  const search=String(args.search||'').toLocaleLowerCase();
  const filtered=rows.filter(row=>(!args.category||row.category===args.category)&&(!args.period||row.period===args.period)&&
    (!args.state||row.state===args.state)&&(!search||`${row.title||''} ${row.description||''}`.toLocaleLowerCase().includes(search)));
  const offset=args.offset??0,limit=args.limit??50;
  return {status:'ready',complete:true,capturedAt:new Date(now).toISOString(),pages:result.pages,
    total:filtered.length,offset,limit,nextOffset:offset+limit<filtered.length?offset+limit:null,unknownPeriodCount,
    items:filtered.slice(offset,offset+limit),note:'Only currently available game tasks are listed. Catalog period and goals may be unknown; progressFlag is the game’s coarse progress indicator.'};
}
module.exports={queryQuests};
