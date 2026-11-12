'use strict';
// Keep the expedition's visual treatment local to its left column.
module.exports=`
.paa-workbench[data-kind=expedition] .paa-wb-left{padding:16px;gap:12px;font-size:14px;line-height:22px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(h3,h4,summary,button,select,small,label,.paa-area-label,.paa-area-trigger strong,.paa-area-name,.paa-exp-section-head>span,.paa-exp-income-title>span,.paa-exp-unlock-list,.paa-exp-unlock-caption,.paa-exp-item-note,.paa-exp-condition-caption,.paa-exp-condition,.paa-exp-condition>strong,.paa-exp-condition-detail,.paa-exp-detail-table){font-size:14px;line-height:22px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(h3,h4){font-weight:600;margin:0;color:var(--paa-text)}
.paa-workbench[data-kind=expedition] .paa-wb-left>.paa-wb-context-controls{gap:12px;padding:0 0 8px;border:0;background:none}
.paa-workbench[data-kind=expedition] .paa-picker-title{flex:0 0 max-content;min-width:3.5em;color:var(--paa-text);font-size:14px;font-weight:600;line-height:22px;white-space:nowrap}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-area-picker{gap:10px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-area-trigger{height:40px;min-height:40px;gap:8px;padding:7px 32px 7px 16px;border-radius:6px;background:var(--paa-card);color:var(--paa-text)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-area-trigger[aria-expanded=true]{border-radius:6px 6px 0 0}
.paa-area-picker[data-kind=expedition] .paa-mission-selected-state{flex:none}
.paa-exp-goal-field{display:flex;align-items:center;gap:10px;min-width:0}
.paa-exp-goal{box-sizing:border-box;height:40px;min-height:40px;display:flex;align-items:center;flex:1;min-width:0;gap:8px;padding:3px 3px 3px 16px;border:1px solid var(--paa-line);border-radius:6px;background:var(--paa-card)}
.paa-exp-goal-options{--paa-goal-great-bg:#e8ca8980;--paa-goal-great-fg:#77521b;position:relative;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));flex:1;min-width:0;gap:3px}
.paa-exp-goal-options::before{content:'';position:absolute;z-index:0;top:0;bottom:0;left:0;width:calc(50% - 1.5px);border-radius:3px;background:var(--paa-soft);opacity:0;pointer-events:none;transition:transform 200ms ease,background-color 200ms ease,opacity 120ms ease}
.paa-exp-goal-options:is([data-goal=great],[data-goal=success])::before{opacity:1}
.paa-exp-goal-options[data-goal=great]::before{background:var(--paa-goal-great-bg);transform:translateX(calc(100% + 3px))}
:is(.bp6-dark,.bp5-dark,.bp4-dark,.bp3-dark,[data-theme=dark]) .paa-exp-goal-options{--paa-goal-great-bg:#b58c4d55;--paa-goal-great-fg:#f0ce88}
.paa .paa-exp-goal button{position:relative;z-index:1;min-width:0;min-height:30px;padding:3px 4px;border:0;border-radius:3px;box-shadow:none;background:transparent;color:var(--paa-muted);white-space:normal}
.paa .paa-exp-goal button[aria-pressed=true]{background:transparent;color:var(--paa-text);font-weight:500}
.paa .paa-exp-goal button[data-goal=great][aria-pressed=true]{color:var(--paa-goal-great-fg)}
.paa .paa-exp-goal button:hover:not(:disabled):not([aria-pressed=true]){background:var(--paa-soft);color:var(--paa-text)}
.paa .paa-exp-goal button[data-goal=great]:hover:not(:disabled):not([aria-pressed=true]){background:color-mix(in srgb,var(--paa-goal-great-bg) 50%,transparent);color:var(--paa-goal-great-fg)}
@media(prefers-reduced-motion:reduce){.paa-exp-goal-options::before{transition:none}}
.paa-exp-condition-groups,.paa-exp-condition-group{display:inline-flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 8px}.paa-exp-condition-part{white-space:nowrap}.paa-exp-condition-or{color:var(--paa-muted);font-weight:400}
.paa-workbench[data-kind=expedition] .paa-wb-left [data-result-region=expedition]>.paa-wb-calculation-content{display:flex;flex-direction:column;gap:12px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(.paa-exp-time,.paa-exp-outcome,.paa-exp-income,.paa-exp-unlock){padding:14px 16px;border:1px solid var(--paa-line);border-radius:10px;background:var(--paa-card);color:var(--paa-text)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-section-head{min-height:24px;margin-bottom:9px;gap:8px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-time .paa-exp-section-head{margin:0;padding-right:16px}
.paa-workbench[data-kind=expedition] .paa-wb-left :is(.paa-exp-duration,.paa-exp-ready,.paa-exp-income-row>strong,.paa-exp-item-condition,.paa-exp-item-condition>strong){font-size:18px;line-height:24px;font-variant-numeric:tabular-nums}
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
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-table{margin-top:7px;font-size:14px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row{grid-template-columns:minmax(0,1fr) minmax(78px,1fr);min-height:38px;padding:6px 0;gap:8px;border:0;border-top:1px solid color-mix(in srgb,var(--paa-line) 32%,transparent)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-table[data-columns="3"] .paa-exp-income-row{grid-template-columns:minmax(0,1.15fr) repeat(2,minmax(90px,1fr));column-gap:8px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-heading{min-height:25px;padding:0 0 5px;border:0;font-size:14px;color:var(--paa-muted)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-heading>[role=columnheader]:not(:first-child){display:flex;align-items:center;justify-content:flex-end;gap:5px;white-space:nowrap}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-outcome-probability{display:inline-block;padding:0 3px;border:1px solid color-mix(in srgb,var(--paa-accent) 65%,transparent);border-radius:2px;background:transparent;color:var(--paa-accent);font-size:12px;line-height:16px;font-weight:400;font-variant-numeric:tabular-nums}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-outcome-probability[data-known=false]{border-color:transparent;color:var(--paa-muted)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row>strong{color:var(--paa-text);display:flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:0 3px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-item-condition>strong{display:inline-flex;flex-wrap:wrap;align-items:baseline;justify-content:flex-end;gap:0 3px;white-space:normal}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income .paa-exp-value-unit{font-size:12px;line-height:16px;font-weight:400;color:var(--paa-muted);white-space:nowrap}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row>strong[data-negative=true]{color:var(--paa-bad)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row>strong[data-zero=true]{color:var(--paa-muted);font-weight:400}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-row>strong[data-missing=true]{color:var(--paa-muted);font-weight:400}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-table[data-great-available=false] .paa-exp-resource-great{color:var(--paa-muted)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-heading .paa-exp-great-heading{color:#efc778}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-great-heading .paa-exp-outcome-probability[data-known=true]{color:#efc778;border-color:#b58c4d}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-table:not([data-great-available=false]) .paa-exp-income-row>strong.paa-exp-resource-great:not([data-negative=true]):not([data-zero=true]):not([data-missing=true]){color:#efc778}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-item-condition[data-great=true][data-available=true]{color:#efc778}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-resource{gap:6px;min-width:0;overflow-wrap:anywhere}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-resource .paa-resource-icon{flex:none;width:20px!important;height:20px!important}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-details{margin-top:10px!important;padding-top:9px;border-top:1px solid var(--paa-line)}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-income-details>summary{padding:0;font-size:13px;line-height:20px;font-weight:600}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-unlock-details>summary{font-size:13px;line-height:20px;font-weight:600}
.paa-exp-chain{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.paa-exp-chain-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:8px;align-items:baseline;min-width:0}
.paa-exp-chain-label{color:var(--paa-muted);font-size:12px;line-height:22px}
.paa-exp-chain-items{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 6px;min-width:0}
.paa .paa-workbench[data-kind=expedition] .paa-exp-chain-item{display:inline-flex;align-items:baseline;gap:4px;min-height:0;padding:1px 7px;border:1px solid var(--paa-line);border-radius:5px;background:transparent;color:var(--paa-text);font-size:13px;line-height:20px;white-space:nowrap}
.paa .paa-workbench[data-kind=expedition] .paa-exp-chain-item:hover:not(:disabled){border-color:var(--paa-accent);color:var(--paa-accent)}
.paa .paa-workbench[data-kind=expedition] .paa-exp-chain-item>span{font-size:11px;color:var(--paa-muted)}
.paa .paa-workbench[data-kind=expedition] .paa-exp-chain-item[data-completed=true]>span{color:var(--paa-good)}
.paa-exp-chain-plus,.paa-exp-chain-condition{color:var(--paa-muted);font-size:12px;line-height:20px;overflow-wrap:anywhere}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-condition{min-height:32px;padding-block:6px}
.paa-workbench[data-kind=expedition] .paa-wb-left .paa-exp-detail-groups{display:grid;gap:8px;margin-top:8px;max-height:300px;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}
.paa-exp-formula-group{min-width:0;padding-bottom:7px;border-bottom:1px solid color-mix(in srgb,var(--paa-line) 32%,transparent)}
.paa-exp-formula-group:last-child{padding-bottom:0;border-bottom:0}
.paa-exp-formula-resource{display:flex;align-items:center;color:var(--paa-text);font-size:13px;line-height:20px}
.paa-exp-formula-resource .paa-resource-icon{width:16px!important;height:16px!important}
.paa-exp-formula-row{display:flex;align-items:baseline;gap:8px;margin-top:3px;font-size:12px;line-height:19px;font-variant-numeric:tabular-nums}
.paa-exp-formula-outcome{flex:none;width:38px;color:var(--paa-muted)}
.paa-exp-formula-row[data-outcome=great] .paa-exp-formula-outcome{color:#efc778}
.paa-exp-formula-expression{display:flex;flex-wrap:wrap;gap:0 5px;min-width:0;color:var(--paa-muted)}
.paa-exp-formula-term,.paa-exp-formula-expression>strong{white-space:nowrap}
.paa-exp-formula-expression>strong{color:var(--paa-text);font-weight:600}
.paa-exp-formula-row[data-outcome=great] .paa-exp-formula-expression>strong:not([data-negative=true]):not([data-missing=true]){color:#efc778}
.paa-exp-formula-expression [data-negative=true]{color:var(--paa-bad)}
.paa-exp-formula-expression>strong[data-missing=true]{color:var(--paa-muted)}
@container(max-width:780px){
 .paa-workbench[data-kind=expedition] .paa-wb-left [data-result-region=expedition]{border:0;background:none;padding:0}
 .paa-workbench[data-kind=expedition] .paa-wb-left>.paa-wb-context-controls{padding:0 0 8px;border:0;border-radius:0;background:none}
}
`;
