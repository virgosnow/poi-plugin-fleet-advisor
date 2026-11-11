'use strict';
module.exports=`
.paa .paa-quest-section{margin:0;padding:14px 16px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card);min-width:0;cursor:pointer}
.paa .paa-quest-disclosure{margin:0}
.paa .paa-workbench .paa-wb-left .paa-quest-disclosure>summary{display:flex;align-items:center;gap:8px;min-height:24px;padding:0;list-style:none;font-size:14px;font-weight:600;line-height:22px;color:var(--paa-text)}
.paa .paa-quest-disclosure>summary,.paa .paa-quest-disclosure>summary *,.paa .paa-quest-disclosure>summary::after{cursor:pointer}
.paa-quest-disclosure>summary::-webkit-details-marker{display:none}
.paa-quest-disclosure>summary>span:first-child{flex:1;min-width:0}
.paa-quest-disclosure>summary::after{content:'';flex:none;width:6px;height:6px;margin-right:2px;border:solid var(--paa-muted);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.paa-quest-disclosure[open]>summary::after{transform:rotate(225deg)}
.paa-quest-count{color:var(--paa-muted);font-size:12px;font-weight:400}
.paa-quest-content{margin-top:12px;min-width:0;cursor:auto}
.paa-quest-selected-compact{margin-top:7px}.paa-quest-selected-compact>ul{display:flex;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none}.paa-quest-selected-compact li{font-size:12px;line-height:18px;color:#805c13;overflow-wrap:anywhere}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme="dark"]) .paa-quest-selected-compact li{color:#d6ae50}
.paa-quest-selection{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;color:var(--paa-muted);font-size:12px}.paa .paa-quest-selection button{min-height:26px;padding:2px 7px;font-size:11px;white-space:nowrap}
.paa-quest-list{display:flex;flex-direction:column;gap:16px;max-height:320px;overflow-y:auto;scrollbar-gutter:stable;min-width:0;padding:10px 3px 3px;overscroll-behavior:contain}
.paa-quest-list:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px;border-radius:3px}
.paa-quest-item{position:relative;padding:8px;min-width:0;border:1px solid transparent;border-radius:7px;cursor:pointer}
.paa-quest-item+.paa-quest-item{border-top:1px solid var(--paa-line)}
.paa-quest-item:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px}
.paa-quest-item[data-selected=true],.paa-quest-item+.paa-quest-item[data-selected=true]{border:1px solid #d6ae50}
.paa-quest-preselected{position:absolute;top:-8px;right:12px;padding:0 4px;background:var(--paa-card);color:#d6ae50;font-size:12px;font-weight:600;line-height:16px}
.paa-quest-header,.paa-overview-quest-header{display:flex;flex-wrap:wrap;align-items:flex-start;gap:4px 10px;min-width:0}.paa-quest-heading,.paa-overview-quest-heading{flex:1 1 210px}
.paa-quest-heading{display:flex;align-items:flex-start;gap:8px;min-width:0;margin-bottom:4px}
.paa-quest-heading h4{flex:1}
.paa-quest-number{flex:none;padding:0 5px;border-radius:4px;background:var(--paa-soft);color:var(--paa-accent);font-size:11px;font-weight:600;line-height:18px;font-variant-numeric:tabular-nums}
.paa .paa-workbench .paa-wb-left .paa-quest-heading h4{min-width:0;margin:0;font-size:14px;font-weight:600;line-height:22px;color:var(--paa-text);overflow-wrap:anywhere}
.paa-quest-meta{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 8px;margin:0 0 4px auto;min-width:0}
.paa-quest-progress{color:var(--paa-muted);font-size:11px;line-height:16px;white-space:nowrap}.paa-quest-progress[data-complete=true]{color:var(--paa-good)}
.paa-quest-period,.paa-quest-state{font-size:12px;font-weight:400;line-height:18px;color:var(--paa-muted);white-space:nowrap}
.paa-quest-state[data-active=true]{color:var(--paa-good)}
.paa .paa-quest-goals,.paa .paa-quest-requirements{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:start;gap:8px;margin:0;color:var(--paa-text);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.paa .paa-quest-requirements{margin-top:6px}
.paa-quest-row-label{color:var(--paa-muted);font-size:12px;line-height:20px;white-space:nowrap}
.paa-quest-goals>ul{display:flex;flex-direction:column;gap:2px;list-style:none;padding:0;margin:0;min-width:0}
.paa-quest-goals li{display:flex;align-items:baseline;gap:8px;min-width:0}.paa-quest-goal-text{flex:1;min-width:0;overflow-wrap:anywhere}.paa-quest-goal-progress{flex:none;margin-left:auto;color:var(--paa-muted);font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.paa .paa-quest-goal-link{flex:1;min-width:0;min-height:20px;padding:0;border:0;background:transparent;color:var(--paa-accent);font-size:12px;line-height:20px;text-align:left;white-space:normal;overflow-wrap:anywhere}.paa .paa-quest-goal-link:hover:not(:disabled){text-decoration:underline}.paa .paa-quest-goal-link strong{font-size:13px;font-variant-numeric:tabular-nums}
.paa-quest-goal-links{display:flex;flex-wrap:wrap;gap:4px 10px}.paa .paa-quest-goal-links .paa-quest-goal-link{flex:none}
.paa-quest-goals li[data-related=false]{color:var(--paa-muted);font-size:12px;line-height:20px}
.paa .paa-overview-quest .paa-quest-requirements,.paa .paa-overview-quest .paa-quest-goals,.paa .paa-quest-item .paa-quest-requirements,.paa .paa-quest-item .paa-quest-goals,.paa .paa-overview-quest .paa-overview-rewards,.paa .paa-quest-item .paa-overview-rewards{display:grid;grid-template-columns:40px minmax(0,1fr);align-items:start;gap:8px;margin:6px 0 0;padding:6px 0 0;border:0;border-top:1px solid var(--paa-line);border-radius:0;background:transparent;color:var(--paa-text);font-size:12px;line-height:20px}
.paa .paa-overview-quest .paa-quest-row-label,.paa .paa-quest-item .paa-quest-row-label{font-size:12px;line-height:20px;color:var(--paa-muted)}
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
.paa .paa-quest-condition-status{margin:0 0 0 auto;font-size:12px;line-height:18px;color:var(--paa-muted)}
.paa-quest-condition-status[data-status=met]{color:var(--paa-good)}
.paa-quest-condition-status[data-status=unmet]{color:#ce934c}
.paa .paa-quest-empty{margin:0;color:var(--paa-muted);font-size:12px;line-height:20px}
/* Normal-map tasks share the overview cards' hierarchy, while the whole card remains selectable. */
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-list{gap:12px;padding:10px 3px 2px 2px}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-item,.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-item+.paa-quest-item{padding:10px 11px;border:1px solid var(--paa-line);border-radius:9px;background:color-mix(in srgb,var(--paa-bg) 70%,var(--paa-card))}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-item:hover:not([aria-disabled=true]){border-color:color-mix(in srgb,var(--paa-accent) 45%,var(--paa-line))}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-item[data-selected=true],.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-item[data-selected=true]:hover{border-color:#d6ae50}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-meta{align-items:center;gap:6px;margin-bottom:4px}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-period{padding:0 5px;border-radius:4px;background:var(--paa-soft);font-size:10px;line-height:16px}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-state,.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-condition-status{font-size:11px;line-height:16px}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-heading{margin:0 0 8px}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-heading h4{font-size:13px;line-height:19px}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-goals,.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-requirements{font-size:12px;line-height:18px}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-goals li[data-related=true]>strong{color:var(--paa-accent);font-size:13px;font-variant-numeric:tabular-nums}
.paa .paa-workbench:is([data-kind=normal],[data-kind=practice]) .paa-quest-checks>li{font-size:12px;line-height:18px}
/* Keep the first goal aligned with the section label and make progress easy to scan. */
.paa .paa-overview-quest .paa-quest-requirements li,.paa .paa-overview-quest .paa-overview-reward-item,.paa .paa-quest-item .paa-overview-reward-item{line-height:20px}
.paa .paa-overview-quest .paa-overview-goal-content>.paa-overview-quest-target{align-items:center;width:calc(100% + 12px);min-height:24px;margin:-2px -6px 2px;padding:2px 6px;line-height:20px}
.paa .paa-quest-item .paa-quest-goals li{align-items:flex-start}
.paa .paa-quest-item .paa-quest-goals>ul{gap:6px}
.paa .paa-overview-goal-status,.paa .paa-quest-goal-progress{position:relative;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:62px;min-height:20px;padding:0 17px;border:1px solid var(--paa-line);border-radius:5px;background:color-mix(in srgb,var(--paa-soft) 50%,transparent);color:var(--paa-muted);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums;white-space:nowrap}
.paa .paa-overview-goal-status[data-complete=true],.paa .paa-quest-goal-progress[data-complete=true]{border-color:color-mix(in srgb,var(--paa-good) 40%,var(--paa-line));background:color-mix(in srgb,var(--paa-good) 10%,transparent);color:var(--paa-good)}
.paa .paa-overview-goal-status[data-complete=true]::before,.paa .paa-quest-goal-progress[data-complete=true]::before{--paa-check-icon:url("data:image/svg+xml,%3Csvg%20xmlns%3D%27http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%27%20viewBox%3D%270%200%2016%2016%27%3E%3Cpath%20fill%3D%27none%27%20stroke%3D%27black%27%20stroke-width%3D%272%27%20stroke-linecap%3D%27round%27%20stroke-linejoin%3D%27round%27%20d%3D%27M3%208.3%206.5%2012%2013%204%27%2F%3E%3C%2Fsvg%3E");content:'';position:absolute;left:4px;top:50%;width:10px;height:10px;transform:translateY(-50%);background:currentColor;-webkit-mask:var(--paa-check-icon) center/contain no-repeat;mask:var(--paa-check-icon) center/contain no-repeat}
.paa .paa-overview-quest .paa-overview-quest-target .paa-overview-target-label,.paa .paa-overview-quest .paa-overview-goal[data-complete=true] .paa-overview-target-label strong{color:var(--paa-accent)}
.paa .paa-overview-quest .paa-overview-quest-target:hover:not(:disabled){background:transparent}
.paa .paa-overview-quest .paa-overview-quest-target:hover:not(:disabled) .paa-overview-target-label{text-decoration:underline}
@container(max-width:780px){.paa-workbench[data-kind=expedition] .paa-quest-section{order:2}}
`;
