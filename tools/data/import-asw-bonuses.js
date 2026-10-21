'use strict';
// Extract ASW facts, or fire/torpedo/bomb/scouting/AA with --combat. No upstream evaluator.
// Input files are retained outside the package for reproducible source review.
const fs=require('fs'),path=require('path'),vm=require('vm'),crypto=require('crypto');
const combat=process.argv.includes('--combat');
const staged=path.resolve(process.argv[2]||'../tmp/asw-bonus');
const table=fs.readFileSync(path.join(staged,'ItemBonus.ts'),'utf8');
const countries=fs.readFileSync(path.join(staged,'ships.ts'),'utf8');
const Const=Object.fromEntries([...countries.matchAll(/export const (JPN|USA|ITA|GBR|DEU|FRA|RUS|SWE) = (\[[\d,\s]*\]);/g)].map(m=>[m[1],JSON.parse(m[2])]));
const literal=table.split('public static readonly bonusData: Bonuses[] = ')[1]?.replace(/;\s*}\s*$/,'');
if(!literal)throw Error('Unrecognized source table');
const rows=vm.runInNewContext('('+literal+')',{Const},{timeout:1000});
const stats=combat?['firePower','torpedo','bomber','scout','antiAir']:['asw'];
const rules=rows.flatMap(({ids,types,bonuses})=>bonuses.filter(b=>stats.some(k=>b.bonus[k]!==undefined)).map(({bonus,...conditions})=>({...(ids?{ids}:{}),...(types?{types}:{}),...conditions,...Object.fromEntries(stats.filter(k=>bonus[k]!==undefined).map(k=>[k,bonus[k]]))})));
const supported=new Set(['ids','types','shipId','shipType','shipBase','shipClass','shipCountry','remodel','num','requiresId','requiresType','requiresSR',...stats,
  ...(combat?['requiresAR','requiresAccR','requiresIdNum','requiresIdLevel','requiresId2','requiresIdLevel2']:[])]);
for(const r of rules)for(const k of Object.keys(r))if(!supported.has(k))throw Error('Unsupported equipment bonus condition: '+k);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const data={source:{repository:'https://github.com/noro6/kc-web',commit:combat?'ac680f36ab2bd6e39dff4fe6b844a4e818882122':'975da86160f35f0fdecb924f0d686630911851da',
  path:'src/classes/item/ItemBonus.ts',retrieved:combat?'2026-10-16':'2026-10-14',sha256:hash(table),countriesSha256:hash(countries),
  scope:combat?'Firepower, torpedo, bomber, scouting and anti-air visible bonus facts; conditions retained; not improvement damage or hidden fit bonuses':
    'ASW numerical bonus facts, including improvement and combination conditions; not damage improvement multipliers'},
  maxEquipmentId:Math.max(...rows.flatMap(r=>r.ids||[])),
  maxShipId:Math.max(...rows.flatMap(r=>r.bonuses.flatMap(b=>b.shipId||[]))),rules};
fs.writeFileSync(path.join(__dirname,combat?'../data/combat_bonuses.json':'../data/asw_bonuses.json'),JSON.stringify(data,null,2)+'\n');
console.log({rules:rules.length,maxEquipmentId:data.maxEquipmentId,fields:[...new Set(rules.flatMap(Object.keys))]});
