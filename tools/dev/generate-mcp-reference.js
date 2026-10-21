'use strict';
const fs=require('fs'),path=require('path');
const {TOOL_DEFS}=require('../../src/bridge/mcp_tools');
const marker='<!-- BEGIN GENERATED TOOL REFERENCE -->';
function shape(s){
  if(s.enum)return s.enum.map(v=>'`'+v+'`').join(' / ');
  if(s.oneOf)return s.oneOf.map(shape).join(' or ');
  if(s.type==='array')return 'array<'+shape(s.items)+'>';
  if(Object.hasOwn(s,'const'))return '`'+s.const+'`';
  return s.format||s.type||'object';
}
const cell=s=>String(s||'—').replace(/\|/g,'\\|').replace(/\n/g,' ');
function reference(){
  return marker+'\n\n'+TOOL_DEFS.map(t=>{
    const rows=Object.entries(t.inputSchema.properties).map(([key,s])=>{
      const bounds=['minimum','maximum','minLength','maxLength','minItems','maxItems','pattern'].filter(k=>s[k]!==undefined).map(k=>k+'='+s[k]).join('; ');
      return '| `'+key+'` | '+cell(shape(s))+' | '+(t.inputSchema.required?.includes(key)?'yes':'no')+' | '+cell([s.description,bounds].filter(Boolean).join(' '))+' |';
    });
    return ['#### `'+t.name+'`','',t.description,'',
      'Effect: **'+(t.readOnly?'read-only':t.name.endsWith('execute_plan')?'game write':t.name.endsWith('cancel_job')?'stop subsequent game steps':'temporary local scheme cache write')+'**.',
      ...(t.inputSchema.oneOf?['','Exactly one of `scheme` / `schemeName` is required.']:[]),
      ...(t.name.endsWith('get_job')?['','Provide `jobId` or `idempotencyKey`.']:[]),
      '',...(rows.length?['| Parameter | Type / allowed values | Required | Meaning / constraints |','| --- | --- | --- | --- |',...rows]:['Parameters: `{}`.'])].join('\n');
  }).join('\n\n')+'\n\n<!-- END GENERATED TOOL REFERENCE -->\n';
}
if(require.main===module){
  const file=path.join(__dirname,'../../docs/MCP_API.md'),source=fs.readFileSync(file,'utf8');
  if(!source.includes(marker))throw Error('Missing generated-reference marker');
  fs.writeFileSync(file,source.slice(0,source.indexOf(marker))+reference());
}
module.exports={reference,marker};
