'use strict';
const fs=require('fs'),zlib=require('zlib'),{promisify}=require('util');
// The optional battle-detail index has no account key. Keep its records
// separate from account-scoped observations and label that limitation.
function csv(line){const out=[];let value='',quoted=false;for(let i=0;i<line.length;i++){
  const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){out.push(value);value='';}else value+=c;
}out.push(value);return out;}
async function readLocalHistory(file){
  if(!file)return [];
  try{const stat=await fs.promises.stat(file);if(stat.size>16*1024*1024)return [];
    const raw=await promisify(zlib.gunzip)(await fs.promises.readFile(file),{maxOutputLength:32*1024*1024});
    return raw.toString('utf8').split(/\r?\n/).flatMap(line=>{
      const row=csv(line),time=Number(row[1]),rank=row[5];
      if(row.length!==6||!Number.isFinite(time)||!/^演[习習]|^practice\b/i.test(row[4])||!/^(SS|S|A|B|C|D|E)$/.test(rank))return [];
      return [{time,rank,opponent:null,source:'local-unverified'}];
    }).sort((a,b)=>b.time-a.time).slice(0,30);
  }catch(_){return [];}
}
module.exports={readLocalHistory};
