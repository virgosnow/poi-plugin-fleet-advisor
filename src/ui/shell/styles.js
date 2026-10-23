'use strict';
module.exports=`
/* poi's detached portal clips overflow; keep scrolling inside our own panel. */
#plugin-mountpoint>.poi-app-tabpane>.paa{height:100%;min-height:0;overflow-y:auto;scrollbar-gutter:stable;--paa-scroll-thumb:color-mix(in srgb,var(--paa-muted) 32%,transparent)}
#plugin-mountpoint>.poi-app-tabpane>.paa::-webkit-scrollbar{width:8px;height:8px;background:transparent}
#plugin-mountpoint>.poi-app-tabpane>.paa::-webkit-scrollbar-track{background:transparent}
#plugin-mountpoint>.poi-app-tabpane>.paa::-webkit-scrollbar-thumb{border:2px solid transparent;border-radius:8px;background:var(--paa-scroll-thumb);background-clip:padding-box;min-height:32px}
#plugin-mountpoint>.poi-app-tabpane>.paa[data-scrolling=true]{--paa-scroll-thumb:color-mix(in srgb,var(--paa-muted) 72%,transparent)}
#plugin-mountpoint>.poi-app-tabpane>.paa::-webkit-scrollbar-thumb:hover{background-color:color-mix(in srgb,var(--paa-muted) 82%,transparent)}
#plugin-mountpoint>.poi-app-tabpane>.paa::-webkit-scrollbar-thumb:active{background-color:var(--paa-muted)}
#plugin-mountpoint>.poi-app-tabpane>.paa::-webkit-scrollbar-button{display:none}
.paa{--paa-bg:#f5f7fa;--paa-card:#fff;--paa-line:#dbe2eb;--paa-text:#25334a;--paa-muted:#64748b;--paa-accent:#2563eb;--paa-soft:#edf3ff;--paa-good:#087a59;--paa-bad:#b42336;color:var(--paa-text);background:var(--paa-bg);font:13px/1.5 system-ui,sans-serif;padding:16px;box-sizing:border-box;container-type:inline-size;min-width:0}
.bp6-dark .paa,.bp5-dark .paa,.bp4-dark .paa,.bp3-dark .paa,[data-theme="dark"] .paa{--paa-bg:#18212e;--paa-card:#222e3e;--paa-line:#3b4a60;--paa-text:#e6edf7;--paa-muted:#acbad0;--paa-accent:#8bb5ff;--paa-soft:#2b3d58;--paa-good:#80d8b4;--paa-bad:#ffabb6}
.paa *{box-sizing:border-box}.paa h2,.paa h3,.paa p{margin:0}.paa h2{font-size:18px;letter-spacing:.02em}.paa h3{font-size:14px}.paa .paa-muted{color:var(--paa-muted);font-size:12px}
.paa-tabs{display:flex;padding:4px;background:var(--paa-card);border:1px solid var(--paa-line);border-radius:10px;margin-bottom:14px;gap:4px}.paa-tabs button{flex:1;border-color:transparent;background:transparent;font-weight:600}.paa-tabs button[aria-pressed="true"]{background:var(--paa-soft);color:var(--paa-accent)}
.paa button,.paa select{font:inherit;color:var(--paa-text);background:var(--paa-card);border:1px solid var(--paa-line);border-radius:7px;padding:6px 10px;min-height:32px}.paa button{cursor:pointer}.paa button:hover:not(:disabled){border-color:var(--paa-accent);color:var(--paa-accent)}.paa button:disabled,.paa select:disabled{opacity:.45;cursor:default}.paa :is(button,select,textarea,summary):focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px}.paa-card{background:var(--paa-card);border:1px solid var(--paa-line);border-radius:10px;min-width:0;overflow:hidden}.paa textarea{display:block;resize:vertical;min-height:220px;max-height:520px;width:100%;background:var(--paa-bg);color:var(--paa-text);border:1px solid var(--paa-line);border-radius:7px;padding:12px;font:12px/1.6 ui-monospace,Consolas,monospace;tab-size:2}.paa textarea[aria-invalid="true"]{border-color:var(--paa-bad)}.paa-error{color:var(--paa-bad);overflow-wrap:anywhere}.paa button.paa-primary{background:#2563eb;color:white;border-color:#2563eb;font-weight:600;padding-inline:18px}.paa button.paa-primary:hover:not(:disabled){background:#1d4ed8;color:white}.paa details{margin-top:10px}.paa summary{cursor:pointer;color:var(--paa-muted);font-size:12px;padding:4px 0}.paa pre{background:var(--paa-bg);border:1px solid var(--paa-line);padding:10px;border-radius:6px;font:11px/1.6 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:6px 0}
@container(max-width:660px){.paa textarea{min-height:170px}}
.paa-switch{display:inline-flex;align-items:center;gap:8px;padding:0;border:none;background:none;min-height:auto;cursor:pointer}.paa-switch:disabled{opacity:.45;cursor:default}.paa-switch-track{width:38px;height:22px;flex:none;border-radius:11px;background:var(--paa-line);position:relative;transition:background .18s ease}.paa-switch-knob{position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px #0005;transition:left .18s ease}.paa-switch[aria-checked="true"] .paa-switch-track{background:var(--paa-good)}.paa-switch[aria-checked="true"] .paa-switch-knob{left:18px}.paa-switch:hover:not(:disabled) .paa-switch-track{border-color:transparent;background:var(--paa-muted)}.paa-switch[aria-checked="true"]:hover:not(:disabled) .paa-switch-track{background:var(--paa-good)}.paa-switch-label{color:var(--paa-text);font-weight:600}.paa-switch:hover:not(:disabled){color:inherit}
.paa input{font:inherit;color:var(--paa-text);background:var(--paa-card);border:1px solid var(--paa-line);border-radius:7px;padding:6px 10px;min-height:32px;min-width:0}.paa input::placeholder{color:var(--paa-muted)}.paa :is(input):focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px}.paa-result{border:1px solid var(--paa-line);border-radius:9px;padding:11px;background:var(--paa-bg);display:flex;flex-direction:column;gap:9px}.paa-result.selected{border-color:var(--paa-accent);box-shadow:0 0 0 1px var(--paa-accent)}.paa-result-warning{color:var(--paa-bad);font-size:11px}.paa-result button{align-self:flex-start}
.paa details>summary{cursor:pointer;font-weight:600;color:var(--paa-muted);padding:7px 0;list-style-position:inside}.paa details[open]>summary{color:var(--paa-text)}.paa details>p{margin:7px 0}.paa-result{background:var(--paa-card);padding:14px;gap:12px}
.paa-route-preview{border:1px solid var(--paa-line);border-radius:9px;overflow:hidden;background:var(--paa-bg)}.paa-route-toolbar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:8px 10px;font-size:12px}.paa-route-toolbar>span{font-weight:600;flex:none}.paa-route-toolbar small{color:var(--paa-muted);font-size:10px}.paa-route-toolbar select{font-size:11px;max-width:70%;min-width:0;min-height:27px;padding:3px 5px}.paa-map-scroll{overflow:auto;max-height:285px}.paa-map-scroll svg{display:block;min-width:100%;max-width:none;max-height:none}.paa-map-edge path{fill:none;stroke:var(--paa-line);stroke-width:1.5;stroke-dasharray:3 4}.paa-map-edge.active path{stroke:var(--paa-accent);stroke-width:3;stroke-dasharray:none}.paa-map-edge path.paa-map-arrow{stroke-dasharray:none}.paa-map-node{cursor:pointer}.paa-map-node circle{fill:var(--paa-card);stroke:var(--paa-line);stroke-width:1.5}.paa-map-node text{fill:var(--paa-muted);font-size:12px;font-weight:600;pointer-events:none}.paa-map-node.active circle{stroke:var(--paa-accent);fill:var(--paa-soft)}.paa-map-node.active text{fill:var(--paa-accent)}.paa-map-node.target circle{stroke:var(--paa-bad)}.paa-map-node.target text{fill:var(--paa-bad)}.paa-map-node.focused circle{stroke-width:3}.paa-map-node:focus-visible{outline:none}.paa-map-node:focus-visible circle{stroke-width:4;stroke:var(--paa-good)}.paa-map-node text.paa-map-kind{font-size:10px;font-weight:400;fill:var(--paa-muted)}.paa-map-caption{padding:5px 10px;display:flex;gap:6px;flex-wrap:wrap;justify-content:space-between;font-size:10px;color:var(--paa-muted)}.paa-node-detail{display:flex;flex-direction:column;gap:3px;font-size:11px;padding:9px 10px;border-top:1px solid var(--paa-line);background:var(--paa-card)}.paa-node-detail .paa-muted{font-size:11px}.paa-map-empty{padding:18px;text-align:center;background:var(--paa-bg);border-radius:8px;color:var(--paa-muted)}
.paa-fleet-heading{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:12px}.paa-fleet-ship{border-radius:7px;overflow:hidden;border:1px solid var(--paa-line);background:var(--paa-bg);min-width:0}.paa-fleet-ship>div:last-child{padding:6px 7px;display:flex;flex-direction:column;gap:1px}.paa-fleet-ship strong{font-size:11px;overflow-wrap:anywhere;line-height:1.35}
@container(max-width:440px){.paa-result{padding:10px}}
.paa [hidden]{display:none!important}
.paa-map-scroll svg{min-width:0}.paa-map-scroll>svg{min-width:100%}.paa-map-real-scroll{max-height:480px}.paa-map-scroll>svg.paa-map-real{width:100%;height:auto;min-width:0;max-width:100%}.paa-map-scroll>svg.paa-map-real.zoomed{width:1200px;min-width:1200px;max-width:none}.paa-map-real .paa-map-node circle{fill:#132b3ed9;stroke:#eaf6ff;stroke-width:2}.paa-map-real .paa-map-node text{fill:#fff;font-size:22px;paint-order:stroke;stroke:#122b40;stroke-width:3px;stroke-linejoin:round}.paa-map-real .paa-map-node text.paa-map-kind{font-size:18px;fill:#fff}.paa-map-real .paa-map-node.active circle{stroke:#20e6ff;stroke-width:3;fill:#075264ee}.paa-map-real .paa-map-node.focused circle{stroke-width:5}.paa-map-real .paa-map-node.target circle{stroke:#ff647c;fill:#651d37ee;stroke-width:4}.paa-map-real .paa-map-edge.approximate path{stroke:#14e3ff;stroke-width:5;stroke-dasharray:9 5;filter:drop-shadow(0 0 2px #00384a)}.paa-route-toolbar{flex-wrap:wrap}.paa-route-toolbar>small{margin-left:auto}.paa-route-toolbar button{font-size:10px;min-height:26px;padding:3px 7px}.paa-map-scroll svg svg{min-width:0;display:initial}.paa-equipment-icon{position:relative;display:inline-flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;border:1px solid var(--paa-line);border-radius:4px;background:var(--paa-soft);color:var(--paa-muted);font-size:9px}.paa-equipment-icon img{position:absolute;inset:2px;width:18px;height:18px;object-fit:contain;background:var(--paa-soft)}.paa-equipment-icon.is-expansion{border-style:dashed}.paa-equipment-icon small{position:absolute;right:-2px;bottom:-3px;background:var(--paa-bg);font-size:8px;line-height:10px;border-radius:2px;padding:0 1px}.paa-equipment-icon:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px}
.paa-map-node circle.paa-map-node-body,.paa-map-real .paa-map-node circle.paa-map-node-body{fill:var(--paa-node-background);stroke:var(--paa-node-color);stroke-width:2}.paa-map-real .paa-map-node circle.paa-map-node-body{stroke-width:3}.paa-map-node.active circle.paa-map-route-ring,.paa-map-real .paa-map-node.active circle.paa-map-route-ring{fill:none;stroke:#20e6ff;stroke-width:2;pointer-events:none}.paa-map-real .paa-map-node.active circle.paa-map-route-ring{stroke-width:3}.paa-map-node.target circle.paa-map-target-ring,.paa-map-real .paa-map-node.target circle.paa-map-target-ring{fill:none;stroke:#ff647c;stroke-width:2;pointer-events:none}.paa-map-node .paa-map-type-badge{color:var(--paa-node-color);pointer-events:none}.paa-map-node .paa-map-type-badge circle,.paa-map-real .paa-map-node .paa-map-type-badge circle{fill:var(--paa-node-background);stroke:var(--paa-node-color);stroke-width:1.2}.paa-map-node.focused circle.paa-map-node-body{stroke-width:3}.paa-map-real .paa-map-node.focused circle.paa-map-node-body{stroke-width:4}.paa-map-node:focus-visible circle.paa-map-node-body{stroke:#fff;stroke-width:4}.paa-map-node text:not(.paa-map-kind),.paa-map-real .paa-map-node text:not(.paa-map-kind){fill:#fff}.paa-map-legend{display:flex;flex-wrap:wrap;align-items:center;gap:5px 12px;padding:7px 10px;border-top:1px solid var(--paa-line);font-size:10px;color:var(--paa-muted)}.paa-map-legend>span{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.paa-map-legend svg{width:16px;height:16px;color:var(--paa-node-color);flex:none}
.paa-map-pannable{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;overscroll-behavior:contain}.paa-map-pannable image{-webkit-user-drag:none}.paa-map-pannable.is-panning,.paa-map-pannable.is-panning *{cursor:grabbing!important}
.paa-map-node.inactive{opacity:.58}.paa-map-node.inactive text:not(.paa-map-kind),.paa-map-real .paa-map-node.inactive text:not(.paa-map-kind){fill:#aab6c5}.paa-map-node .paa-map-boss-icon{pointer-events:none}.paa-map-node.inactive circle.paa-map-target-ring{stroke:#8593a5}
.paa-map-node.active[data-boss] text.paa-map-node-label{fill:#ff7f90}
.paa-map-edge:not(.active){opacity:.3}
.paa-tooltip{margin:0;inset:auto;overflow:auto;position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;background:var(--paa-card,#222e3e);color:var(--paa-text,#e6edf7);border:1px solid var(--paa-line,#3b4a60);border-radius:6px;padding:8px 10px;box-shadow:0 4px 18px #0004;font:12px/1.5 system-ui,sans-serif;white-space:pre-line;overflow-wrap:anywhere}
.paa-tooltip-aa-grid{display:grid;grid-template-columns:max-content minmax(6ch,max-content) minmax(0,1fr);column-gap:10px;margin-top:4px;white-space:normal;align-items:baseline}
.paa-tooltip-section+.paa-tooltip-section{border-top:1px solid var(--paa-line,#3b4a60);margin-top:7px;padding-top:7px}
.paa-tooltip-attack-group{white-space:normal;min-width:0}.paa-tooltip-attack-group+.paa-tooltip-attack-group{margin-top:8px}
.paa-tooltip-attack-title{font-weight:400;margin-bottom:3px;overflow-wrap:anywhere}
.paa-tooltip-attack-values{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:1px 10px;align-items:baseline}
.paa-tooltip-attack-label{opacity:.75;white-space:nowrap}.paa-tooltip-attack-value{font-weight:400;font-variant-numeric:tabular-nums;text-align:right;min-width:0;overflow-wrap:anywhere}
.paa-tooltip-attack-notes{opacity:.75;margin-top:3px;white-space:pre-line}
.paa-tooltip-attack-table{width:100%;table-layout:auto;border-collapse:collapse;white-space:normal;font:inherit;color:inherit}
.paa-tooltip-attack-table th,.paa-tooltip-attack-table td{padding:0;vertical-align:top;font:inherit;color:inherit;text-align:left;overflow-wrap:anywhere}
.paa-tooltip-attack-table th:first-child{width:55%;white-space:normal}.paa-tooltip-attack-table-two th:first-child{width:44%}
.paa-tooltip-attack-table thead th{padding-bottom:5px}
.paa-tooltip-attack-table .paa-tooltip-attack-number{padding-left:18px;text-align:right}
.paa-tooltip-attack-single th:first-child{width:auto}.paa-tooltip-attack-single .paa-tooltip-attack-number{padding-left:0;text-align:left}
.paa-tooltip-attack-indexed th:first-child{width:2em;white-space:nowrap}.paa-tooltip-attack-indexed .paa-tooltip-attack-index{white-space:nowrap;font-variant-numeric:tabular-nums;text-align:center}
.paa-tooltip-attack-indexed .paa-tooltip-attack-name{padding-left:8px;white-space:normal}
.paa-tooltip-attack-indexed .paa-tooltip-attack-number{padding-left:clamp(8px,4%,18px)}
.paa-tooltip-attack-short{white-space:nowrap}
.paa-tooltip-attack-table tbody tr+tr>*{padding-top:7px}
.paa-tooltip-attack-table .paa-tooltip-attack-note-row>td{padding-top:3px}
.paa-tooltip-attack-reference{display:block;font-size:11px;opacity:.75}
.paa-tooltip-aa-type{white-space:nowrap}.paa-tooltip-aa-rate{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}.paa-tooltip-aa-effect{min-width:0}.paa-tooltip-aa-head{opacity:.75}
@keyframes paa-pulse{50%{opacity:.35}}
`;

