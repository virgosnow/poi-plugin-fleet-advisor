'use strict';
module.exports=`
.paa .paa-quest-section{margin:0;padding:14px 16px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card);min-width:0;cursor:pointer}
.paa .paa-quest-disclosure{margin:0}
.paa .paa-workbench .paa-wb-left .paa-quest-disclosure>summary{display:flex;align-items:center;gap:8px;min-height:24px;padding:0;list-style:none;font-size:14px;font-weight:600;line-height:22px;color:var(--paa-text)}
.paa .paa-quest-disclosure>summary,.paa .paa-quest-disclosure>summary *{cursor:pointer}
.paa-quest-disclosure>summary::-webkit-details-marker{display:none}
.paa-quest-disclosure>summary>span:first-child{flex:1;min-width:0}
.paa-quest-expand-icon{flex:none;width:16px;height:16px;color:var(--paa-muted);fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.paa-quest-count{color:var(--paa-muted);font-size:12px;font-weight:400}
.paa-quest-content{margin-top:12px;min-width:0;cursor:auto}
.paa-quest-selected-compact{margin-top:7px}.paa-quest-selected-compact>ul{display:flex;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none}.paa-quest-selected-compact li{font-size:12px;line-height:18px;color:#805c13;overflow-wrap:anywhere}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme="dark"]) .paa-quest-selected-compact li{color:#d6ae50}
.paa-quest-selection{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;color:var(--paa-muted);font-size:12px}.paa .paa-quest-selection button{min-height:26px;padding:2px 7px;font-size:11px;white-space:nowrap}
.paa-quest-list{display:flex;flex-direction:column;gap:16px;max-height:320px;overflow-y:auto;scrollbar-gutter:stable;min-width:0;padding:10px 3px 3px;overscroll-behavior:contain}
.paa-workbench[data-kind] .paa-wb-left[data-quest-focus=true]{display:flex;flex-direction:column;align-self:start;box-sizing:border-box;height:var(--paa-quest-focus-height,calc(100vh - 132px));min-height:280px;overflow:hidden}
.paa-workbench .paa-wb-left[data-quest-focus=true]:not([data-quest-transition])>:not(.paa-quest-focus-rows):not(.paa-quest-section){display:none!important}
.paa-quest-focus-rows{display:none;flex:none;flex-direction:column;gap:6px;min-width:0}.paa-wb-left[data-quest-focus=true]>.paa-quest-focus-rows{display:flex}
.paa .paa-quest-focus-row{display:flex;align-items:center;gap:8px;min-width:0;min-height:32px;padding:5px 16px;border:1px solid var(--paa-line);border-radius:7px;background:var(--paa-card);color:var(--paa-text);font-size:14px;line-height:22px;text-align:left}
.paa .paa-quest-focus-row:hover{background:var(--paa-soft);border-color:var(--paa-accent)}.paa-quest-focus-row>span:first-child{flex:none;font-weight:600}.paa-quest-focus-value{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:right;color:var(--paa-muted);font-size:12px}.paa-quest-focus-row svg{flex:none;width:16px;height:16px;fill:none;stroke:var(--paa-muted);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round}
.paa .paa-wb-left[data-quest-focus=true]>.paa-quest-section{display:flex;flex:1;flex-direction:column;min-height:0;padding-right:4px;overflow:hidden;cursor:default}
.paa .paa-wb-left[data-quest-focus=true]>.paa-quest-section>.paa-quest-disclosure{margin-right:12px}
.paa .paa-wb-left[data-quest-focus=true]>.paa-quest-section :is(.paa-quest-selection,.paa-quest-empty){margin-right:12px}
.paa .paa-wb-left[data-quest-focus=true]>.paa-quest-section>.paa-quest-main-content:not([hidden]){display:flex;flex:1;flex-direction:column;min-height:0;overflow:hidden}
.paa .paa-wb-left[data-quest-focus=true] .paa-quest-list{flex:1;max-height:none;min-height:0}
/* Interpolate actual block heights: text stays unscaled while upper sections
   compress and the task card grows into the released space. */
@supports (interpolate-size:allow-keywords){
 .paa-workbench .paa-wb-left[data-quest-transition]{position:relative;interpolate-size:allow-keywords;transition:height .38s cubic-bezier(.22,.7,.3,1);overflow:clip}
 .paa-workbench .paa-wb-left[data-quest-transition]>:not(.paa-quest-focus-rows):not(.paa-quest-section){flex:0 0 auto;height:auto;min-height:0;overflow:clip;opacity:1;transition:height .38s cubic-bezier(.22,.7,.3,1),margin-bottom .38s cubic-bezier(.22,.7,.3,1),padding-top .38s cubic-bezier(.22,.7,.3,1),padding-bottom .38s cubic-bezier(.22,.7,.3,1),border-top-width .38s cubic-bezier(.22,.7,.3,1),border-bottom-width .38s cubic-bezier(.22,.7,.3,1),opacity .2s ease}
 .paa-workbench .paa-wb-left[data-quest-transition][data-quest-focus=true]>:not(.paa-quest-focus-rows):not(.paa-quest-section){height:0;margin-bottom:-12px;padding-top:0;padding-bottom:0;border-top-width:0;border-bottom-width:0;opacity:0;pointer-events:none}
 /* Place summaries after the collapsing sections until the transition ends,
    so every section moves upward together rather than being pushed down. */
 .paa-workbench .paa-wb-left[data-quest-transition]>.paa-quest-focus-rows{order:1;display:flex;height:0;min-height:0;overflow:visible;opacity:0;pointer-events:none;transition:height .38s cubic-bezier(.22,.7,.3,1),margin-bottom .38s cubic-bezier(.22,.7,.3,1),opacity .2s ease}
 .paa-workbench .paa-wb-left[data-quest-transition]:not([data-quest-focus=true])>.paa-quest-focus-rows{margin-bottom:-12px}
 .paa-workbench .paa-wb-left[data-quest-transition][data-quest-focus=true]>.paa-quest-focus-rows{height:var(--paa-quest-rows-height,auto);opacity:1}
 .paa-workbench .paa-wb-left[data-quest-transition] .paa-quest-focus-row{position:absolute;top:var(--paa-quest-row-top,0px);left:var(--paa-quest-rows-left,0px);right:var(--paa-quest-rows-right,0px);transform:translateY(var(--paa-quest-origin-offset,0px));transition:transform .38s cubic-bezier(.22,.7,.3,1)}
 .paa-workbench .paa-wb-left[data-quest-transition][data-quest-focus=true] .paa-quest-focus-row{transform:translateY(0)}
 .paa-workbench[data-kind=practice] .paa-wb-left[data-quest-transition] .paa-practice-training-title{transform:translateY(0);transition:transform .38s cubic-bezier(.22,.7,.3,1)}
 .paa-workbench[data-kind=practice] .paa-wb-left[data-quest-transition][data-quest-focus=true] .paa-practice-training-title{transform:translateY(calc(-1 * var(--paa-quest-training-label-offset,0px)))}
 .paa-workbench[data-kind=practice] .paa-wb-left[data-quest-transition] [data-quest-focus-key=training]>span:first-child{transform:translateY(var(--paa-quest-training-label-offset,0px));transition:transform .38s cubic-bezier(.22,.7,.3,1)}
 .paa-workbench[data-kind=practice] .paa-wb-left[data-quest-transition][data-quest-focus=true] [data-quest-focus-key=training]>span:first-child{transform:translateY(0)}
 .paa .paa-wb-left[data-quest-transition]>.paa-quest-section{order:2;display:flex;flex:0 1 var(--paa-quest-collapsed-height,52px);flex-direction:column;min-height:var(--paa-quest-collapsed-height,52px);overflow:hidden;transition:flex-grow .38s cubic-bezier(.22,.7,.3,1)}
 .paa .paa-wb-left[data-quest-transition][data-quest-focus=true]>.paa-quest-section{flex:1 1 var(--paa-quest-collapsed-height,52px)}
 .paa .paa-wb-left[data-quest-transition]>.paa-quest-section>.paa-quest-content:last-child{display:flex!important;flex:1;flex-direction:column;min-height:0;overflow:hidden;opacity:1;transition:opacity .22s ease,visibility 0s linear}
 .paa .paa-wb-left[data-quest-transition]>.paa-quest-section>.paa-quest-content:last-child[hidden]{opacity:0;visibility:hidden;transition:opacity .22s ease,visibility 0s linear .22s}
}
@media(prefers-reduced-motion:reduce){.paa-workbench .paa-wb-left[data-quest-transition],.paa-workbench .paa-wb-left[data-quest-transition] *{transition:none!important}}
.paa-quest-list:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px;border-radius:3px}
.paa-quest-item{position:relative;padding:8px;min-width:0;border:1px solid transparent;border-radius:7px;cursor:pointer}
.paa-quest-item+.paa-quest-item{border-top:1px solid var(--paa-line)}
.paa-quest-item:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px}
.paa-quest-item[data-selected=true],.paa-quest-item+.paa-quest-item[data-selected=true]{border:1px solid #d6ae50}
.paa-quest-preselected{position:absolute;top:-8px;right:12px;padding:0 4px;background:var(--paa-card);color:#d6ae50;font-size:12px;font-weight:600;line-height:16px}
.paa-quest-header,.paa-overview-quest-header{display:flex;align-items:flex-start;gap:8px;min-width:0}.paa-quest-heading,.paa-overview-quest-heading{flex:1 1 0;align-items:flex-start;min-width:0}
.paa-quest-heading,.paa-overview-quest-heading{display:grid;grid-template-columns:48px minmax(0,1fr);column-gap:12px;align-items:start;min-width:0}
.paa-quest-heading{margin-bottom:4px}
.paa-quest-heading h4,.paa-overview-quest-heading h4{grid-column:2;min-width:0}
.paa .paa-workbench .paa-wb-left .paa-quest-heading h4{min-width:0;margin:0;font-size:14px;font-weight:600;line-height:22px;color:var(--paa-text);overflow-wrap:anywhere}
.paa-quest-meta,.paa-overview-quest-meta{display:flex;flex:none;align-items:center;min-height:19px;margin:0;white-space:nowrap}
.paa .paa-quest-period{--paa-quest-period-color:#606d80;display:inline-flex;flex:none;align-items:center;justify-self:start;margin-top:0;padding:0 4px;border-radius:4px;background:color-mix(in srgb,var(--paa-quest-period-color) 21%,var(--paa-card));color:var(--paa-quest-period-color);font-size:12px;font-weight:600;line-height:20px;white-space:nowrap}
.paa .paa-quest-period[data-period=once]{--paa-quest-period-color:#80620c}.paa .paa-quest-period[data-period=daily]{--paa-quest-period-color:#246aa6}.paa .paa-quest-period[data-period=weekly]{--paa-quest-period-color:#087b70}.paa .paa-quest-period[data-period=monthly]{--paa-quest-period-color:#537c19}.paa .paa-quest-period[data-period=quarterly]{--paa-quest-period-color:#9d5521}.paa .paa-quest-period[data-period=yearly]{--paa-quest-period-color:#505eae}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-period{--paa-quest-period-color:#aab9cf}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-period[data-period=once]{--paa-quest-period-color:#e9ce68}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-period[data-period=daily]{--paa-quest-period-color:#79c4ed}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-period[data-period=weekly]{--paa-quest-period-color:#70d7bd}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-period[data-period=monthly]{--paa-quest-period-color:#b0e060}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-period[data-period=quarterly]{--paa-quest-period-color:#e0a060}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-period[data-period=yearly]{--paa-quest-period-color:#a3aaf5}
.paa .paa-quest-state{font-size:11px;font-weight:500;line-height:19px;white-space:nowrap}.paa .paa-quest-state[data-status=available]{color:#a36113}.paa .paa-quest-state[data-status=active]{color:#237b59}.paa .paa-quest-state[data-status=complete]{color:#356eb5}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-state[data-status=available]{color:#e7b35b}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-state[data-status=active]{color:#80d8b4}:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa .paa-quest-state[data-status=complete]{color:#8bb5ff}
.paa .paa-quest-goals,.paa .paa-quest-requirements{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:start;gap:8px;margin:0;color:var(--paa-text);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.paa .paa-quest-requirements{margin-top:6px}
.paa-quest-row-label{color:var(--paa-muted);font-size:12px;line-height:20px;white-space:nowrap}
.paa-quest-goals>ul{display:flex;flex-direction:column;gap:2px;list-style:none;padding:0;margin:0;min-width:0}
.paa-quest-goals li{display:flex;align-items:baseline;gap:8px;min-width:0}.paa-quest-goal-text{flex:1;min-width:0;overflow-wrap:anywhere}.paa-quest-goal-progress{flex:none;margin-left:auto;color:var(--paa-muted);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.paa .paa-quest-goal-link{flex:1;min-width:0;min-height:20px;padding:0;border:0;background:transparent;color:var(--paa-accent);font-size:12px;line-height:20px;text-align:left;white-space:normal;overflow-wrap:anywhere}.paa .paa-quest-goal-link:hover:not(:disabled){text-decoration:underline}.paa .paa-quest-goal-link strong{font-size:13px;font-variant-numeric:tabular-nums}
.paa-quest-goal-links{display:flex;flex-wrap:wrap;gap:4px 10px}.paa .paa-quest-goal-links .paa-quest-goal-link{flex:none}
.paa-quest-goals li[data-related=false]{color:var(--paa-muted);font-size:12px;line-height:20px}
.paa .paa-overview-quest .paa-quest-requirements,.paa .paa-overview-quest .paa-quest-goals,.paa .paa-quest-item .paa-quest-requirements,.paa .paa-quest-item .paa-quest-goals,.paa .paa-overview-quest .paa-overview-rewards,.paa .paa-quest-item .paa-overview-rewards{display:grid;grid-template-columns:48px minmax(0,1fr);align-items:start;gap:8px 12px;margin:6px 0 0;padding:6px 0 0;border:0;border-top:1px solid var(--paa-line);border-radius:0;background:transparent;color:var(--paa-text);font-size:12px;line-height:20px}
.paa .paa-overview-quest .paa-quest-row-label,.paa .paa-quest-item .paa-quest-row-label{padding-left:4px;font-size:12px;line-height:20px;color:var(--paa-muted)}
.paa .paa-overview-quest .paa-overview-task-goals{margin:0!important}
.paa-quest-checks{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:4px}
.paa-quest-checks>li{display:grid;grid-template-columns:minmax(0,1fr) fit-content(45%) 12px;align-items:baseline;gap:6px;font-size:13px;line-height:20px;color:var(--paa-muted)}
.paa-quest-checks>li>:first-child{grid-column:3;grid-row:1}.paa-quest-checks>li>.paa-quest-check-label{grid-column:1;grid-row:1}.paa-quest-checks>li>.paa-quest-check-value{grid-column:2;grid-row:1}
.paa-quest-checks>li[data-status=met]{color:var(--paa-good)}
.paa-quest-checks>li[data-status=unmet]{color:var(--paa-text)}
.paa-quest-checks>li[data-status=unmet]>.paa-quest-check-mark{color:#ce934c}
.paa-quest-check-mark{width:12px;text-align:center}
.paa-quest-check-label{min-width:0;overflow-wrap:anywhere}
.paa-quest-check-value{min-width:0;max-width:20ch;font-variant-numeric:tabular-nums;white-space:normal;text-align:right;overflow-wrap:anywhere;color:inherit}
.paa .paa-quest-requirement-summary{margin:0;color:var(--paa-muted);font-size:13px;line-height:20px}
.paa .paa-quest-empty{margin:0;color:var(--paa-muted);font-size:12px;line-height:20px}
/* Workbench task cards share the same hierarchy and selection treatment. */
.paa .paa-workbench[data-kind] .paa-quest-list{gap:12px;padding:10px 6px 2px 2px;overflow-x:hidden}
.paa .paa-workbench[data-kind] .paa-quest-list::-webkit-scrollbar{width:9px}
.paa .paa-workbench[data-kind] .paa-quest-list::-webkit-scrollbar-track{border:3px solid transparent;border-radius:8px;background:color-mix(in srgb,var(--paa-muted) 15%,transparent);background-clip:padding-box}
.paa .paa-workbench[data-kind] .paa-quest-list::-webkit-scrollbar-thumb{min-height:32px;border:2px solid transparent;border-radius:8px;background:color-mix(in srgb,var(--paa-muted) 65%,transparent);background-clip:padding-box}
.paa .paa-workbench[data-kind] .paa-quest-list::-webkit-scrollbar-thumb:hover{background-color:var(--paa-muted)}
.paa .paa-workbench[data-kind] .paa-quest-list::-webkit-scrollbar-button{display:none}
.paa .paa-workbench[data-kind] .paa-quest-selection button{font-size:11px;line-height:normal}
.paa .paa-workbench[data-kind] .paa-quest-item,.paa .paa-workbench[data-kind] .paa-quest-item+.paa-quest-item{padding:10px 11px;border:1px solid var(--paa-line);border-radius:9px;background:color-mix(in srgb,var(--paa-bg) 70%,var(--paa-card));font-size:12px;line-height:18px}
.paa .paa-workbench[data-kind] .paa-quest-item .paa-quest-goal-link{font-size:12px;line-height:20px}
.paa .paa-workbench[data-kind] .paa-quest-item[role=checkbox]:not([aria-disabled=true]):hover{border-color:var(--paa-accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--paa-accent) 28%,transparent)}
.paa .paa-workbench[data-kind] .paa-quest-item[data-selected=true]{border-color:#d6ae50}
.paa .paa-workbench[data-kind] .paa-quest-item[data-selected=true]:not([aria-disabled=true]):hover{border-color:#f0cb6e;box-shadow:0 0 0 1px color-mix(in srgb,#f0cb6e 30%,transparent)}
.paa .paa-quest-item[role=checkbox]:not([aria-disabled=true]) :not(button):not(a){cursor:pointer}
.paa .paa-quest-item[aria-disabled=true]{cursor:default}
.paa .paa-quest-item button:disabled,.paa .paa-quest-item button:disabled *{cursor:default}
.paa .paa-quest-wiki-menu{position:fixed;inset:auto;margin:0;padding:5px;min-width:144px;max-width:calc(100vw - 16px);border:1px solid var(--paa-line);border-radius:8px;background:var(--paa-card);color:var(--paa-text);box-shadow:0 8px 24px #0006;z-index:10002}
.paa .paa-quest-wiki-menu a{display:block;padding:6px 10px;border-radius:5px;color:var(--paa-text);font-size:12px;line-height:20px;text-decoration:none;white-space:nowrap;cursor:pointer}
.paa .paa-quest-wiki-menu a:hover,.paa .paa-quest-wiki-menu a:focus-visible{background:var(--paa-soft);color:var(--paa-accent);outline:none}
.paa .paa-workbench[data-kind] .paa-quest-meta{align-items:center}
.paa .paa-workbench[data-kind] .paa-quest-state{font-size:11px;line-height:19px}
.paa .paa-workbench[data-kind] .paa-quest-heading{margin:0 0 8px}
.paa .paa-workbench[data-kind] :is(.paa-quest-heading,.paa-overview-quest-heading) h4{font-size:14px;line-height:20px}
.paa .paa-workbench[data-kind] .paa-quest-goals,.paa .paa-workbench[data-kind] .paa-quest-requirements{font-size:12px;line-height:18px}
.paa .paa-workbench[data-kind] .paa-quest-goals li[data-related=true]>strong{color:var(--paa-accent);font-size:13px;font-variant-numeric:tabular-nums}
.paa .paa-workbench[data-kind] .paa-quest-checks>li{font-size:12px;line-height:18px}
/* Keep the first goal aligned with the section label and make progress easy to scan. */
.paa .paa-overview-quest .paa-quest-requirements li,.paa .paa-overview-quest .paa-overview-reward-item,.paa .paa-quest-item .paa-overview-reward-item{line-height:20px}
.paa .paa-overview-quest .paa-overview-goal-content>.paa-overview-quest-target{align-items:center;width:calc(100% + 12px);min-height:24px;margin:-2px -6px 2px;padding:2px 6px;line-height:20px}
.paa .paa-quest-item .paa-quest-goals li{align-items:flex-start}
.paa .paa-quest-item .paa-quest-goals>ul{gap:6px}
.paa .paa-overview-goal-status,.paa .paa-quest-goal-progress{position:relative;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:62px;min-height:20px;padding:0 17px;border:1px solid var(--paa-line);border-radius:5px;background:color-mix(in srgb,var(--paa-soft) 50%,transparent);color:var(--paa-muted);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.paa .paa-overview-goal-status[data-progress=partial],.paa .paa-quest-goal-progress[data-progress=partial]{color:#236fae}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa :is(.paa-overview-goal-status,.paa-quest-goal-progress)[data-progress=partial]{color:#70bdff}
.paa .paa-overview-goal-status[data-complete=true],.paa .paa-quest-goal-progress[data-complete=true]{color:var(--paa-good)}
.paa .paa-overview-goal-status[data-complete=true]::before,.paa .paa-quest-goal-progress[data-complete=true]::before{--paa-check-icon:url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%3E%3Cpath%20fill%3D%27none%27%20stroke%3D%27black%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%20d%3D%27M3%208.3%206.5%2012%2013%204%27%2F%3E%3C%2Fsvg%3E");content:'';position:absolute;left:4px;top:50%;width:10px;height:10px;transform:translateY(-50%);background:currentColor;-webkit-mask:var(--paa-check-icon) center/contain no-repeat;mask:var(--paa-check-icon) center/contain no-repeat}
.paa .paa-overview-quest .paa-overview-quest-target .paa-overview-target-label,.paa .paa-overview-quest .paa-overview-goal[data-complete=true] .paa-overview-target-label strong{color:var(--paa-accent)}
.paa .paa-overview-quest .paa-overview-quest-target:hover:not(:disabled){background:transparent}
.paa .paa-overview-quest .paa-overview-quest-target:hover:not(:disabled) .paa-overview-target-label{text-decoration:underline}
@container(max-width:780px){.paa-workbench[data-kind=expedition] .paa-quest-section{order:2}}
`;
