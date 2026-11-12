'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const i18n=require('../../src/shared/i18n');
require('../../src/ui/i18n/workbench_catalog');
require('../../src/ui/maps/map_localization');
const {compactHint}=require('../../src/ui/i18n/metric_display');

test('sortie metric hints translate without changing nodes or numeric thresholds',()=>{
  const cases=[
    ['C/E/G 点 · 高速+以上','C/E/G マス · 高速+以上','C/E/G 點 · 高速+以上'],
    ['所选流派 · 高速+统一','選択編成 · 高速+統一','所選流派 · 高速+統一'],
    ['敌方全程无制空','全マス敵制空値 0','敵方全程無制空'],
    ['K 点 · 空优 41 · 空确 81','K マス · 優勢 41 · 確保 81','K 點 · 空優 41 · 空確 81'],
    ['K 点 · 空优 41–45 · 空确 81–90（参考）','K マス · 優勢 41–45 · 確保 81–90（参考）','K 點 · 空優 41–45 · 空確 81–90（參考）'],
    ['所选路线无索敌门槛','選択ルートに索敵条件なし','所選路線無索敵門檻'],
    ['G→H · 门槛 ≥ 29 · 系数 4','G→H · 閾値 ≥ 29 · 係数 4','G→H · 門檻 ≥ 29 · 係數 4'],
    ['G 点 · 门槛待确认','G マス · 閾値未確認','G 點 · 門檻待確認']
  ];
  try{for(const [source,ja,tw] of cases){
    i18n.setLocale('zh-CN');assert.equal(compactHint(source),source);
    i18n.setLocale('ja-JP');assert.equal(compactHint(source),ja);
    i18n.setLocale('zh-TW');assert.equal(compactHint(source),tw);
  }}finally{i18n.setLocale('zh-CN');}
});
