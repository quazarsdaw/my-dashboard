const test=require('node:test'),assert=require('node:assert/strict'),R=require('../eyes-reminder-core.js');
test('напоминание сохраняет срок при навигации и не дублируется в интервале',()=>{
 let s=R.reduce(null,{type:'enable',nowMs:0}).state;
 assert.equal(s.dueAt,1200000);s=R.reduce(s,{type:'open',nowMs:600000,fresh:false}).state;assert.equal(s.dueAt,1200000);
 let r=R.reduce(s,{type:'tick',nowMs:1200000,visible:true});assert.equal(r.effects[0].type,'show');
 assert.equal(R.reduce(r.state,{type:'tick',nowMs:1200001,visible:true}).effects.length,0);
 assert.equal(R.reduce(s,{type:'tick',nowMs:99999999,visible:false}).effects.length,0);
});
test('отложить, отключить и повторное открытие дают предсказуемые сроки',()=>{
 let s=R.reduce(null,{type:'enable',nowMs:0}).state;s=R.reduce(s,{type:'later',nowMs:2000000}).state;assert.equal(s.dueAt,2300000);
 s=R.reduce(s,{type:'completeExercise',nowMs:2000000}).state;assert.equal(s.dueAt,3200000);
 assert.equal(R.reduce(s,{type:'open',fresh:true,nowMs:4000000}).state.dueAt,5200000);
 assert.equal(R.reduce(R.reduce(s,{type:'disable',nowMs:0}).state,{type:'tick',nowMs:9999999,visible:true}).effects.length,0);
});
test('двадцать секунд перерыва считают активное монотонное время, а не фон',()=>{
 let s=R.reduce(null,{type:'startDistance',nowMs:0,monoMs:0,id:'x'}).state;
 s=R.reduce(s,{type:'distanceTick',monoMs:5000,nowMs:5000,visible:true}).state;
 s=R.reduce(s,{type:'pauseDistance',monoMs:5000,nowMs:5000}).state;
 s=R.reduce(s,{type:'distanceTick',monoMs:60000,nowMs:60000,visible:false}).state;assert.equal(s.distanceSession.elapsedMs,5000);
 s=R.reduce(s,{type:'resumeDistance',monoMs:60000,nowMs:60000}).state;
 const r=R.reduce(s,{type:'distanceTick',monoMs:75000,nowMs:75000,visible:true});assert.equal(r.effects[0].type,'completeDistance');assert.equal(r.state.distanceSession,null);
});
