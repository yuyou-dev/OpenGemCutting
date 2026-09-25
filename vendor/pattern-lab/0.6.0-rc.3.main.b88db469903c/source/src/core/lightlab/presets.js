import { observationDefaults } from './observation.js';

export const LIGHT_PRESETS=[{id:'studio',label:'柔光摄影棚',en:'STUDIO',note:'柔光与黑卡，观察刻面结构。'},{id:'jewelry',label:'珠宝点光',en:'FIRE',note:'小角径高亮光源，观察分光与闪烁。'},{id:'diffuse',label:'均匀半球',en:'ISO',note:'均匀上半球，适合比较窗口。'},{id:'darkfield',label:'暗场环光',en:'RING',note:'环形照明，观察棱边和色散。'},{id:'daylight',label:'窗边日光',en:'DAYLIGHT',note:'大角径窗光与弱环境光。'},{id:'backlight',label:'背光实验',en:'LEAKAGE',note:'下半球入光，检查透明区域。'}];
export const OBSERVATION_PRESETS=[{id:'hearts',label:'八心八箭观察镜',note:'冠部看箭、亭部看心；轴对称红白参考环境。'},{id:'aset',label:'ASET 角域参考',note:'绿 / 红 / 蓝三角域与白背光；非评级。'},{id:'idealscope',label:'红白漏光观察',note:'Ideal-Scope 类参考：红色回光、黑色对比、白色背光。'},{id:'fire',label:'点光火彩',note:'单小角白点光，配合倾斜摆动观察火彩与闪烁。'}];
export function createLight(overrides={}){return {id:'light-'+Math.random().toString(36).slice(2,10),name:'矩形柔光',shape:'rect',azimuth:225,elevation:45,width:35,height:60,roll:0,ev:2,temperature:6500,tint:'#ffffff',softness:.08,innerRatio:.64,enabled:true,blocker:false,...overrides};}
export function environmentPreset(id){
  let ambient=.32,lower=.035,lights=[];
  if(id==='studio')lights=[createLight({id:'key',name:'主光 · 大柔光箱',azimuth:220,elevation:48,width:34,height:60,ev:2.6}),createLight({id:'fill',name:'补光 · 窄条柔光',azimuth:30,elevation:32,width:12,height:58,ev:2.1,temperature:7200}),createLight({id:'rim',name:'轮廓 · 顶光',shape:'disc',azimuth:105,elevation:73,width:23,height:23,ev:1.8,temperature:5800}),createLight({id:'card',name:'黑卡 · 刻面对比',azimuth:315,elevation:32,width:36,height:65,ev:0,blocker:true,softness:.04})];
  if(id==='jewelry'){ambient=.035;lower=.005;lights=Array.from({length:9},(_,i)=>createLight({id:`spot-${i}`,name:`珠宝点光 ${String(i+1).padStart(2,'0')}`,shape:'disc',azimuth:i*137.508%360,elevation:20+(i*19%65),width:3.5+(i%3)*1.8,height:5,ev:4+(i%3)*.6,temperature:i%2?4800:6500,softness:.035}));}
  if(id==='diffuse'){ambient=1;lower=0;}
  if(id==='darkfield'){ambient=.01;lower=.005;lights=[createLight({id:'ring',name:'环形暗场照明',shape:'ring',azimuth:0,elevation:90,width:112,height:112,ev:3.6,softness:.04})];}
  if(id==='daylight'){ambient=.46;lower=.09;lights=[createLight({id:'window',name:'北向窗 · 面光',azimuth:250,elevation:45,width:72,height:95,ev:1.8,temperature:7200,softness:.15}),createLight({id:'reflector',name:'白色反光板',azimuth:45,elevation:12,width:48,height:48,ev:-.4,temperature:5200})];}
  if(id==='backlight'){ambient=.03;lower=.15;lights=[createLight({id:'back',name:'下半球透射光',shape:'disc',azimuth:0,elevation:-80,width:95,height:95,ev:2.5})];}
  if(id==='fire'){ambient=.005;lower=0;lights=[createLight({id:'fire-spot',name:'火彩 · 小角白点光',shape:'disc',azimuth:35,elevation:65,width:2,height:2,ev:6,softness:.02})];}
  const kind=['hearts','aset','idealscope'].includes(id)?id:'none';
  if(kind!=='none'){ambient=0;lower=0;lights=[];}
  const projectName=[...LIGHT_PRESETS,...OBSERVATION_PRESETS].find(p=>p.id===id)?.label??'未命名布光';
  return {preset:id,projectId:id,projectName,ambient,lower,rotation:0,lights,solo:null,observation:observationDefaults(kind)};
}
