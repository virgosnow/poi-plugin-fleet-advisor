'use strict';
// The portrait row is its own size container: reserve the badge only when
// another selected portrait cannot fit, including on wide multi-column pages.
const trainingSizeRules=Array.from({length:6},(_,i)=>i+1).map(total=>{
  const threshold=total*64+(total-1)*14;
  return `@container training-portraits (max-width:${threshold-.1}px){.paa-practice-training-portraits[data-count="${total}"] .paa-practice-training-portrait{flex-basis:48px;height:30px}}`;
}).join('');
const trainingOverflowRules=Array.from({length:6},(_,i)=>i+1).flatMap(total=>
  Array.from({length:total},(_,i)=>total-1-i).flatMap(visible=>[48,64].map(width=>{
    const next=visible+1,threshold=next===total?next*width+(next-1)*14:next*width+next*14+24;
    const row=`.paa-practice-training-portraits[data-count="${total}"]`;
    const largeThreshold=total*64+(total-1)*14;
    const range=width===48?`(max-width:${largeThreshold-.1}px)`:`(min-width:${largeThreshold}px)`;
    return `@container training-portraits ${range} and (max-width:${threshold-.1}px){${row} .paa-practice-training-portrait:nth-child(n+${visible+1}){display:none}${row} .paa-practice-training-more{display:none}${row} .paa-practice-training-more-${visible}{display:inline-flex}}`;
  }))).join('');
