'use strict';
const {pathLabel}=require('../../domain/routes/route_plans');

function routeFormula(option){
  const raw=option?.displayPathLabel||option?.strategy?.pathLabel||option?.pathLabel||option?.nodes?.join('→')||'';
  const paths=[...new Map(raw.split(/[；;]/).map(text=>text.trim().split('→')).map(nodes=>[nodes.join('>'),nodes])).values()];
  const exact=pathLabel(paths);
  if(!exact.includes('；')&&exact.length<=36)return exact;
  // Optional detours may share one formula only when every combination exists.
  const longest=paths.reduce((a,b)=>a.length>=b.length?a:b,[]);
  if(new Set(longest).size===longest.length&&paths.every(p=>p.every((n,i)=>longest.includes(n)&&(!i||longest.indexOf(p[i-1])<longest.indexOf(n))))){
    const optional=longest.filter(n=>!paths.every(p=>p.includes(n)));
    if(optional.length<=6&&paths.length===2**optional.length){
      const candidate=longest.map(n=>optional.includes(n)?`(${n})`:n).join('→');
      if(candidate.length<=36)return candidate;
    }
  }
  let prefix=0,suffix=0;const shortest=Math.min(...paths.map(p=>p.length));
  while(prefix<shortest&&paths.every(p=>p[prefix]===paths[0][prefix]))prefix++;
  while(suffix<shortest-prefix&&paths.every(p=>p[p.length-1-suffix]===paths[0][paths[0].length-1-suffix]))suffix++;
  const alternatives=nodes=>[...new Set(nodes.flatMap(n=>n.split('/')))].sort().join('/');
  const first=prefix?paths[0].slice(0,prefix):[alternatives(paths.map(p=>p[0]))];
  const last=suffix?paths[0].slice(-suffix):[alternatives(paths.map(p=>p.at(-1)))];
  // Ellipsis deliberately leaves the complex middle unspecified. Independent
  // slash groups there would invent impossible cross-branch combinations.
  if(suffix===1&&paths.every(p=>p.length>prefix+2))last.unshift(alternatives(paths.map(p=>p.at(-2))));
  const compact=[...first,'…',...last].join('→');
  return compact.length<=36?compact:[...first.slice(0,2),'…',...last.slice(-2)].join('→');
}

function withArrivalNotes(result,noteLines){
  return {...result,noteLines,note:noteLines.map(row=>row.nodes?`${row.nodes.join('→')} ${row.value}`:row.text).join('\n')};
}

function arrivalNote(h,arrival){
  if(!arrival.note)return null;
  const lines=arrival.noteLines||arrival.note.split('\n').map(text=>({text})),content=[];
  for(let i=0;i<lines.length;i++){
    const row=lines[i];
    if(!row.nodes){content.push(h('small',{key:i,'data-muted':row.muted||undefined},row.text));continue;}
    const branches=[];
    for(;;){
      const branch=lines[i];
      branches.push(h('li',{key:branch.nodes.join('>'),className:'paa-wb-arrival-path'},
        h('span',null,branch.nodes.join('→')),h('span',{className:'paa-wb-arrival-chance'},branch.value)));
      if(!lines[i+1]?.nodes)break;
      i++;
    }
    content.push(h('ul',{key:`paths-${i}`,className:'paa-wb-arrival-paths','aria-label':'各路线到达概率'},...branches));
  }
  return h('div',{className:'paa-wb-arrival-note'},...content);
}
module.exports={routeFormula,withArrivalNotes,arrivalNote};
