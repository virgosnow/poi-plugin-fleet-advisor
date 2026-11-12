'use strict';
// Primary section titles share one scale; nested task titles and detail labels stay smaller.
module.exports=`
.paa .paa-workbench .paa-wb-left :is(.paa-wb-arrival>span,.paa-wb-threat .paa-balance-title,.paa-practice-training-title,.paa-practice-block h3,.paa-exp-section-head h4,.paa-exp-requirements>summary,.paa-quest-disclosure>summary,.paa-fleet-section-heading h3),
.paa .paa-workbench.paa-current-status .paa-fleet-heading h3{font-size:14px;font-weight:600;line-height:22px}
`;
