// изолированный synthetic fixture; не импортируется production страницами.
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const clientPath = path.join(root, 'test/fixtures/dashboard-write/client.js');
function clientSource() { return fs.readFileSync(clientPath, 'utf8'); }
function seed() {
  const Goals = require('../goals-core.js'), Tasks = require('../dashboard-tasks-core.js');
  const date = Tasks.dateKey(new Date()), goal = {id:'11111111-1111-4111-8111-111111111111',title:'Синтетическая цель · подготовить маршрут',horizon:'month',periodKey:Goals.currentPeriodKey('month'),priority:'p2',type:'number',current:2,target:10,unit:'шагов',done:false,order:0,createdAt:new Date().toISOString()};
  const tasks = [{id:'22222222-2222-4222-8222-222222222222',text:'Синтетическая задача · проверить синхронизацию',min:25,diff:'medium',sphere:'none',done:false,description:'Только тестовые данные. Ни одна реальная запись не читается.',subtasks:[]}];
  return new Map([['horizons_goals_v2',JSON.stringify(Goals.normalizeData({goals:[goal]},new Date()))],['goals:'+date,JSON.stringify(tasks)]]
    .map(([key,valueText])=>[key,{key,exists:true,valueText,revision:'1',updatedAt:new Date().toISOString()}]));
}
function createFixture(options={}) {
  if(options.host && options.host!=='127.0.0.1') throw Error('loopback only');
  const spaces=options.spaces||new Map([['fixture-user-a',seed()],['fixture-user-b',new Map()]]);
  const missing=key=>({key,exists:false,valueText:null,revision:'0',updatedAt:null});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('cache-control','no-store');
    res.setHeader('content-security-policy',"default-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; frame-src 'none'");
    const url=new URL(req.url,'http://127.0.0.1');
    function json(status,value){res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));}
    try {
      if(url.pathname==='/__fixture/mobile'){
        res.setHeader('content-security-policy',"default-src 'self'; frame-src 'self'; style-src 'unsafe-inline'; object-src 'none'; connect-src 'self'");
        res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
        res.end('<html lang="ru"><title>synthetic mobile · 390 × 844</title><body style="margin:0;background:#101114;color:#fafafa;font:16px system-ui;display:grid;justify-content:center"><p>синтетический mobile viewport · 390 × 844</p><iframe title="мобильная версия дашборда" src="/goals.html" width="390" height="844" style="border:1px solid #777"></iframe></body></html>');return;
      }
      if(url.pathname==='/__fixture/client.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(clientSource());return;}
      if(url.pathname.startsWith('/__fixture/')) {
        if(req.method!=='POST')return json(405,{});
        let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>65536)return json(413,{});}
        const input=JSON.parse(body), owner=input.owner||'fixture-user-a';
        if(!spaces.has(owner))return json(400,{});
        const docs=spaces.get(owner), args=input.args||{};
        if(url.pathname==='/__fixture/remote'){
          const key=input.key||'horizons_goals_v2', old=docs.get(key);if(!old)return json(400,{});
          const value=JSON.parse(old.valueText);if(Array.isArray(value))value[0].text='Сервер: задача обновлена в другом клиенте';
          else value.goals[0].title='Сервер: цель обновлена в другом клиенте';
          if(!Array.isArray(value))value.goals[0].description='Полная серверная версия '+ 'подробность '.repeat(180);
          docs.set(key,{...old,valueText:JSON.stringify(value),revision:String(BigInt(old.revision)+1n),updatedAt:new Date().toISOString()});
          return json(200,{ok:true});
        }
        if(url.pathname!=='/__fixture/rpc')return json(404,{});
        if(args.p_expected_owner!==owner)return json(403,{error:{code:'owner_changed'}});
        if(input.name==='dashboard_sync_capabilities')return json(200,{data:{protocol:2,guardEnabled:true,writeEnabled:false},error:null});
        if(input.name==='dashboard_read_user_data')return json(200,{data:[...docs.values()].filter(r=>!args.p_after_key||r.key>args.p_after_key).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,args.p_limit),error:null});
        if(input.name==='dashboard_save_documents'){
          if(!Array.isArray(args.p_changes)||args.p_changes.length>64||args.p_changes.some(c=>!(/^goals:\d{4}-\d{2}-\d{2}$/.test(c.key)||c.key==='horizons_goals_v2')))return json(400,{});
          const current=args.p_changes.map(c=>docs.get(c.key)||missing(c.key));
          if(current.some((r,i)=>r.revision!==args.p_changes[i].expectedRevision))return json(200,{data:{ok:false,error:{code:'conflict',status:409},current},error:null});
          const rows=args.p_changes.map((c,i)=>({key:c.key,exists:true,valueText:c.valueText,revision:String(BigInt(current[i].revision)+1n),updatedAt:new Date().toISOString()}));
          rows.forEach(r=>docs.set(r.key,r));return json(200,{data:{ok:true,data:rows},error:null});
        }
        return json(400,{});
      }
      const name=url.pathname==='/'?'goals.html':url.pathname.slice(1);
      // serve only root public assets, never repository/config/test files.
      if(!/^[a-zA-Z0-9_-]+\.(html|js|css|svg|png|webmanifest)$/.test(name))return json(404,{});
      const file=path.join(root,name);if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(404,{});
      let content=fs.readFileSync(file);
      if(name.endsWith('.html'))content=content.toString().replace('<head>','<head><script src="/__fixture/client.js"></script>').replace('</body>', '<details id="fixtureControls" style="position:fixed;z-index:10100;right:12px;top:90px;max-width:230px;background:#222;color:white;padding:10px;border:1px solid #777;font:14px system-ui"><summary>synthetic controls</summary><p>только синтетические данные</p><button id="fixtureLocal">локальная правка</button> <button id="fixtureRemote">серверная правка</button> <button id="fixturePull">загрузить сервер</button> <button id="fixtureOffline">offline / online</button> <button id="fixtureOwner">сменить аккаунт</button></details><script>window.DashboardFixture.mount();</script></body>');
      const types={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',css:'text/css',svg:'image/svg+xml',png:'image/png',webmanifest:'application/manifest+json'};
      res.writeHead(200,{'content-type':types[name.split('.').pop()]});res.end(content);
    }catch(_){json(400,{error:'invalid_fixture_request'});}
  });
  return {server,spaces,listen(port){return new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);});},origin(){return 'http://127.0.0.1:'+server.address().port;},close(){return new Promise(r=>server.close(r));}};
}
module.exports={createFixture,clientSource};
if(require.main===module){const first=createFixture(),second=createFixture({spaces:first.spaces});Promise.all([first.listen(8867),second.listen(8868)]).then(()=>console.log(first.origin()+' / '+second.origin()+' · только synthetic данные'));}
