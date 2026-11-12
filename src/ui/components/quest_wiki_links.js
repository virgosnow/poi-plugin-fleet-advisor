'use strict';
const {normalizeName}=require('../../shared/name_matching');
const chineseTargets=require('../../../data/quests/wiki_targets.json');
const titleKey=value=>[...normalizeName(String(value||''))].filter(c=>/[\p{L}\p{N}]/u.test(c)).join('').toLowerCase();

// Use reviewed deep links when available; never turn arbitrary task metadata
// into an external link. A title search still works for unknown/new tasks.
function trusted(value,host,prefix){
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&url.hostname===host&&url.pathname.startsWith(prefix)?url.href:null;}
  catch(_){return null;}
}
function links(task){
  const query=String(task.gameTitle||task.title||task.code||task.id||'').trim();
  const japanese=trusted(task.source?.url,'wikiwiki.jp','/kancolle/');
  const reviewed=chineseTargets.quests[String(task.code||'')],title=titleKey(task.gameTitle||task.title);
  const base=reviewed&&chineseTargets.sources[reviewed.page]?.url;
  const chineseAnchor=base&&title&&title===titleKey(reviewed.title)?new URL(`${base}#${reviewed.anchor}`).href:null;
  return {
    japanese:japanese?(new URL(japanese).hash||!query?japanese:`${japanese}#:~:text=${encodeURIComponent(query)}`):
      `https://wikiwiki.jp/kancolle/?cmd=search&word=${encodeURIComponent(query)}`,
    // Unmapped event and unknown game IDs are not wiki IDs; retain title
    // search instead of guessing a potentially different task's anchor.
    chinese:chineseAnchor||`https://zh.kcwiki.cn/index.php?title=Special%3ASearch&search=${encodeURIComponent(query)}`
  };
}
function openExternal(value,open){
  const allowed=trusted(value,'wikiwiki.jp','/kancolle/')||trusted(value,'zh.kcwiki.cn','/wiki/')||trusted(value,'zh.kcwiki.cn','/index.php');
  if(!allowed)throw new Error('Untrusted quest wiki URL');
  return (open||((url)=>require('electron').shell.openExternal(url)))(allowed);
}
module.exports={links,openExternal};
