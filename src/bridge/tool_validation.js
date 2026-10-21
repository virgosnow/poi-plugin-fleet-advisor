'use strict';
// The catalog uses this deliberately small JSON Schema subset. Validate tool
// calls here. No coercion,
// silent stripping, mutation, default injection or external schema fetching.
const {TOOL_DEFS}=require('./mcp_tools');
const {error}=require('../shared/errors');
function mismatch(schema,value,path='arguments'){
  if(schema.oneOf&&schema.oneOf.filter(s=>!mismatch(s,value,path)).length!==1)return `${path}: exactly one allowed alternative is required`;
  if(schema.anyOf&&!schema.anyOf.some(s=>!mismatch(s,value,path)))return `${path}: a required alternative is missing`;
  if(Object.hasOwn(schema,'const')&&value!==schema.const)return `${path}: expected ${schema.const}`;
  if(schema.enum&&!schema.enum.includes(value))return `${path}: expected one of ${schema.enum.join(', ')}`;
  const type=schema.type;
  if(type&&(type==='null'?value!==null:type==='array'?!Array.isArray(value):type==='object'?!value||typeof value!=='object'||Array.isArray(value):
    type==='integer'?!Number.isSafeInteger(value):type==='number'?!Number.isFinite(value):typeof value!==type))return `${path}: expected ${type}`;
  if(typeof value==='number'&&(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum))return `${path}: number out of range`;
  if(typeof value==='string'){
    if(schema.minLength!==undefined&&value.length<schema.minLength||schema.maxLength!==undefined&&value.length>schema.maxLength)return `${path}: invalid length`;
    if(schema.pattern&&!new RegExp(schema.pattern).test(value))return `${path}: invalid format`;
    if(schema.format==='uuid'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))return `${path}: expected UUID`;
  }
  if(Array.isArray(value)){
    if(schema.minItems!==undefined&&value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)return `${path}: invalid array length`;
    if(schema.uniqueItems&&new Set(value.map(v=>JSON.stringify(v))).size!==value.length)return `${path}: duplicate entries`;
    if(schema.items)for(let i=0;i<value.length;i++){const problem=mismatch(schema.items,value[i],`${path}[${i}]`);if(problem)return problem;}
  }
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    for(const key of schema.required||[])if(!Object.hasOwn(value,key))return `${path}.${key}: required`;
    if(schema.properties)for(const [key,v]of Object.entries(value)){
      if(!Object.hasOwn(schema.properties,key)){if(schema.additionalProperties===false)return `${path}.${key}: unknown parameter`;continue;}
      const problem=mismatch(schema.properties[key],v,`${path}.${key}`);if(problem)return problem;
    }
  }
  return null;
}
const schemas=new Map(TOOL_DEFS.map(t=>[t.name,t.inputSchema]));
function validateToolArguments(name,args){
  const schema=schemas.get(name);if(!schema)throw error('INVALID_QUERY',`Unknown tool: ${name}`);
  const problem=mismatch(schema,args);if(problem)throw error('INVALID_QUERY',problem);
}
module.exports={validateToolArguments};
