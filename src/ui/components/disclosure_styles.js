'use strict';
module.exports=`
/* Native summaries keep their keyboard and toggle behavior. */
@supports (interpolate-size:allow-keywords){
 .paa details::details-content{interpolate-size:allow-keywords;block-size:0;overflow:clip;transition:block-size .26s cubic-bezier(.2,.65,.3,1),content-visibility .26s allow-discrete}
 .paa details[open]::details-content{block-size:auto}
}
.paa .paa-collapse{display:grid;grid-template-rows:0fr;min-height:0;visibility:hidden;transition:grid-template-rows .26s cubic-bezier(.2,.65,.3,1),margin-top .26s cubic-bezier(.2,.65,.3,1),visibility 0s .26s}
.paa .paa-collapse[data-open=true]{grid-template-rows:1fr;visibility:visible;transition-delay:0s}
.paa .paa-collapse-clip{min-height:0;overflow:hidden}
.paa-current-presets>.paa-collapse,.paa-fleet-ship-state>.paa-collapse{margin-top:-6px}
.paa-current-presets>.paa-collapse[data-open=true],.paa-fleet-ship-state>.paa-collapse[data-open=true]{margin-top:0}
.paa .paa-fleet-chevron{transition:transform .26s cubic-bezier(.2,.65,.3,1)}
@media(prefers-reduced-motion:reduce){
 .paa details::details-content,.paa .paa-collapse,.paa .paa-fleet-chevron{transition:none}
}
`;
