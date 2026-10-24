const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../eyes-data.js');
const C = require('../eyes-core.js');

test('короткая программа точно укладывается в бюджет и не теряет минимумы', () => {
  assert.equal(D.CATALOG.length, 11);
  for (const seconds of [30, 60, 120, 180]) {
    const p = C.buildPlan({mode:'short', durationSeconds:seconds});
    assert.equal(p.ok, true);
    assert.equal(p.stages.reduce((n,s)=>n+s.durationSeconds,0),seconds);
    for (const s of p.stages) assert.ok(s.durationSeconds>=D.CATALOG.find(x=>x.id===s.exerciseId).minSeconds);
  }
  assert.deepEqual(C.buildPlan({mode:'short',durationSeconds:30}).stages.map(x=>x.exerciseId),['horizontal','vertical','blinking']);
});
test('полный комплекс не сжимается молча, а собственный проверяет выбор', () => {
  assert.equal(C.buildPlan({mode:'full',durationSeconds:60}).error,'DURATION_TOO_SHORT');
  assert.equal(C.buildPlan({mode:'full',durationSeconds:120}).stages.length,11);
  for (const exerciseIds of [[],['bad'],['horizontal','horizontal']]) assert.equal(C.buildPlan({mode:'custom',durationSeconds:30,exerciseIds}).ok,false);
  assert.equal(C.buildPlan({mode:'single',durationSeconds:60,exerciseIds:['circle']}).stages[0].durationSeconds,60);
  assert.equal(C.buildPlan({mode:'short',durationSeconds:300}).ok,false);
});
test('настройки не принимают произвольные стили и не переписывают явный темп', () => {
  assert.equal(D.normalizeSettings(null,{reducedMotion:true}).speed,'slow');
  const s=D.normalizeSettings({speed:'fast',durationSeconds:300,dotColor:'url(evil)',exerciseIds:['rest','bad']},{reducedMotion:true});
  assert.equal(s.speed,'fast'); assert.equal(s.durationSeconds,60); assert.equal(s.dotColor,'amber'); assert.deepEqual(s.exerciseIds,['rest']);
});
test('плавные траектории ограничены и непрерывны, скачки имеют фиксированную паузу', () => {
  for (const exerciseId of ['horizontal','vertical','diagonal-left','diagonal-right','circle','figure-eight','jumps']) {
    for (const speed of ['slow','normal','fast']) for(let elapsedMs=0;elapsedMs<=30000;elapsedMs+=97){
      const p=C.positionAt({exerciseId,speed,elapsedMs,stageDurationMs:30000});
      assert.ok(p.x>=.08-1e-9&&p.x<=.92+1e-9&&p.y>=.08-1e-9&&p.y<=.92+1e-9);
      if(exerciseId!=='jumps'){
        const q=C.positionAt({exerciseId,speed,elapsedMs:elapsedMs+1,stageDurationMs:30000});
        assert.ok(Math.hypot(q.x-p.x,q.y-p.y)<.01);
      }
    }
  }
  const at=elapsedMs=>C.positionAt({exerciseId:'jumps',speed:'normal',elapsedMs,stageDurationMs:30000});
  assert.deepEqual(at(0),at(1199)); assert.notDeepEqual(at(1199),at(1200));
  const c=t=>C.positionAt({exerciseId:'circle',speed:'fast',elapsedMs:t,stageDurationMs:30000});
  assert.ok(Math.hypot(c(15001).x-c(14999).x,c(15001).y-c(14999).y)<.01);
});
test('инструкции для отдыха дают стабильные звуковые этапы вместо оценки взгляда', () => {
  assert.equal(C.instructionAt({exerciseId:'near-far',elapsedMs:0}).cueId,C.instructionAt({exerciseId:'near-far',elapsedMs:1}).cueId);
  assert.notEqual(C.instructionAt({exerciseId:'near-far',elapsedMs:0}).cueId,C.instructionAt({exerciseId:'near-far',elapsedMs:6000}).cueId);
  assert.match(C.instructionAt({exerciseId:'rest',elapsedMs:0}).text,/давите|давления/);
});
