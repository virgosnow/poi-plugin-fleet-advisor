'use strict';
const path=require('path'),{pathToFileURL}=require('url');
const source=require('../../../data/sortie/maps/map_common.source.json');

// Locations are display coordinates, matched against the original game icon
// in the 1200×720 charts. They are not used to infer operational radius.
// 6-4 has no physical base icon on the game chart; don't guess a location.
const positions=Object.freeze({
  '6-5':Object.freeze({x:210,y:274}),
  '7-4':Object.freeze({x:1043,y:406})
});
const airbaseSymbol=Object.freeze({
  image:pathToFileURL(path.join(__dirname,'../../../data/sortie/maps',source.airbaseMarker.image)).href,
  frame:{x:0,y:0,w:source.airbaseMarker.width,h:source.airbaseMarker.height},
  width:source.airbaseMarker.width,height:source.airbaseMarker.height
});
module.exports={positions,airbaseSymbol};
