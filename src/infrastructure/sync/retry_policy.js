'use strict';

// One initial request followed by at most ten retries, scoped to a session.
const MAX_RETRIES=10;
const RETRY_DELAYS=[2,4,8,16,30,45,60,90,120,180].map(seconds=>seconds*1000);
function retryDelay(failures){return RETRY_DELAYS[Math.min(RETRY_DELAYS.length-1,Math.max(0,failures-1))];}
function exhausted(failures){return failures>MAX_RETRIES;}
module.exports={MAX_RETRIES,retryDelay,exhausted};
