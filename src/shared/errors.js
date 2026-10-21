'use strict';
const error=(code,message)=>Object.assign(new Error(message),{code});
module.exports={error};
