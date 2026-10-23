'use strict';
// Keep the expedition's visual treatment local to its left column.
module.exports=`
.paa-workbench[data-kind=expedition] .paa-wb-left{padding:16px;gap:12px;font-size:14px;line-height:22px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(h3,h4,summary,button,select,small,label,.paa-area-label,.paa-area-trigger strong,.paa-area-name,.paa-exp-section-head>span,.paa-exp-income-title>span,.paa-exp-unlock-list,.paa-exp-unlock-caption,.paa-exp-item-note,.paa-exp-condition-caption,.paa-exp-condition,.paa-exp-condition>strong,.paa-exp-condition-detail,.paa-exp-detail-table){font-size:14px;line-height:22px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(h3,h4){font-weight:600;margin:0;color:var(--paa-text)}
.paa-workbench[data-kind=expedition] .paa-wb-left>.paa-wb-context-controls{gap:12px;padding:0 2px 8px;border:0;background:none}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-area-label,.paa-exp-goal-field>span{flex:0 0 28px;width:28px;color:var(--paa-muted);font-size:14px;line-height:22px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-area-picker{gap:10px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-area-trigger{height:40px;min-height:40px;gap:8px;padding:7px 12px;border-radius:6px;background:var(--paa-card);color:var(--paa-text)}
.paa-exp-goal-field{display:flex;align-items:center;gap:10px;min-width:0}
.paa-exp-goal{box-sizing:border-box;height:40px;min-height:40px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));flex:1;min-width:0;gap:3px;padding:3px;border:1px solid var(--paa-line);border-radius:6px;background:var(--paa-card)}
.paa .paa-exp-goal button{min-width:0;min-height:30px;padding:3px 4px;border:0;border-radius:3px;box-shadow:none;background:transparent;color:var(--paa-muted);white-space:normal}
.paa .paa-exp-goal button[aria-pressed=true]{background:var(--paa-soft);color:var(--paa-text);font-weight:500}
.paa .paa-exp-goal button:hover:not(:disabled){background:var(--paa-soft);color:var(--paa-text)}
.paa-workbench[data-kind=expedition] .paa-wb-left [data-result-region=expedition]>.paa-wb-calculation-content{display:flex;flex-direction:column;gap:12px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(.paa-exp-time,.paa-exp-outcome,.paa-exp-income,.paa-exp-unlock){padding:14px 16px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card);color:var(--paa-text)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-section-head{min-height:24px;margin-bottom:9px;gap:8px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-time .paa-exp-section-head{margin:0;padding-right:16px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(.paa-exp-duration,.paa-exp-ready,.paa-exp-rate>strong,.paa-exp-income-row>strong,.paa-exp-item-condition,.paa-exp-item-condition>strong){font-size:18px;line-height:24px;font-variant-numeric:tabular-nums}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-duration{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;color:var(--paa-text);font-weight:700}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-requirements{margin:0!important;padding:0;border:0}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-requirements>summary{padding:0;min-height:22px;font-weight:600;color:var(--paa-text)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-outcome,
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-requirements>summary,
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-requirements>summary *,
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-requirements>summary::after{cursor:pointer}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(.paa-exp-requirements-content,.paa-exp-shortfalls){cursor:auto}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-ready{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px;margin-left:auto;min-width:0;font-size:18px;line-height:24px;font-weight:700;white-space:normal;text-align:right}
.paa-exp-ready-icon{flex:none}
.paa-exp-shortfalls{margin-top:8px}.paa-exp-requirements[open]+.paa-exp-shortfalls{display:none}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-requirements>summary::after{box-sizing:border-box;margin-left:0}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-title{min-width:0;flex-wrap:wrap}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-title>span{color:var(--paa-muted)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-unit{gap:1px;padding:2px;border-radius:5px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-unit button{padding:2px 7px;font-size:14px;line-height:22px;min-height:26px}
.paa-exp-rate{display:flex;align-items:baseline;justify-content:space-between;gap:8px;padding:0 0 9px;border-bottom:1px solid var(--paa-line);color:var(--paa-muted)}
.paa-exp-rate>strong{color:var(--paa-accent);font-weight:600}
.paa-exp-income[data-rate=full] .paa-exp-rate>strong{color:var(--paa-good)}
.paa-exp-income:is([data-rate=zero],[data-rate=unknown]) .paa-exp-rate>strong{color:var(--paa-muted)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-table{margin-top:7px;font-size:14px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row{grid-template-columns:minmax(0,1fr) minmax(78px,1fr);min-height:38px;padding:6px 0;gap:8px;border:0;border-top:1px solid color-mix(in srgb,var(--paa-line) 32%,transparent)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-table[data-columns="3"] .paa-exp-income-row{grid-template-columns:minmax(0,1.15fr) repeat(2,minmax(78px,1fr));column-gap:8px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-heading{min-height:25px;padding:0 0 5px;border:0;font-size:14px;color:var(--paa-muted)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row>strong{color:var(--paa-text);display:flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:0 3px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-item-condition>strong{display:inline-flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:0 3px;white-space:normal}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income .paa-exp-value-unit{font-size:12px;line-height:16px;font-weight:400;color:var(--paa-muted);white-space:nowrap}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row>strong[data-negative=true]{color:var(--paa-bad)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row>strong[data-zero=true]{color:var(--paa-muted);font-weight:400}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-table[data-great-available=false] .paa-exp-resource-great{color:var(--paa-muted)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-resource{gap:6px;min-width:0;overflow-wrap:anywhere}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-resource .paa-resource-icon{flex:none;width:20px!important;height:20px!important}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-details{margin-top:10px!important;padding-top:9px;border-top:1px solid var(--paa-line)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-details>summary{padding:0;font-size:14px;line-height:22px;font-weight:400}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-condition{min-height:32px;padding-block:6px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-detail-table>div{gap:6px;grid-template-columns:repeat(4,minmax(0,1fr))}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-detail-table[data-columns="3"]>div{grid-template-columns:repeat(3,minmax(0,1fr))}
@container(max-width:780px){
 .paa-workbench[data-kind=expedition] .paa-wb-left [data-result-region=expedition]{border:0;background:none;padding:0}
 .paa-workbench[data-kind=expedition] .paa-wb-left>.paa-wb-context-controls{padding:12px 14px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card)}
}
`;
