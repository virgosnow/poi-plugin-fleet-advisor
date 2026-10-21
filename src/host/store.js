'use strict';
// poi can refresh game-selector tables through fcd. Tests/older poi use the
// bundled snapshot; API master data and inventory always come from live store.
function readStore(window) {
  const state=window.getStore();
  try {return {...state,selectorTables:require('views/utils/game-selector/tables').getSelectorTables()};}
  catch(error) {if(error.code!=='MODULE_NOT_FOUND')throw error;return state;}
}
module.exports={readStore};
