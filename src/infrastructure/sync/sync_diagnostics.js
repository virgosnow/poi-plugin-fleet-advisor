'use strict';

// Only fixed messages are logged: never include game responses, account IDs,
// URLs, session keys or exception text. Repeated messages are rate limited.
const messages=Object.freeze({
  started:'同步诊断已启用',
  frame_unavailable:'等待游戏画面',
  account_unavailable:'等待账号信息',
  document_unready:'游戏画面尚未准备好',
  session_transition:'等待登录切换完成',
  transport_unavailable:'游戏读取接口暂不可用，将继续重试',
  waiting_idle:'等待游戏空闲或其他读取完成',
  context_failed:'检查游戏状态失败，将继续重试',
  identity_unavailable:'账号校验读取失败，将按间隔重试',
  identity_mismatch:'账号校验不一致，将按间隔重试',
  identity_interrupted:'账号校验被中断，将重试',
  identity_verified:'账号校验通过',
  session_backoff:'游戏会话暂不可用，后台同步等待重试',
  session_paused:'后台同步已达到重试上限，等待游戏恢复或重新登录',
  read_failed:'游戏数据读取失败，后台同步将按间隔重试',
  quest_read:'任务数据同步完成',
  quest_cached:'任务数据已就绪',
  quest_failed:'任务数据同步失败，将重试',
  quest_backoff:'任务数据等待重试',
  quest_exhausted:'任务数据已达到重试上限，等待新会话或游戏自然更新',
  practice_ready:'演习数据同步完成',
  practice_cached:'演习数据已就绪',
  practice_failed:'演习数据同步失败，将重试',
  practice_backoff:'演习数据等待重试',
  tick_failed:'后台同步出错，将继续重试'
});
class SyncDiagnostics{
  constructor({now=()=>Date.now(),write=message=>console.info(message),intervalMs=60000}={}){
    this.now=now;this.write=write;this.intervalMs=intervalMs;this.last=new Map();
  }
  report(code){
    if(!Object.hasOwn(messages,code))return;
    const now=Number(this.now()),last=this.last.get(code);
    if(last!==undefined&&now>=last&&now-last<this.intervalMs)return;
    this.last.set(code,now);
    try{this.write('[舰队参谋][同步] '+messages[code]+' ('+code+')',code);}catch(error){}
  }
}
module.exports={SyncDiagnostics};
