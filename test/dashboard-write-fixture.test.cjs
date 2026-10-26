const {test}=require('node:test'), assert=require('node:assert/strict'), vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
test('fixture сервер только loopback, production html не меняется, сеть запрещена csp',async()=>{
 const {createFixture}=require('../scripts/serve-dashboard-write-fixture.cjs');
 assert.throws(()=>createFixture({host:'0.0.0.0'}),/loopback/);
 const fixture=createFixture(); await fixture.listen(0);const origin=fixture.origin();
 try {
  const response=await fetch(origin+'/goals.html');const html=await response.text();
  assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
  assert.ok(html.indexOf('/__fixture/client.js')<html.indexOf('supabase-sync.js'));
  assert.ok(!fs.readFileSync(path.join(__dirname,'../goals.html'),'utf8').includes('/__fixture/'));
  const client=await (await fetch(origin+'/__fixture/client.js')).text();assert.ok(!client.includes('yiuiiixovxmoqifsdsuf'));
  assert.equal((await fetch(origin+'/../../.git/config')).status,404);
  assert.equal((await fetch(origin+'/supabase/tests/test_document_versions.py')).status,404);
  const rpc=await fetch(origin+'/__fixture/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'arbitrary_sql',args:{p_expected_owner:'fixture-user-a'}})});
  assert.equal(rpc.status,400);
 } finally {await fixture.close();}
});
test('fixture sdk и fetch не обращаются к настоящему supabase даже при попытке загрузки',()=>{
 const {clientSource}=require('../scripts/serve-dashboard-write-fixture.cjs');let appended=0,loaded=0;const requests=[];
 const ctx={URL, location:{origin:'http://127.0.0.1:8888'},document:{head:{appendChild(){appended++;}}},queueMicrotask:fn=>fn(),fetch:async u=>{requests.push(u);return {json:async()=>({data:null,error:null})};},localStorage:{getItem(){return '1';},setItem(){}},window:{addEventListener(){},dispatchEvent(){}},CustomEvent:function(){},console};
 vm.runInNewContext(clientSource(),ctx);
 ctx.document.head.appendChild({src:'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2',onload(){loaded++;}});
 assert.equal(appended,0);assert.equal(loaded,1);
 assert.throws(()=>ctx.fetch('https://example.com'),/external_network_forbidden/);
});
