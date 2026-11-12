'use strict';
const {t}=require('../../shared/i18n');
require('../shared_catalog');
require('../i18n/readability');

const PERIODS={
  once:['once','单次'],single:['once','单次'],oneTime:['once','单次'],'one-time':['once','单次'],'单次':['once','单次'],
  daily:['daily','日常'],'日常':['daily','日常'],weekly:['weekly','周常'],'周常':['weekly','周常'],
  monthly:['monthly','月常'],'月常':['monthly','月常'],quarterly:['quarterly','季常'],'季常':['quarterly','季常'],
  yearly:['yearly','年常'],annual:['yearly','年常'],'年常':['yearly','年常'],limited:['limited','限时'],'限时':['limited','限时']
};
const STATES={1:['available','可受领'],2:['active','进行中'],3:['complete','已达成']};

module.exports=React=>{
  const h=React.createElement;
  return {
    period(value,number){
      if(!value)return null;
      const [key,label]=PERIODS[value]||['unknown',String(value)];
      return h('span',{className:'paa-quest-period','data-period':key,...number?{'data-tooltip':t('quest.number',{number}),tabIndex:0}:{}},t(label));
    },
    status(value){
      const state=STATES[Number(value)];if(!state)return null;
      return h('span',{className:'paa-quest-state','data-status':state[0]},t(state[1]));
    }
  };
};
