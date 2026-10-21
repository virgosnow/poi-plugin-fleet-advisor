#!/usr/bin/env node
'use strict';
// Cross-checks game master data against the 大発動艇系 membership lists in
// src/domain/routes/normal_routes.js. Every 上陸用舟艇/特型内火艇 (api_type[2] 24/46)
// equipment must appear in exactly one bucket, otherwise a new barge could
// silently flip branch verdicts. Unmapped ids fail this check; items the wiki
// has not classified yet belong in PENDING (runtime reads them as unknown).
// Usage: node tools/data/check-landing-craft.js <master.json>
const fs=require('fs');
const path=require('path');
const {LANDING_CRAFT_IDS,LANDING_CRAFT_EXCLUDED}=require('../../src/domain/routes/normal_routes');
// 大発動艇(R35&フランス兵): added after the wiki's 2024-09 verification; the
// 5-3/5-4/5-5 pages have not recorded it yet, so it stays pending (unknown).
const PENDING=new Set([576]);

const target=process.argv[2];
if(!target){console.error('用法: node tools/data/check-landing-craft.js <master.json>');process.exit(2);}
const master=JSON.parse(fs.readFileSync(path.resolve(target),'utf8'));
const equipment=Array.isArray(master.equipment)?master.equipment:Object.values(master.equipment);
const unmapped=[];
for(const item of equipment){
  const category=Number(item.api_type?.[2]);
  if(category!==24&&category!==46)continue;
  const id=Number(item.api_id);
  if(LANDING_CRAFT_IDS.has(id))continue;
  if(LANDING_CRAFT_EXCLUDED.has(id))continue;
  if(PENDING.has(id)){console.log(`待核: ${item.api_name} (${id}) — 运行时按未知处理`);continue;}
  unmapped.push(`${item.api_name} (${id}, api_type[2]=${category})`);
}
if(unmapped.length){
  console.error('以下装备属于上陸用舟艇/特型内火艇类但未被大発動艇系判定收录，请先分类:');
  for(const line of unmapped)console.error(`  ${line}`);
  process.exit(1);
}
console.log(`大発動艇系分类校验通过: 计入 ${LANDING_CRAFT_IDS.size} 件、排除 ${LANDING_CRAFT_EXCLUDED.size} 件`);
