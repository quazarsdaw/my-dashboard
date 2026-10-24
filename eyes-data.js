(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.EyesData=factory();})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  var CATALOG=Object.freeze([
    ['horizontal','Влево и вправо','motion',8,'Следите за точкой из стороны в сторону.'],
    ['vertical','Вверх и вниз','motion',8,'Следите за точкой вверх и вниз.'],
    ['diagonal-left','Диагональ слева','motion',8,'Переводите взгляд по диагонали ↘ и обратно.'],
    ['diagonal-right','Диагональ справа','motion',8,'Переводите взгляд по диагонали ↙ и обратно.'],
    ['circle','Круг','motion',8,'Следите за точкой: сначала по часовой стрелке, затем обратно.'],
    ['figure-eight','Восьмёрка','motion',8,'Плавно следите за точкой по траектории ∞.'],
    ['jumps','Прыжки взгляда','motion',8,'Найдите новую точку и переведите на неё взгляд.'],
    ['near-far','Близко и далеко','rest',12,'Чередуйте взгляд на палец перед собой и удалённый предмет.'],
    ['distance','Взгляд вдаль','rest',20,'Посмотрите на предмет примерно в 6 метрах или дальше.'],
    ['blinking','Моргание','rest',8,'Спокойно закрывайте и открывайте глаза, без усилия.'],
    ['rest','Отдых с закрытыми глазами','rest',8,'Закройте глаза. Можно прикрыть их ладонями, без давления.']
  ].map(function(a){return Object.freeze({id:a[0],title:a[1],kind:a[2],minSeconds:a[3],instruction:a[4]});}));
  var IDS=CATALOG.map(function(x){return x.id;});
  function pick(v,options,fallback){return options.indexOf(v)>=0?v:fallback;}
  function normalizeSettings(raw,env){
    var s=raw&&typeof raw==='object'?raw:{};env=env||{};
    var ids=Array.isArray(s.exerciseIds)?IDS.filter(function(id){return s.exerciseIds.indexOf(id)>=0;}):['horizontal','vertical','blinking'];
    return {version:1,mode:pick(s.mode,['short','full','custom','single'],'short'),durationSeconds:pick(s.durationSeconds,[30,60,120,180],60),exerciseIds:ids,
      speed:pick(s.speed,['slow','normal','fast'],env.reducedMotion?'slow':'normal'),dotSize:pick(s.dotSize,['small','medium','large'],'medium'),dotColor:pick(s.dotColor,['amber','mint','white','pink'],'amber'),
      showPath:s.showPath!==false,soundEnabled:s.soundEnabled!==false,vibrationEnabled:s.vibrationEnabled===true,fullscreenEnabled:s.fullscreenEnabled===true,reminderEnabled:s.reminderEnabled===true};
  }
  return {CATALOG:CATALOG,IDS:IDS,normalizeSettings:normalizeSettings};
});