module.exports=`
.paa-practice .paa-wb-left{display:flex;flex-direction:column;gap:12px;padding:16px}
@container(min-width:781px){.paa-workbench[data-kind=practice] .paa-wb-right>.paa-wb-command-area{padding:0}.paa-workbench[data-kind=practice] .paa-wb-command-row :is(button,select){height:36px;min-height:36px}}
.paa-workbench[data-kind=practice] .paa-wb-apply-controls .paa-wb-field select{width:132px}
.paa-workbench[data-kind=practice] .paa-wb-left>.paa-practice-context{display:flex;flex-direction:column;align-items:stretch;gap:12px;padding:0;margin:0;border:0;background:transparent}
.paa-workbench[data-kind=practice] .paa-practice-context>.paa-wb-field{position:relative;display:flex;flex:auto;flex-direction:row;align-items:center;gap:10px;min-width:0}
.paa-workbench[data-kind=practice] .paa-practice-context>.paa-wb-field>span{flex:0 0 28px;width:28px;color:var(--paa-muted);font-size:14px;font-weight:400;line-height:22px}
.paa-workbench[data-kind=practice] .paa-practice-context>.paa-wb-field select{flex:1;width:0;min-width:0;height:40px;min-height:40px;padding:7px 30px 7px 12px;border-radius:6px;background:var(--paa-card);color:var(--paa-text);font-size:14px;font-weight:400;line-height:22px;appearance:none}
.paa-practice-context>.paa-wb-field::after{content:'';position:absolute;right:13px;top:calc(50% - 4px);width:6px;height:6px;border:solid var(--paa-muted);border-width:0 1.5px 1.5px 0;transform:rotate(45deg);pointer-events:none}
.paa-practice-training{position:relative;display:flex;align-items:center;gap:10px;min-width:0}
.paa .paa-practice-training-trigger{position:relative;display:flex;flex:1;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:4px;width:0;min-width:0;height:102px;min-height:102px;padding:14px 16px;text-align:left;font-size:14px;line-height:22px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card);color:var(--paa-text)}
.paa .paa-practice-training-trigger{cursor:pointer}.paa .paa-practice-training-trigger *{cursor:inherit}.paa .paa-practice-training-trigger[aria-disabled=true]{cursor:default}
.paa-practice-training-title{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--paa-text)}
.paa-practice-training-title .paa-area-chevron{position:static;flex:none;margin-right:2px}
.paa-practice-training-portraits{container:training-portraits / inline-size;box-sizing:border-box;display:flex;align-items:center;gap:14px;width:100%;min-width:0;height:46px;padding:8px 8px 0 0;overflow:hidden}
.paa-practice-training-portrait{position:relative;display:flex;align-items:center;justify-content:center;flex:0 0 64px;min-width:0;height:38px;overflow:visible;border-radius:4px;background:var(--paa-soft);color:var(--paa-muted);font-size:11px;white-space:nowrap}
.paa-practice-training-portrait img{width:100%;height:100%;object-fit:cover;border-radius:4px}.paa-practice-training-portrait>span{max-width:100%;overflow:hidden;text-overflow:ellipsis}.paa-practice-training-more{box-sizing:border-box;display:none;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;border:1px solid var(--paa-line);border-radius:4px;color:var(--paa-muted);font-size:11px;line-height:1}.paa-practice-training-empty-hint{color:var(--paa-muted);font-size:13px;line-height:38px}
.paa .paa-practice-training-remove{position:absolute;top:-8px;right:-8px;display:grid;place-items:center;width:16px;min-width:16px;height:16px;min-height:16px;padding:0;border:1px solid #ffe5e7;border-radius:50%;background:#d84c58;color:#fff;font-size:13px;line-height:1}.paa .paa-practice-training-remove:hover{background:#ee6470}
${trainingSizeRules}
${trainingOverflowRules}
.paa .paa-practice-training-trigger[aria-expanded=true]{border-color:var(--paa-accent);border-bottom-color:var(--paa-line);border-radius:10px 10px 0 0}.paa-practice-training-trigger[aria-expanded=true] .paa-area-chevron{transform:translateY(3px) rotate(225deg)}
.paa-practice-training-panel{position:absolute;top:calc(100% - 1px);left:0;z-index:30;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:min(100%,calc(100vw - 24px));max-height:560px;padding:10px;border:1px solid var(--paa-accent);border-top:1px solid var(--paa-line);border-radius:0 0 10px 10px;background:var(--paa-card);box-shadow:0 8px 24px #0005;animation:paa-picker-reveal 110ms ease-out both}
@media (prefers-reduced-motion:reduce){.paa-practice-training-panel{animation:none}}
.paa .paa-practice-training-controls{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding-bottom:8px;border-bottom:1px solid var(--paa-line)}
.paa .paa-practice-training-controls input[type=search]{flex:1 1 150px;width:0;min-width:100px;font-size:14px}
.paa .paa-practice-training-controls select{flex:0 1 142px;width:142px;min-width:90px;font-size:14px}
.paa-practice-training-checks{display:flex;align-items:center;gap:10px;min-height:30px;white-space:nowrap}
.paa-practice-training-checks label{display:inline-flex;align-items:center;gap:5px;margin:0;color:var(--paa-muted);font-size:13px;cursor:pointer}
.paa .paa-practice-training-tabs{display:flex;align-items:flex-start;gap:8px;min-width:0;padding-bottom:6px;border-bottom:1px solid var(--paa-line)}
.paa-practice-training-filter-options{display:flex;flex:1;flex-wrap:wrap;gap:4px;min-width:0}
.paa .paa-practice-training-filter-options>button{flex:none;min-height:28px;padding:2px 7px;border-color:transparent;background:transparent;color:var(--paa-muted);font-size:14px;font-weight:400;line-height:22px;white-space:nowrap}
.paa .paa-practice-training-filter-options>button[aria-pressed=true]{border-color:var(--paa-line);background:var(--paa-soft);color:var(--paa-accent)}
.paa-practice-training-list{display:flex;flex:1 1 auto;flex-direction:column;gap:4px;min-height:55px;max-height:350px;margin-top:3px;overflow:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:2px}
.paa-practice-training-option{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:44px;margin:0;padding:5px 10px;border:1px solid transparent;border-radius:6px;font-size:13px;line-height:1.4;cursor:pointer;content-visibility:auto;contain-intrinsic-size:auto 50px}.paa-practice-training-option:hover{background:var(--paa-soft)}.paa-practice-training-option[data-selected=true]{border-color:var(--paa-accent);background:var(--paa-soft);color:var(--paa-accent)}.paa-practice-training-option[data-unavailable=true]{opacity:.5;cursor:not-allowed}
.paa-practice-training-window{position:relative;flex:none;min-width:0}.paa-practice-training-window>.paa-practice-training-option{position:absolute;left:0;right:0;height:49px;min-height:49px;content-visibility:visible}
.paa .paa-practice-training-option *{cursor:inherit}.paa .paa-practice-training-option[data-unavailable=true] input[type=checkbox]:disabled{cursor:not-allowed}
.paa :is(.paa-practice-training-option,.paa-practice-training-checks) input[type=checkbox]{appearance:none;-webkit-appearance:none;box-sizing:border-box;display:inline-block;position:relative;flex:none;width:16px;height:16px;min-width:16px;min-height:16px;padding:0;margin:0;vertical-align:middle;border:1px solid var(--paa-muted);border-radius:3px;background:var(--paa-card);box-shadow:none;transform:none;cursor:pointer}
.paa :is(.paa-practice-training-option,.paa-practice-training-checks) input[type=checkbox]::before,.paa :is(.paa-practice-training-option,.paa-practice-training-checks) input[type=checkbox]::after{content:none}
.paa :is(.paa-practice-training-option,.paa-practice-training-checks) input[type=checkbox]:checked{border-color:var(--paa-accent);background-color:var(--paa-accent);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3.5 8 3 3 6-6' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-size:16px 16px;background-position:center;background-repeat:no-repeat}
.paa .paa-practice-training-checks input[type=checkbox]:focus-visible{outline:2px solid var(--paa-accent);outline-offset:3px}
.paa .paa-practice-training-option input[type=checkbox]:focus-visible{outline:2px solid var(--paa-accent);outline-offset:3px}.paa .paa-practice-training-option input[type=checkbox]:disabled{opacity:.45;cursor:default}.paa-practice-training-option>.paa-wb-portrait{flex:none;width:64px;height:37px}.paa-practice-training-lock{flex:none;width:15px;height:15px;margin-left:auto;color:var(--paa-muted)}.paa-practice-training-lock[data-locked=true]{color:var(--paa-accent)}.paa-practice-training-identity{display:flex;flex:1;flex-direction:column;min-width:0;gap:0}.paa-practice-training-name{font-size:14px;font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.paa-practice-training-identity small{color:var(--paa-muted);font-size:12px;line-height:15px}.paa-practice-training-remodel{white-space:nowrap}.paa-practice-training-reason{color:var(--paa-muted)}.paa-practice-training-empty{padding:10px;color:var(--paa-muted);font-size:13px}
.paa-practice-block{min-width:0;padding:14px 16px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card)}
.paa-workbench[data-kind=practice] .paa-wb-left .paa-practice-block h3{margin:0 0 12px;color:var(--paa-text)}
.paa-practice-opponent-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}
.paa-workbench[data-kind=practice] .paa-wb-left .paa-practice-opponent-header h3{margin:0}
.paa .paa-practice-opponent-clear{min-height:24px;padding:2px 5px;border:0;background:transparent;color:var(--paa-muted);font-size:12px;line-height:20px}
.paa .paa-practice-opponent-clear:hover:not(:disabled){color:var(--paa-accent);background:var(--paa-soft)}
.paa .paa-practice-opponent-clear:disabled{opacity:.45}
.paa-practice-block p{margin:0;font-size:12px;line-height:1.5}
.paa-practice-block p.paa-practice-cache-note{margin:0 0 8px}
.paa-practice-opponent-layout{position:relative;min-width:0;container:practice-opponents / inline-size;--paa-opponent-detail-width:min(232px,47%)}
/* Keep the connected opponent panel and its selection indicator under the run mask. */
.paa-workspace[aria-busy=true] .paa-practice-opponent-layout{z-index:0}
/* Disabled opponent buttons are already dimmed; match their text and portraits. */
.paa-workspace[aria-busy=true] .paa-practice-enemy-content,
.paa-practice[data-calculating=true] .paa-practice-enemy-content{opacity:.45}
/* Left-side controls and forecasts stay in place, including in narrow layouts. */
.paa-practice[data-calculating=true] .paa-wb-left>:is(.paa-practice-context,.paa-practice-opponent-section,.paa-practice-forecast-section,.paa-quest-section){position:relative;isolation:isolate}
.paa-practice[data-calculating=true] .paa-wb-left>:is(.paa-practice-context,.paa-practice-opponent-section,.paa-practice-forecast-section,.paa-quest-section)::after{content:'';position:absolute;inset:0;z-index:10;border-radius:10px;background:rgba(112,128,150,.18);cursor:progress;pointer-events:auto}
.paa-practice-opponent-layout[data-has-opponents=true]{min-height:260px}
.paa-practice-opponents{position:relative;display:grid;gap:6px;min-width:0;transition:margin-right .22s ease}
.paa-practice-opponent-layout[data-open=true] .paa-practice-opponents{margin-right:calc(var(--paa-opponent-detail-width) + 8px)}
.paa-practice-opponent-layout[data-open=true] :is(.paa-practice-opponent-heading small,.paa-practice-opponent-comment,.paa-practice-rank>span){display:none}
.paa-practice-opponent-layout[data-open=true] .paa-practice-rank{width:auto}
.paa-practice-opponent-layout[data-open=true] .paa-practice-rank:not([data-outcome]){display:none}
.paa-practice-opponent-indicator{position:absolute;left:0;top:0;z-index:0;pointer-events:none;visibility:hidden;border-radius:8px;background:rgba(101,153,220,.14);box-shadow:inset 0 0 0 1px #6f9edc}
.paa-practice-opponent-indicator[data-ready=true]{visibility:visible;transition:transform .26s cubic-bezier(.2,.65,.3,1)}
.paa-practice-opponent-indicator[data-ready=true][data-tracking=true]{transition:none}
.paa-practice-opponent-item{position:relative;z-index:1;min-width:0;border-radius:8px}.paa-practice-opponent-row{box-sizing:border-box;display:flex;align-items:center;gap:4px;min-width:0;height:52px;padding-right:5px}
/* Keep the selected row's result aligned with rows that still show a toggle. */
.paa-practice-opponent-item[data-selected=true] .paa-practice-opponent-row::after{content:'';flex:none;width:34px}
.paa-practice-opponent-item:not([data-disabled=true]),.paa-practice-opponent-item:not([data-disabled=true]) *{cursor:pointer}
.paa-practice-opponent-item:hover:not([data-selected=true]):not([data-disabled=true]){background:rgba(140,180,240,.08);box-shadow:inset 0 0 0 1px #6f9edc}
.paa-practice-opponent-item[data-selected=true]{background:rgba(101,153,220,.14);box-shadow:inset 0 0 0 1px #6f9edc}
.paa-practice-opponents[data-motion-ready=true] .paa-practice-opponent-item[data-selected=true]{background:transparent;box-shadow:none}
.paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-indicator{z-index:4;border-radius:8px 0 0 8px}
.paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-item{z-index:5}
.paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-item[data-selected=true]{border-radius:8px 0 0 8px}
.paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-indicator[data-ready=true]::after,
.paa-practice-opponent-layout[data-open=true] .paa-practice-opponents:not([data-motion-ready=true]) .paa-practice-opponent-item[data-selected=true]::after{content:'';position:absolute;right:-9px;top:0;bottom:0;width:12px;box-sizing:border-box;border-top:1px solid #6f9edc;border-bottom:1px solid #6f9edc;background:linear-gradient(rgba(101,153,220,.14),rgba(101,153,220,.14)),var(--paa-card);pointer-events:none}
@media(prefers-reduced-motion:reduce){.paa-practice-opponent-indicator[data-ready=true]{transition:none}}
.paa .paa-practice-opponent-select{box-sizing:border-box;display:flex;align-items:center;gap:10px;flex:1;min-width:0;height:52px;min-height:52px;padding:4px 10px;text-align:left;color:var(--paa-text);background:transparent;border:1px solid transparent;border-radius:8px;cursor:pointer}
.paa .paa-practice-opponent-select:hover:not(:disabled){border-color:transparent;color:var(--paa-text)}
.paa .paa-practice-opponent-toggle{display:inline-flex;flex-direction:column;align-items:center;justify-content:center;flex:none;width:34px;height:38px;min-height:38px;padding:0;border:1px solid var(--paa-line);border-radius:6px;background:transparent;color:var(--paa-muted)}
.paa .paa-practice-opponent-toggle:hover:not(:disabled){color:var(--paa-accent);border-color:var(--paa-accent)}
.paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-toggle:not(:hover){border-color:transparent}
.paa-practice-opponent-count{font-size:10px;line-height:12px;white-space:nowrap}.paa-practice-opponent-toggle svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;transition:transform .16s ease}.paa-practice-opponent-toggle[aria-expanded=true] svg{transform:rotate(180deg)}
.paa-practice-opponent-body{display:flex;flex:1;flex-direction:column;min-width:0;gap:3px}.paa-practice-opponent-heading{display:flex;align-items:baseline;gap:5px;min-width:0;white-space:nowrap}.paa-practice-opponent-heading strong{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:14px}.paa-practice-opponent-body small{font-size:12px;color:var(--paa-muted)}.paa-practice-opponent-heading small:first-of-type{min-width:0;overflow:hidden;text-overflow:ellipsis}.paa-practice-opponent-heading small:last-child{flex:none}.paa-practice-opponent-comment{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.paa-practice-opponent-portrait{width:64px;height:38px;flex:none;overflow:hidden;border-radius:4px;background:var(--paa-soft)}.paa-practice-opponent-portrait img{width:100%;height:100%;object-fit:cover}
.paa-practice-rank{display:inline-flex;align-items:baseline;justify-content:flex-end;gap:3px;flex:none;width:52px;white-space:nowrap;font-size:11px;font-weight:600;line-height:18px}
.paa-practice-rank strong{font-size:15px;line-height:18px}.paa-practice-rank[data-outcome=win]{color:#896516}.paa-practice-rank[data-outcome=loss]{color:#a0434b}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa-practice-rank[data-outcome=win]{color:#e8c76f}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa-practice-rank[data-outcome=loss]{color:#ed9398}
.paa-practice-enemy-detail{position:absolute;top:0;right:0;bottom:0;z-index:2;box-sizing:border-box;width:0;min-width:0;overflow:hidden;overscroll-behavior:contain;scrollbar-width:thin;border:1px solid #6f9edc;border-radius:0 8px 8px 0;background:var(--paa-card);visibility:hidden;transition:width .22s ease,visibility 0s linear .22s;pointer-events:none}
.paa-practice-enemy-detail[data-open=true]{width:var(--paa-opponent-detail-width);visibility:visible;transition:width .22s ease;pointer-events:auto}
.paa-practice-opponent-layout[data-open=true] .paa-practice-enemy-detail{width:var(--paa-opponent-detail-width);visibility:visible}
.paa-practice-enemy-content{height:100%;min-height:0}.paa-practice-enemy-content>p{padding:5px 10px}
.paa-practice-enemy-ships{box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(6,minmax(0,1fr));gap:0;width:100%;height:100%;min-width:0;padding:0 7px 0 10px;font-size:12px;color:var(--paa-text)}
.paa-practice-enemy-ship{position:relative;display:flex;align-items:center;min-width:0;min-height:0;padding:0 2px}.paa-practice-enemy-ship:not(:last-child)::after{content:'';position:absolute;right:0;bottom:0;left:0;height:1px;background:var(--paa-line)}
.paa-practice-enemy-head{display:flex;flex:1;align-items:center;gap:8px;min-width:0}.paa-practice-enemy-portrait{position:relative;width:48px;height:28px;flex:none;border-radius:4px;overflow:hidden;background:var(--paa-soft);display:grid;place-items:center}.paa-practice-enemy-portrait img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.paa-practice-enemy-index{flex:0 0 12px;color:var(--paa-muted);font-size:11px;line-height:1;text-align:center;font-variant-numeric:tabular-nums}
.paa-practice-enemy-identity{min-width:0;flex:1;display:flex;flex-direction:column;gap:1px}.paa-practice-enemy-identity strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.paa-practice-enemy-identity small{overflow:hidden;text-overflow:ellipsis;color:var(--paa-muted);font-size:11px;white-space:nowrap}
@container practice-opponents (max-width:350px){
 .paa-practice-opponent-row{height:48px}
 .paa .paa-practice-opponent-select{height:48px;min-height:48px;padding-block:2px}
 .paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-portrait{display:none}
 .paa .paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-select{gap:4px;padding-inline:6px}
 .paa .paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-toggle{width:30px}
 .paa-practice-opponent-layout[data-open=true] .paa-practice-opponent-item[data-selected=true] .paa-practice-opponent-row::after{width:30px}
 .paa-practice-enemy-ship{padding-inline:0}.paa-practice-enemy-head{gap:4px}.paa-practice-enemy-index{flex-basis:9px}.paa-practice-enemy-portrait{width:34px;height:24px}
}
.paa-practice-forecast{display:flex;align-items:center;gap:20px}.paa-practice-pie{width:92px;height:92px;flex:none;border-radius:50%;box-shadow:inset 0 0 0 1px rgba(255,255,255,.14)}
.paa-practice-forecast-legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px;flex:1;min-width:0}.paa-practice-forecast-legend>div{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:7px;font-size:12px}.paa-practice-forecast-legend strong{font-variant-numeric:tabular-nums;font-weight:600}.paa-practice-forecast-dot{width:8px;height:8px;border-radius:50%}
.paa-practice-consumption-item{display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.paa-practice-resources .paa-practice-resource-items{display:flex;align-items:center;gap:9px;min-width:0;overflow-x:auto;white-space:nowrap;font-variant-numeric:tabular-nums;scrollbar-width:thin}
.paa-practice-resources .paa-practice-consumption-item{gap:3px;color:var(--paa-text)}
.paa-workbench .paa-practice-narrow-overlay{display:none}
@container(max-width:780px){
 .paa-workbench[data-kind=practice] .paa-wb-columns{display:flex;flex-direction:column;align-items:stretch}
 .paa-workbench[data-kind=practice] :is(.paa-wb-left,.paa-wb-right){display:contents}
 .paa-workbench[data-kind=practice] .paa-wb-left>.paa-practice-context{order:0;padding:0;border:0;background:transparent}
 .paa-workbench[data-kind=practice] .paa-wb-left>.paa-practice-opponent-section{order:1}
 .paa-workbench[data-kind=practice] .paa-wb-right>.paa-wb-command-area{order:2;padding:10px 12px;border:1px solid var(--paa-line);border-radius:10px}
 .paa-workbench[data-kind=practice] .paa-wb-right>.paa-operation-feedback,.paa-workbench[data-kind=practice] .paa-wb-right>.paa-fleet-warning{order:2}
 .paa-workbench[data-kind=practice] :is(.paa-wb-fleet-results,.paa-wb-fleet-results-content){display:contents}
 .paa-workbench[data-kind=practice] .paa-wb-fleet-results-content>.paa-wb-metrics{order:3}
 .paa-workbench[data-kind=practice] .paa-wb-fleet-results-content>.paa-wb-ships{order:5}
 .paa-workbench[data-kind=practice] .paa-wb-fleet-results-content[aria-hidden=true]>.paa-wb-metrics{opacity:.55}
 .paa-workbench[data-kind=practice] .paa-wb-fleet-results>.paa-wb-fleet-overlay{display:none}
 .paa-workbench[data-kind=practice] .paa-practice-narrow-overlay{display:flex}
 .paa-workbench[data-kind=practice] .paa-wb-left>.paa-practice-forecast-section{order:4}
 .paa-workbench[data-kind=practice] .paa-wb-left>.paa-quest-section{order:6}
}
@container(max-width:500px){.paa-practice-forecast-legend{grid-template-columns:minmax(0,1fr)}}
@container(max-width:400px){.paa .paa-practice-opponent-select{gap:6px;padding-inline:6px}.paa-practice-opponent-portrait{width:48px;height:30px}.paa-practice-rank{width:46px}}
@media(prefers-reduced-motion:reduce){.paa-practice-opponents,.paa-practice-enemy-detail{transition:none}}
`;