module.exports+=require('../workbench/workbench_styles');

// Settings share one spacing scale and form grid; keep overrides out of workbench styles.
module.exports+=`
.paa-settings-page{--paa-setting-gap:12px;--paa-setting-subgap:8px;--paa-setting-indent:12px;--paa-setting-label:168px;--paa-setting-field:160px;display:flex;flex-direction:column;gap:var(--paa-setting-gap);font-size:14px;line-height:22px}
.paa-settings-tools{display:flex;align-items:center;flex:none;width:36px;max-width:calc(6em + 82px);height:36px;overflow:hidden;border:1px solid transparent;border-radius:7px;font-size:13px;transform-origin:right center;transition:width .2s cubic-bezier(.2,.7,.2,1),border-color .2s,background-color .2s}
.paa-settings-tools[data-expanded=true]{width:calc(6em + 82px);overflow:visible;border-color:var(--paa-line);background:var(--paa-soft);animation:paa-settings-expand .2s cubic-bezier(.2,.7,.2,1)}
.paa-tabs .paa-settings-tools button{font-size:inherit;font-weight:500}
.paa-tabs .paa-settings-tools>.paa-settings-toggle{flex:0 0 34px;width:34px;height:34px;min-height:34px;padding:5px;border:0}
.paa-tabs .paa-settings-tools[data-expanded=true]>.paa-settings-toggle{display:flex;align-items:center;gap:6px;flex:none;width:auto;padding-inline:8px;white-space:nowrap;background:none}
.paa-settings-reset-actions{position:relative;display:flex;align-items:center;flex:none}
.paa-tabs .paa-settings-reset{display:flex;align-items:center;gap:6px;flex:none;height:34px;min-height:34px;padding:5px 8px;border:0;border-radius:0 6px 6px 0;white-space:nowrap;color:var(--paa-muted)}
.paa-settings-reset-actions>.paa-setting-feedback{position:absolute;top:-3px;right:-3px;width:14px;height:14px;line-height:14px;border-radius:50%;background:var(--paa-card)}
.paa-settings-reset-actions>.paa-setting-feedback:not([data-state]){display:none}
@keyframes paa-settings-expand{from{transform:scale(.96);overflow:hidden}99%{overflow:hidden}to{transform:scale(1);overflow:visible}}
@container(max-width:500px){.paa-settings-tools{font-size:12px;max-width:calc(6em + 54px)}.paa-settings-tools[data-expanded=true]{width:calc(6em + 54px)}.paa-tabs .paa-settings-tools[data-expanded=true]>.paa-settings-toggle{gap:4px;padding-inline:2px}.paa-tabs .paa-settings-reset{gap:4px;padding-inline:2px}.paa-masthead .paa-tabs:has(.paa-settings-tools[data-expanded=true]){gap:2px}.paa-masthead .paa-tabs:has(.paa-settings-tools[data-expanded=true])>button:not(.paa-home-toggle){padding-inline:2px}}
@media(prefers-reduced-motion:reduce){.paa-settings-tools,.paa-settings-tools[data-expanded=true]{transition:none;animation:none}}
.paa-settings-card{padding:14px 16px;background:var(--paa-card);border:1px solid var(--paa-line);border-radius:10px;min-width:0}
.paa-settings-page .paa-settings-card h3{font-size:16px;line-height:22px;font-weight:600;letter-spacing:0;margin:0;color:var(--paa-text)}
.paa-settings-page .paa-muted{font-size:12px;line-height:18px;margin:0}
.paa-settings-section-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px;margin-bottom:9px}
.paa-settings-page :is(input[type=number],select,button){height:34px;min-height:34px;margin:0;font-size:14px;line-height:20px;border-radius:6px;padding:6px 10px}
.paa-settings-page input[type=number]{font-variant-numeric:tabular-nums}.paa-settings-page input[type=number]:disabled{opacity:.45}
.paa-settings-page button{font-size:12px;white-space:nowrap;font-weight:500}
.paa-settings-page .paa-settings-section-head button:not(.paa-switch){background:transparent;border-color:transparent;color:var(--paa-muted)}
.paa-settings-page .paa-settings-section-head button:not(.paa-switch):hover:not(:disabled){color:var(--paa-accent);background:var(--paa-soft)}
.paa-settings-label{display:inline-flex;align-items:center;gap:6px;min-width:0}.paa-settings-label>label{margin:0;white-space:nowrap}
.paa-settings-page button.paa-settings-help{display:inline-flex;align-items:center;justify-content:center;flex:0 0 14px;width:14px;height:14px;min-height:14px;margin:0;padding:0;box-sizing:border-box;border:1px solid var(--paa-muted);border-radius:50%;background:transparent;color:var(--paa-muted);font-size:11px;line-height:12px;font-weight:500;box-shadow:none;cursor:help}
.paa-settings-page .paa-settings-section-head button.paa-settings-help{border-color:var(--paa-muted)}
.paa-settings-page button.paa-settings-help:hover,.paa-settings-page button.paa-settings-help:focus-visible{color:var(--paa-accent);border-color:var(--paa-accent);background:var(--paa-soft)}
.paa-selection-options>.paa-settings-label{white-space:nowrap}
.paa-settings-row,.paa-selection-count{display:grid;grid-template-columns:var(--paa-setting-label) minmax(0,1fr);align-items:center;gap:12px;margin:0;min-height:34px}
.paa-settings-page :is(.paa-settings-row>.paa-settings-label,.paa-selection-count>.paa-settings-label,.paa-selection-caption,.paa-selection-option,.paa-selection-level,.paa-selection-level label,.paa-agent-label){color:var(--paa-muted);font-weight:400}
.paa-settings-value,.paa-agent-control{display:flex;align-items:center;gap:8px;min-width:0}
.paa-settings-page .paa-selection-count input[type=number]{width:80px}.paa-selection-count{margin-bottom:var(--paa-setting-gap)}
.paa-settings-page .paa-settings-goal{height:34px;box-sizing:border-box;flex:0 1 220px}
.paa-settings-page .paa-settings-goal button{height:26px;min-height:26px;padding:2px 4px;font-size:14px;line-height:20px}
.paa-settings-page .paa-resource-control select,.paa-settings-page .paa-agent-control input{width:var(--paa-setting-field);max-width:100%;min-width:0}
.paa-settings-page .paa-resource-control+.paa-resource-control{margin-top:var(--paa-setting-gap)}
.paa-selection-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--paa-setting-gap,16px)}.paa-computation-settings{display:flex;flex-direction:column;gap:var(--paa-setting-gap,16px)}
.paa-selection-exclusions{align-items:start}.paa-selection-caption{padding-top:6px;font-size:14px;line-height:22px}
.paa-selection-options{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,160px),1fr));align-items:center;gap:var(--paa-setting-subgap) 16px}
.paa-selection-option,.paa-selection-level,.paa-selection-level label{display:flex;align-items:center;gap:8px;margin:0;min-height:34px;font-size:14px;line-height:22px}
.paa-selection-options :is(.paa-selection-option,.paa-selection-level,.paa-selection-level label){gap:6px}
.paa-selection-option{cursor:pointer}.paa-selection-options>.paa-selection-option,.paa-selection-options>.paa-selection-level{white-space:nowrap}
.paa-settings-page .paa-selection-level input[type=number]{width:64px;padding-inline:6px}
.paa-cache-card{--paa-cache-usage-width:188px;--paa-cache-actions-width:98px}
.paa-cache-list{display:flex;flex-direction:column;gap:var(--paa-setting-gap)}
.paa-cache-row{display:grid;grid-template-columns:minmax(0,1fr) var(--paa-cache-usage-width) var(--paa-cache-actions-width);align-items:center;gap:12px;box-sizing:border-box;min-height:34px}
.paa-cache-row .paa-selection-option{min-height:22px}
.paa-cache-usage{font-size:12px;line-height:18px;color:var(--paa-muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.paa-cache-capacity-controls{min-width:0}
.paa-cache-usage-cell{display:flex;align-items:center;gap:8px;min-width:0;min-height:34px}
.paa-cache-usage-cell>.paa-cache-usage{flex:1;text-align:right}
.paa-cache-row>.paa-cache-usage{text-align:right;padding-right:22px}
.paa-settings-page .paa-cache-actions button{width:76px;flex:none}
.paa-agent-connection{display:flex;flex-direction:column;gap:var(--paa-setting-subgap)}
.paa-experimental-mcp{margin-top:var(--paa-setting-gap);min-width:0}
.paa-experimental-mcp .paa-agent-connection{margin-top:var(--paa-setting-subgap);margin-inline-start:var(--paa-setting-indent)}
@container(max-width:600px){.paa-experimental-mcp .paa-agent-connection>.paa-settings-row{grid-template-columns:minmax(0,1fr);gap:4px}}
.paa-agent-label{font-size:14px;line-height:22px;margin:0}
.paa-agent-address{display:flex;align-items:center;gap:8px;min-width:0}
.paa-agent-address code{display:flex;align-items:center;min-height:34px;min-width:0;max-width:100%;padding:6px 10px;background:var(--paa-bg);border:1px solid var(--paa-line);border-radius:6px;font-size:12px;line-height:20px;overflow-wrap:anywhere;user-select:all;color:var(--paa-text)}
.paa-agent-connection-error{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.paa-agent-control input{flex:0 1 var(--paa-setting-field)}
.paa-agent-connection :is(.paa-agent-control,.paa-agent-address){display:grid;grid-template-columns:minmax(0,260px) 76px 14px;gap:8px;align-items:center}
.paa-settings-page .paa-agent-connection :is(input,code){width:100%;box-sizing:border-box}
.paa-settings-page .paa-switch{display:inline-flex;align-items:center;gap:8px;padding:0 2px;border:none;background:none}.paa-settings-page .paa-switch-label{font-size:12px;font-weight:500}
.paa .paa-selection-settings input[type=checkbox]{appearance:none;-webkit-appearance:none;box-sizing:border-box;display:inline-block;position:relative;width:16px;height:16px;min-width:16px;min-height:16px;padding:0;margin:0;vertical-align:middle;border:1px solid var(--paa-muted);border-radius:3px;background:var(--paa-card);box-shadow:none;transform:none;cursor:pointer}
.paa .paa-selection-settings input[type=checkbox]::before,.paa .paa-selection-settings input[type=checkbox]::after{content:none}
.paa .paa-selection-settings input[type=checkbox]:checked{border-color:var(--paa-accent);background-color:var(--paa-accent);background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3.5 8 3 3 6-6' fill='none' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-size:16px 16px;background-position:center;background-repeat:no-repeat}
.paa .paa-selection-settings input[type=checkbox]:focus-visible{outline:2px solid var(--paa-accent);outline-offset:3px}.paa .paa-selection-settings input[type=checkbox]:disabled{opacity:.45;cursor:default}

.paa-setting-feedback{display:inline-flex;align-items:center;justify-content:center;position:relative;flex:0 0 14px;width:14px;height:20px;color:var(--paa-good);font-size:12px;line-height:20px;cursor:help}
.paa-setting-feedback:not([data-state]){cursor:default}.paa-setting-feedback[data-state=error]{color:var(--paa-bad);font-weight:700}.paa-setting-feedback[data-state=pending]{color:var(--paa-muted)}.paa-setting-feedback:focus-visible{outline:2px solid var(--paa-accent);outline-offset:2px}

.paa-settings-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
@container(min-width:860px){.paa-selection-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.paa-selection-grid .paa-selection-exclusions{grid-template-columns:minmax(0,1fr);gap:8px}.paa-selection-grid .paa-selection-caption{padding:0}.paa-selection-grid .paa-selection-options{margin-inline-start:var(--paa-setting-indent)}}
@container(max-width:700px){
 .paa-cache-row{grid-template-columns:minmax(0,1fr) var(--paa-cache-actions-width);gap:4px 12px}
 .paa-cache-row>.paa-cache-usage{grid-column:1;grid-row:2;padding-left:24px;white-space:normal;overflow-wrap:anywhere}
 .paa-cache-row>.paa-cache-actions{grid-column:2;grid-row:1/span 2}
 .paa-cache-capacity-controls{grid-column:1/-1}.paa-cache-usage-cell{grid-column:1;grid-row:2}
 .paa-cache-capacity>.paa-cache-actions{grid-row:2}
}
@container(max-width:600px){
 .paa-settings-page{--paa-setting-indent:8px;--paa-setting-field:144px}.paa-selection-exclusions{grid-template-columns:minmax(0,1fr);gap:8px}.paa-selection-caption{padding:0}.paa-selection-grid .paa-selection-options{margin-inline-start:var(--paa-setting-indent)}
 .paa-agent-endpoint{grid-template-columns:minmax(0,1fr);gap:8px}.paa-agent-address code{flex:1}
}
@container(max-width:380px){
 .paa-settings-row,.paa-selection-count{grid-template-columns:minmax(0,1fr);gap:8px}
 .paa-agent-control{flex-wrap:wrap}
}
`;

module.exports+=require('../fleet/current_fleet_styles');
module.exports+=require('../expedition/expedition_styles');
module.exports+=require('../components/quest_section_styles');

// Keep disclosure feedback consistent across pages and poi's host styles.
module.exports+=`
.paa summary,.paa button[aria-expanded]:not(:disabled),.paa select:not(:disabled){cursor:pointer}
.paa summary *,.paa summary::before,.paa summary::after,.paa summary::marker,.paa button[aria-expanded] *,.paa button[aria-expanded]::before,.paa button[aria-expanded]::after{cursor:inherit}
.paa button[aria-expanded]:disabled{cursor:default}
.paa .paa-area-picker .paa-area-trigger:hover:not(:disabled){color:var(--paa-text)}
`;
