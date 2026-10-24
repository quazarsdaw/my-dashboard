(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./eyes-data.js'));else root.EyesCore=factory(root.EyesData);})(typeof window==='object'?window:globalThis,function(D){
  'use strict';
  function buildPlan(o){
    o=o||{};var n=o.durationSeconds,ids;
    function fail(error,min){return {ok:false,error:error,requiredSeconds:min||0,stages:[]};}
    if([30,60,120,180].indexOf(n)<0)return fail('INVALID_DURATION');
    if(o.mode==='short')ids=n===30?['horizontal','vertical','blinking']:['horizontal','vertical','circle','distance','blinking'];
    else if(o.mode==='full'){if(n<120)return fail('DURATION_TOO_SHORT',120);ids=D.IDS.slice();}
    else if(o.mode==='single'||o.mode==='custom'){
      if(!Array.isArray(o.exerciseIds)||!o.exerciseIds.length||new Set(o.exerciseIds).size!==o.exerciseIds.length||o.exerciseIds.some(function(x){return D.IDS.indexOf(x)<0;}))return fail('INVALID_SELECTION');
      ids=D.IDS.filter(function(x){return o.exerciseIds.indexOf(x)>=0;});
      if(o.mode==='single'&&ids.length!==1)return fail('INVALID_SELECTION');
    }else return fail('INVALID_MODE');
    var stages=ids.map(function(id){return {exerciseId:id,durationSeconds:D.CATALOG.find(function(x){return x.id===id;}).minSeconds};});
    var min=stages.reduce(function(v,s){return v+s.durationSeconds;},0);
    if(n<min)return fail('DURATION_TOO_SHORT',min);
    var rest=n-min,each=Math.floor(rest/stages.length),tail=rest%stages.length;
    stages.forEach(function(s,i){s.durationSeconds+=each+(i<tail?1:0);});
    return {ok:true,mode:o.mode,durationSeconds:n,requiredSeconds:min,stages:stages};
  }
  var jumps=[[.16,.24],[.84,.76],[.2,.8],[.8,.2],[.5,.5],[.12,.5],[.88,.5],[.5,.14],[.5,.86]];
  function positionAt(o){
    var t=Math.max(0,Number(o.elapsedMs)||0),period=({slow:12000,normal:8000,fast:5000})[o.speed]||8000,a=2*Math.PI*t/period,s=Math.sin(a)*.42;
    switch(o.exerciseId){
      case 'horizontal':return {x:.5+s,y:.5};
      case 'vertical':return {x:.5,y:.5+s};
      case 'diagonal-left':return {x:.5+s,y:.5+s};
      case 'diagonal-right':return {x:.5+s,y:.5-s};
      case 'circle':var h=Math.max(0,Number(o.stageDurationMs)||0)/2;if(t>h)a=2*Math.PI*(2*h-t)/period;return {x:.5+.42*Math.cos(a),y:.5+.42*Math.sin(a)};
      case 'figure-eight':return {x:.5+.42*Math.sin(a),y:.5+.32*Math.sin(2*a)};
      case 'jumps':var p=jumps[Math.floor(t/(({slow:1800,normal:1200,fast:800})[o.speed]||1200))%jumps.length];return {x:p[0],y:p[1]};
      default:return {x:.5,y:.5};
    }
  }
  function instructionAt(o){
    var t=Math.max(0,o.elapsedMs||0),id=o.exerciseId,step=0,text;
    var item=D.CATALOG.find(function(x){return x.id===id;});text=item?item.instruction:'';
    if(id==='near-far'){step=Math.floor(t/6000);text=step%2?'Теперь посмотрите на удалённый предмет.':'Посмотрите на свой палец перед собой.';}
    if(id==='blinking'){step=Math.floor(t/2000);text=step%2?'Откройте глаза. Моргните спокойно.':'Мягко закройте глаза. Не сжимайте веки.';}
    return {text:text,cueId:id+':'+step};
  }
  return {buildPlan:buildPlan,positionAt:positionAt,instructionAt:instructionAt};
});
