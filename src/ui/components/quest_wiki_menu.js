'use strict';
const {t}=require('../../shared/i18n');
const questWiki=require('./quest_wiki_links');

// The workbenches and fleet overview share positioning, dismissal and trusted
// external-browser handling, including when the task list is scrolled.
module.exports=React=>function useQuestWikiMenu({enabled=true,openExternal}={}){
  const h=React.createElement;
  const [menu,setMenu]=React.useState?React.useState(null):[null,()=>{}];
  const ref=React.useRef?React.useRef(null):{current:null};
  const layoutEffect=React.useLayoutEffect||React.useEffect;
  if(layoutEffect)layoutEffect(()=>{
    if(!menu||!enabled)return;
    const node=ref.current;if(!node)return;
    const doc=node.ownerDocument,win=doc.defaultView;
    if(typeof node.showPopover==='function'&&!node.matches(':popover-open'))node.showPopover();
    const rect=node.getBoundingClientRect(),width=doc.documentElement.clientWidth,height=doc.documentElement.clientHeight;
    node.style.left=`${Math.max(8,Math.min(menu.x,width-rect.width-8))}px`;
    node.style.top=`${Math.max(8,Math.min(menu.y,height-rect.height-8))}px`;
    node.style.visibility='visible';node.querySelector('[role=menuitem]')?.focus({preventScroll:true});
    const outside=event=>{if(!node.contains(event.target))setMenu(null);};
    const escape=event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setMenu(null);menu.anchor?.focus?.({preventScroll:true});}};
    const close=()=>setMenu(null);
    // A retained page can be hidden without unmounting its task component.
    // Close the top-layer popover when its workbench is hidden or made inert.
    const workbench=node.closest?.('.paa-workbench');
    const visibilityObserver=workbench&&win.MutationObserver?new win.MutationObserver(()=>{
      if(workbench.hidden||workbench.hasAttribute('inert')||workbench.getAttribute('aria-hidden')==='true')close();
    }):null;
    visibilityObserver?.observe(workbench,{attributes:true,attributeFilter:['hidden','inert','aria-hidden']});
    doc.addEventListener('pointerdown',outside,true);doc.addEventListener('focusin',outside,true);doc.addEventListener('keydown',escape,true);
    doc.addEventListener('scroll',close,true);win.addEventListener('resize',close);win.addEventListener('blur',close);
    return()=>{visibilityObserver?.disconnect();doc.removeEventListener('pointerdown',outside,true);doc.removeEventListener('focusin',outside,true);doc.removeEventListener('keydown',escape,true);doc.removeEventListener('scroll',close,true);win.removeEventListener('resize',close);win.removeEventListener('blur',close);if(typeof node.hidePopover==='function'&&node.matches(':popover-open'))node.hidePopover();};
  },[menu,enabled]);
  if(React.useEffect)React.useEffect(()=>{if(!enabled)setMenu(null);},[enabled]);
  const open=(event,task,keyboard=false)=>{
    if(!enabled)return;
    event.preventDefault();event.stopPropagation();
    const anchor=event.currentTarget,rect=anchor.getBoundingClientRect();
    const x=keyboard?rect.left+Math.min(24,rect.width):event.clientX;
    const y=keyboard?rect.top+Math.min(24,rect.height):event.clientY;
    const win=anchor.ownerDocument?.defaultView;
    if(win?.CustomEvent&&Number.isFinite(x)&&Number.isFinite(y))anchor.dispatchEvent(new win.CustomEvent('paa-tooltip-pointer-guard',{bubbles:true,detail:{x,y}}));
    setMenu({x,y,anchor,links:questWiki.links(task)});
  };
  const openLink=(event,url)=>{
    event.preventDefault();setMenu(null);
    Promise.resolve().then(()=>questWiki.openExternal(url,openExternal))
      .catch(error=>console.error('Could not open quest wiki in the default browser:',error));
  };
  const element=menu&&enabled?h('div',{className:'paa-quest-wiki-menu',role:'menu','aria-label':t('quest.wikiMenu'),popover:'manual',ref,style:{visibility:'hidden'},
    onClick:event=>event.stopPropagation(),onKeyDown:event=>{
      if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
      const items=[...event.currentTarget.querySelectorAll('[role=menuitem]')],index=items.indexOf(event.target);if(!items.length)return;
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;
      items[next].focus({preventScroll:true});}},
    ...[['japanese','quest.wikiJapanese'],['chinese','quest.wikiChinese']].map(([key,label])=>h('a',{
      key,role:'menuitem',href:menu.links[key],target:'_blank',rel:'noopener noreferrer',
      onClick:event=>openLink(event,menu.links[key]),onAuxClick:event=>{if(event.button===1)openLink(event,menu.links[key]);}},t(label)))):null;
  return {open,element};
};
