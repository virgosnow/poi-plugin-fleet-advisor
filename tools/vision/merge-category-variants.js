'use strict';
// Merge collected category-title variants (tmp/category-variants-<tag>/)
// into data/resample_variants.json. Run after each scale's calibration:
//   node tools/vision/merge-category-variants.js 1.5
// Entries are keyed by (tag,category): re-running a tag replaces its entries.
const fs=require('fs'),path=require('path');
const tag=process.argv[2];
if(!tag)throw Error('Usage: node tools/vision/merge-category-variants.js <tag>');
const dir=path.join(__dirname,'../../../tmp/category-variants-'+tag);
const collected=JSON.parse(fs.readFileSync(path.join(dir,'variants.json'),'utf8'));
if(!collected.ok&&collected.entries.length!==15)throw Error('Collected set incomplete: '+collected.entries.length+'/15, error: '+(collected.error||'none'));
const file=path.join(__dirname,'../../data/resample_variants.json');
const variants=JSON.parse(fs.readFileSync(file,'utf8'));
const kept=(variants.categories||[]).filter(e=>e.tag!==tag);
const categories=[...kept,...collected.entries.map(e=>({tag,category:e.category,mask:e.mask}))];
categories.sort((a,b)=>a.tag===b.tag?a.category-b.category:a.tag<b.tag?-1:1);
variants.categories=categories;
variants.provenance.sources=variants.provenance.sources||{};
for(const [k,v] of Object.entries(collected.sources))variants.provenance.sources['cat'+k+'@'+tag]=v;
fs.writeFileSync(file,JSON.stringify(variants));
console.log('categories now:',categories.map(e=>e.tag+':'+e.category).join(' '));
