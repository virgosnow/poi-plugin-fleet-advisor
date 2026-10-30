'use strict';
let nextId=0;
// An SVG group can include a clipped, full-size game texture atlas. Browsers
// include that image in its client bounds despite the visible clip, so map
// tooltip placement must use the node's own circular hit/marker geometry.
function anchorRect(anchor){
  const marker=anchor?.classList?.contains('paa-map-node')?
    anchor.querySelector('.paa-map-boss-hit,.paa-map-start-hit,.paa-map-node-body'):null;
  return (marker||anchor).getBoundingClientRect();
}
function tableColumns(labels,{numeric=[],compact=false,indexed=false}={}){
  const centered=new Set(['位置','槽位','节点','系数','速力','预计结果','类型','阵型','攻击阶段']);
  let widths=labels.map(()=>100/labels.length);
  if(!compact){
    if(indexed&&labels.length===3)widths=[20,44,36];
    else if(indexed&&labels.length===4)widths=[16,32,26,26];
    else if(labels[0]==='节点'&&labels.length===4)widths=[18,28,28,26];
    else if(labels[0]==='分岐'&&labels.length===4)widths=[28,18,27,27];
    else if(labels[0]==='位置'&&labels.length===4)widths=[16,30,24,30];
  }
  return labels.map((label,i)=>({width:widths[i],align:centered.has(label)?'center':numeric.includes(i)?'right':'left'}));
}
function alignCell(cell,column,header=false){
  cell.className+=' paa-tooltip-align-'+column.align;
  if(header&&cell.style)cell.style.width=column.width+'%';
  return cell;
}
function renderStructured(doc,tip,raw){
  let content;try{content=JSON.parse(raw);}catch(_){return false;}
  if(!content||!Array.isArray(content.sections)||content.sections.some(s=>!Array.isArray(s.columns)||!Array.isArray(s.rows)||s.rows.some(r=>!Array.isArray(r))))return false;
  const text=(tag,cls,value)=>{const el=doc.createElement(tag);el.className=cls;el.textContent=String(value??'—');return el;};
  tip.className+=' paa-tooltip-structured'+(content.compact?' paa-tooltip-compact':'');
  if(content.title)tip.appendChild(text('div','paa-tooltip-heading',content.title));
  for(const s of content.sections){
    if(!s.rows.length)continue;
    const section=doc.createElement('div');section.className='paa-tooltip-section';
    if(s.title)section.appendChild(text('div','paa-tooltip-subheading',s.title));
    if(s.layout==='equipment-stats'){
      const list=doc.createElement('dl');list.className='paa-tooltip-equipment-stats';
      for(const values of s.rows)for(let i=0;i<values.length;i+=2){
        if(!values[i])continue;
        const pair=doc.createElement('div');pair.className='paa-tooltip-equipment-stat';
        pair.appendChild(text('dt','paa-tooltip-equipment-label',values[i]));
        pair.appendChild(text('dd','paa-tooltip-equipment-value'+(/^[−-]/.test(String(values[i+1]))?' is-negative':''),values[i+1]));
        list.appendChild(pair);
      }
      section.appendChild(list);if(s.note)section.appendChild(text('div','paa-tooltip-notes',s.note));tip.appendChild(section);continue;
    }
    const table=doc.createElement('table');table.className='paa-tooltip-data-table';
    const layout=tableColumns(s.columns,{numeric:s.numeric,compact:content.compact});
    const head=doc.createElement('thead'),header=doc.createElement('tr');
    s.columns.forEach((label,i)=>{const cell=alignCell(text('th',(s.numeric||[]).includes(i)?'paa-tooltip-numeric':'',label),layout[i],true);cell.scope='col';header.appendChild(cell);});
    head.appendChild(header);table.appendChild(head);
    const appendRows=(tag,rows)=>{const body=doc.createElement(tag);for(const values of rows){const row=doc.createElement('tr');s.columns.forEach((_,i)=>row.appendChild(alignCell(text('td',(s.numeric||[]).includes(i)?'paa-tooltip-numeric':'',values[i]),layout[i])));body.appendChild(row);}table.appendChild(body);};
    appendRows('tbody',s.rows);if(s.footer)appendRows('tfoot',[s.footer]);
    section.appendChild(table);if(s.note)section.appendChild(text('div','paa-tooltip-notes',s.note));tip.appendChild(section);
  }
  if(content.notes?.filter(Boolean).length)tip.appendChild(text('div','paa-tooltip-section paa-tooltip-notes',content.notes.filter(Boolean).join('\n')));
  return true;
}
function position(rect,size,viewport){
  const gap=8,pad=8;
  return {left:Math.max(pad,Math.min(rect.left,viewport.width-size.width-pad)),
    top:Math.max(pad,Math.min(rect.bottom+gap+size.height<=viewport.height-pad?rect.bottom+gap:rect.top-size.height-gap,viewport.height-size.height-pad))};
}
function renderAttackTable(doc,section,groups,kind,rowHeading){
  const single=groups.length===1&&!groups[0].title&&groups[0].rows.length===1;
  if(!single&&groups.some(g=>!g.title))return false;
  const key=row=>row.label.replace(/参考$/,''),columns=[...new Set(groups.flatMap(g=>g.rows.map(key)))];
  // Keep unfamiliar or duplicate metrics in their original groups rather than
  // forcing different meanings into the same table cell.
  if(columns.length>2||groups.some(g=>new Set(g.rows.map(key)).size!==g.rows.length))return false;
  const aircraft=kind==='opening-air'||kind==='jet-assault';
  const indexUnit=aircraft?'槽':kind?.startsWith('special-')?'位':null;
  const identities=indexUnit?groups.map(g=>g.title?.match(/^第\s*(\d+)\s*(位|槽)\s+(.+)$/)):[];
  const indexed=!single&&identities.length>0&&identities.every(match=>match&&match[2]===indexUnit);
  const labels=[...(indexed?[indexUnit==='槽'?'槽位':'位置']:[]),...(!single?[rowHeading||(kind?.startsWith('special-')?'参与舰':aircraft?indexed?'装备':'航空槽位':kind==='ground'?'目标':'攻击方式')]:[]),...columns];
  const layout=tableColumns(labels,{numeric:columns.map((_,i)=>labels.length-columns.length+i),indexed});
  const table=doc.createElement('table');table.className='paa-tooltip-attack-table'+(single?' paa-tooltip-attack-single':columns.length===2?' paa-tooltip-attack-table-two':'')+(indexed?' paa-tooltip-attack-indexed':'');
  const head=doc.createElement('thead'),header=doc.createElement('tr');
  if(indexed){const index=doc.createElement('th');index.scope='col';index.className='paa-tooltip-attack-label paa-tooltip-attack-index';index.textContent=indexUnit==='槽'?'槽位':'位置';header.appendChild(index);}
  if(!single){const heading=doc.createElement('th');heading.scope='col';heading.className='paa-tooltip-attack-label';
    heading.textContent=rowHeading||(kind?.startsWith('special-')?'参与舰':aircraft?indexed?'装备':'航空槽位':kind==='ground'?'目标':'攻击方式');
    if(indexed)heading.className+=' paa-tooltip-attack-name';header.appendChild(heading);}
  for(const column of columns){const cell=doc.createElement('th');cell.scope='col';cell.className='paa-tooltip-attack-label paa-tooltip-attack-number';cell.textContent=column;header.appendChild(cell);}
  Array.from(header.children).forEach((cell,i)=>alignCell(cell,layout[i],true));
  head.appendChild(header);table.appendChild(head);
  const body=doc.createElement('tbody');
  for(const [i,g]of groups.entries()){
    const row=doc.createElement('tr');
    if(indexed){const index=doc.createElement('td');index.className='paa-tooltip-attack-index';index.textContent=identities[i][1];row.appendChild(index);}
    if(!single){const title=doc.createElement('th');title.scope='row';title.className='paa-tooltip-attack-title'+(indexed?' paa-tooltip-attack-name':'');title.textContent=indexed?identities[i][3]:g.title;row.appendChild(title);}
    for(const column of columns){
      const cell=doc.createElement('td');cell.className='paa-tooltip-attack-number';
      const metric=g.rows.find(r=>key(r)===column);
      const value=doc.createElement('span');value.className='paa-tooltip-attack-value'+(/^\d+(?: 或 \d+)* × \d+击$/.test(metric?.value)?' paa-tooltip-attack-short':'');value.textContent=metric?.value??'—';cell.appendChild(value);
      if(metric?.label.endsWith('参考')){const reference=doc.createElement('span');reference.className='paa-tooltip-attack-reference';reference.textContent='参考';cell.appendChild(reference);}
      row.appendChild(cell);
    }
    Array.from(row.children).forEach((cell,i)=>alignCell(cell,layout[i]));
    body.appendChild(row);
    if(g.notes.length){const noteRow=doc.createElement('tr');noteRow.className='paa-tooltip-attack-note-row';const notes=doc.createElement('td');notes.colSpan=columns.length+(single?0:indexed?2:1);notes.className='paa-tooltip-attack-notes';notes.textContent=g.notes.join('\n');noteRow.appendChild(notes);body.appendChild(noteRow);}
  }
  table.appendChild(body);section.appendChild(table);return true;
}
function renderAttacks(doc,section,text,kind){
  const lines=text.split('\n'),metric=line=>line.match(/^((?:(?:昼战(?:连击)?|夜战|单横|单纵|航空战|喷式强袭)(?:参考)?)?攻击力)：\s*(.+)$/);
  const groups=[];let group;
  for(let i=0;i<lines.length;i++){
    const line=lines[i],match=metric(line);
    if(!match&&i+1<lines.length&&metric(lines[i+1])){
      group={title:line,rows:[],notes:[]};groups.push(group);
    }else{
      if(!group){group={rows:[],notes:[]};groups.push(group);}
      if(match)group.rows.push({label:match[1]==='攻击力'?match[1]:match[1].replace(/攻击力$/,''),value:match[2]});
      else group.notes.push(line);
    }
  }
  if(groups.some(g=>!g.rows.length))return false;
  if(groups.length===1&&!groups[0].title){
    const g=groups[0],labels=g.rows.map(r=>r.label.replace(/参考$/,''));
    if(labels.every(label=>label!=='攻击力')){
      const heading=labels.every(label=>['单横','单纵'].includes(label))?'阵型':labels.every(label=>['昼战','夜战'].includes(label))?'攻击阶段':'攻击方式';
      const rows=g.rows.map((r,i)=>({title:labels[i],rows:[{label:'攻击力'+(r.label.endsWith('参考')?'参考':''),value:r.value}],notes:i===g.rows.length-1?g.notes:[]}));
      return renderAttackTable(doc,section,rows,kind,heading);
    }
  }
  if(renderAttackTable(doc,section,groups,kind))return true;
  for(const g of groups){
    const item=doc.createElement('div');item.className='paa-tooltip-attack-group'+(g.title?' paa-tooltip-attack-named':'');
    if(g.title){const title=doc.createElement('div');title.className='paa-tooltip-attack-title';title.textContent=g.title;item.appendChild(title);}
    const values=doc.createElement('div');values.className='paa-tooltip-attack-values';
    for(const row of g.rows){
      const label=doc.createElement('span');label.className='paa-tooltip-attack-label';label.textContent=row.label;
      const value=doc.createElement('span');value.className='paa-tooltip-attack-value';value.textContent=row.value;
      values.appendChild(label);values.appendChild(value);
    }
    item.appendChild(values);
    if(g.notes.length){const notes=doc.createElement('div');notes.className='paa-tooltip-attack-notes';notes.textContent=g.notes.join('\n');item.appendChild(notes);}
    section.appendChild(item);
  }
  return true;
}
function renderContent(doc,tip,text,kind){
  if(kind&&/\n\s*\n/.test(text)){
    for(const [index,part]of text.split(/\n\s*\n/).map(s=>s.trim()).filter(Boolean).entries()){
      const section=doc.createElement('div');section.className='paa-tooltip-section';
      if(index!==1||kind==='aaci'||!renderAttacks(doc,section,part,kind))renderContent(doc,section,part,kind);
      tip.appendChild(section);
    }
    return;
  }
  if(kind!=='aaci'){tip.textContent=text;return;}
  tip.className+=' paa-tooltip-aaci';let rows=null;
  for(const line of text.split('\n')){
    const match=line.match(/^\s*(\d+型)：\s*(\d+(?:\.\d+)?%|待确认)，(.+)$/);
    if(match){
      if(!rows){rows=doc.createElement('div');rows.className='paa-tooltip-aa-grid';
        for(const [i,text]of ['类型','发动率','击落效果'].entries()){
          const heading=doc.createElement('span');heading.className=['paa-tooltip-aa-type','paa-tooltip-aa-rate','paa-tooltip-aa-effect'][i]+' paa-tooltip-aa-head';heading.textContent=text;rows.appendChild(heading);
        }
        tip.appendChild(rows);}
      for(const [i,content]of match.slice(1).entries()){
        const cell=doc.createElement('span');cell.className=['paa-tooltip-aa-type','paa-tooltip-aa-rate','paa-tooltip-aa-effect'][i];
        cell.textContent=content;rows.appendChild(cell);
      }
    }else{
      rows=null;const description=doc.createElement('div');description.textContent=line||'\u00a0';tip.appendChild(description);
    }
  }
}
module.exports=function useTooltip(React,root,scope){
  React.useEffect(()=>{
    const page=root.current;if(!page)return;
    const doc=page.ownerDocument,win=doc.defaultView;
    let tip=null,target=null,anchor=null,previousDescription=null,timer=null,leaveTimer=null,descriptionAdded=false,shownText=null,shownContent=null;
    const hide=()=>{
      if(timer!==null){win.clearTimeout(timer);timer=null;}
      if(leaveTimer!==null){win.clearTimeout(leaveTimer);leaveTimer=null;}
      tip?.remove();tip=null;shownText=null;shownContent=null;
      if(anchor&&descriptionAdded){if(previousDescription===null)anchor.removeAttribute('aria-describedby');else anchor.setAttribute('aria-describedby',previousDescription);}
      target=null;anchor=null;descriptionAdded=false;
    };
    const visible=node=>node?.isConnected&&page.contains(node)&&node.getClientRects().length>0&&!node.closest('[hidden],[inert],[aria-hidden="true"]');
    const display=()=>{
      timer=null;
      if(!visible(target)||!visible(anchor)){hide();return;}
      tip=doc.createElement('div');tip.className='paa-tooltip';tip.id=`paa-tip-${++nextId}`;tip.setAttribute('role','tooltip');
      shownText=target.dataset.tooltip;shownContent=target.dataset.tooltipContent;
      const structured=shownContent&&renderStructured(doc,tip,shownContent);
      if(!structured)renderContent(doc,tip,shownText,target.dataset.mechanism);
      const theme=win.getComputedStyle(page);
      for(const key of ['--paa-card','--paa-text','--paa-line'])tip.style.setProperty(key,theme.getPropertyValue(key));
      const columns=structured?Math.max(0,...JSON.parse(shownContent).sections.map(s=>s.columns.length)):0;
      const compact=structured&&JSON.parse(shownContent).compact;
      tip.style.maxWidth=Math.max(40,Math.min(compact?360:columns>=5?620:columns>=4?520:360,win.innerWidth-16))+'px';tip.style.maxHeight=Math.max(40,Math.min(structured?480:Infinity,win.innerHeight-16))+'px';
      if(structured){
        if(columns>=4)tip.style.width=tip.style.maxWidth;
        tip.addEventListener('pointerenter',()=>{if(leaveTimer!==null){win.clearTimeout(leaveTimer);leaveTimer=null;}});
        tip.addEventListener('pointerleave',event=>{if(!target?.contains(event.relatedTarget))hide();});
      }
      const attack=tip.querySelector('.paa-tooltip-attack-indexed');
      if(attack){
        if(attack.querySelectorAll('thead th').length>=4)tip.style.maxWidth=Math.max(40,Math.min(440,win.innerWidth-16))+'px';
        tip.style.width=tip.style.maxWidth;
      }
      // A popover also stays above native modal dialogs, without taking focus.
      if(typeof tip.showPopover==='function'){tip.setAttribute('popover','manual');doc.body.appendChild(tip);tip.showPopover();}
      else (anchor.closest('dialog[open]')||doc.body).appendChild(tip);
      const xy=position(anchorRect(anchor),tip.getBoundingClientRect(),{width:win.innerWidth,height:win.innerHeight});
      tip.style.left=xy.left+'px';tip.style.top=xy.top+'px';
      previousDescription=anchor.getAttribute('aria-describedby');anchor.setAttribute('aria-describedby',[previousDescription,tip.id].filter(Boolean).join(' '));descriptionAdded=true;
    };
    const show=event=>{
      if(event.buttons){hide();return;}
      const next=event.target.closest?.('[data-tooltip]');
      if(!next||!page.contains(next)||!next.dataset.tooltip){hide();return;}
      if(next===target){if(leaveTimer!==null){win.clearTimeout(leaveTimer);leaveTimer=null;}return;}
      hide();target=next;
      const control=event.target.closest('button,input,select');
      anchor=control&&next.contains(control)?control:next.querySelector('button,input,select')||next;
      // Do not restart the timer as the pointer moves within the same control.
      timer=win.setTimeout(display,350);
    };
    const leave=event=>{if(target?.contains(event.relatedTarget)||tip?.contains(event.relatedTarget))return;
      if(tip&&shownContent){if(leaveTimer!==null)win.clearTimeout(leaveTimer);leaveTimer=win.setTimeout(hide,150);}else hide();};
    const dismiss=event=>{if(!tip?.contains(event.target))hide();};
    const escape=event=>{if(event.key==='Escape')hide();};
    page.addEventListener('pointerover',show);page.addEventListener('pointermove',show);page.addEventListener('pointerout',leave);
    page.addEventListener('focusin',show);page.addEventListener('focusout',hide);doc.addEventListener('pointerdown',dismiss,true);doc.addEventListener('click',dismiss,true);page.addEventListener('dragstart',hide);doc.addEventListener('keydown',escape);
    win.addEventListener('blur',hide);win.addEventListener('scroll',dismiss,true);win.addEventListener('resize',hide);win.visualViewport?.addEventListener('resize',hide);
    const observer=new win.MutationObserver(()=>{if(target&&(!visible(target)||!visible(anchor)||(tip&&(shownText!==target.dataset.tooltip||shownContent!==target.dataset.tooltipContent))))hide();});
    observer.observe(page,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','inert','open','aria-hidden','data-tooltip','data-tooltip-content']});
    for(let node=page.parentElement;node;node=node.parentElement)observer.observe(node,{attributes:true,attributeFilter:['hidden','inert','class','style','aria-hidden']});
    return()=>{
      observer.disconnect();hide();page.removeEventListener('pointerover',show);page.removeEventListener('pointermove',show);page.removeEventListener('pointerout',leave);
      page.removeEventListener('focusin',show);page.removeEventListener('focusout',hide);doc.removeEventListener('pointerdown',dismiss,true);doc.removeEventListener('click',dismiss,true);page.removeEventListener('dragstart',hide);doc.removeEventListener('keydown',escape);
      win.removeEventListener('blur',hide);win.removeEventListener('scroll',dismiss,true);win.removeEventListener('resize',hide);win.visualViewport?.removeEventListener('resize',hide);
    };
  },[scope]);
};
module.exports.position=position;
module.exports.anchorRect=anchorRect;
module.exports.renderContent=renderContent;
module.exports.renderStructured=renderStructured;
