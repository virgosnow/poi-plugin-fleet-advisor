'use strict';
module.exports=`
.paa .paa-quest-section{margin:0;padding:14px 16px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card);min-width:0;cursor:pointer}
.paa .paa-workbench .paa-wb-left .paa-quest-section>summary{display:flex;align-items:center;gap:8px;min-height:24px;padding:0;list-style:none;font-size:14px;font-weight:600;line-height:22px;color:var(--paa-text)}
.paa .paa-quest-section>summary,.paa .paa-quest-section>summary *,.paa .paa-quest-section>summary::after{cursor:pointer}
.paa-quest-section>summary::-webkit-details-marker{display:none}
.paa-quest-section>summary>span:first-child{flex:1;min-width:0}
.paa-quest-section>summary::after{content:'';flex:none;width:6px;height:6px;margin-right:2px;border:solid var(--paa-muted);border-width:0 1.5px 1.5px 0;transform:rotate(45deg)}
.paa-quest-section[open]>summary::after{transform:rotate(225deg)}
.paa-quest-count{color:var(--paa-muted);font-size:12px;font-weight:400}
.paa-quest-content{margin-top:12px;min-width:0;cursor:auto}
.paa-quest-selection{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;color:var(--paa-muted);font-size:12px}.paa .paa-quest-selection button{min-height:26px;padding:2px 7px;font-size:11px;white-space:nowrap}
.paa-quest-list{display:flex;flex-direction:column;gap:16px;max-height:320px;overflow-y:auto;scrollbar-gutter:stable;min-width:0;padding:10px 3px 3px;overscroll-behavior:contain}
.paa-quest-list:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px;border-radius:3px}
.paa-quest-item{position:relative;padding:8px;min-width:0;border:1px solid transparent;border-radius:7px;cursor:pointer}
.paa-quest-item+.paa-quest-item{border-top:1px solid var(--paa-line)}
.paa-quest-item:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px}
.paa-quest-item[data-selected=true],.paa-quest-item+.paa-quest-item[data-selected=true]{border:1px solid #d6ae50}
.paa-quest-preselected{position:absolute;top:-8px;right:12px;padding:0 4px;background:var(--paa-card);color:#d6ae50;font-size:12px;font-weight:600;line-height:16px}
.paa-quest-heading{display:flex;align-items:flex-start;gap:8px;min-width:0;margin-bottom:4px}
.paa-quest-heading h4{flex:1}
.paa .paa-workbench .paa-wb-left .paa-quest-heading h4{min-width:0;margin:0;font-size:14px;font-weight:600;line-height:22px;color:var(--paa-text);overflow-wrap:anywhere}
.paa-quest-meta{display:flex;align-items:baseline;flex-wrap:wrap;gap:3px 8px;margin-bottom:8px;min-width:0}
.paa-quest-period,.paa-quest-state{font-size:12px;font-weight:400;line-height:18px;color:var(--paa-muted);white-space:nowrap}
.paa-quest-state[data-active=true]{color:var(--paa-accent)}
.paa .paa-quest-goals,.paa .paa-quest-requirements{display:grid;grid-template-columns:28px minmax(0,1fr);align-items:start;gap:8px;margin:0;color:var(--paa-text);font-size:13px;line-height:20px;overflow-wrap:anywhere}
.paa .paa-quest-requirements{margin-top:6px}
.paa-quest-row-label{color:var(--paa-muted);font-size:12px;line-height:20px;white-space:nowrap}
.paa-quest-goals>ul{display:flex;flex-direction:column;gap:2px;list-style:none;padding:0;margin:0;min-width:0}
.paa-quest-goals li[data-related=false]{color:color-mix(in srgb,var(--paa-muted) 60%,var(--paa-card));font-size:11px;line-height:16px}
.paa-quest-checks{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:4px}
.paa-quest-checks>li{display:grid;grid-template-columns:12px minmax(0,1fr) fit-content(45%);align-items:baseline;gap:6px;font-size:13px;line-height:20px;color:var(--paa-muted)}
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
@container(max-width:780px){.paa-workbench[data-kind=expedition] .paa-quest-section{order:2}}
`;
