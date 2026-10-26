const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../profile.html'),'utf8');
function load(){const nodes={},map=new Map([['_sync_cas_v2:u1','pending'],['horizons_goals_v2','local'],['sb-auth','session']]);let cleared=0,signedOut=0;
 const ctx={document:{getElementById(id){return nodes[id]||= {addEventListener(t,f){this[t]=f;},classList:{remove(){}}};}},confirm:()=>true,alert(){},console:{log(){},error(){}},setTimeout(){},localStorage:{get length(){return map.size;},key:i=>[...map.keys()][i],getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),clear(){cleared++;map.clear();}},window:{SupabaseSync:{isSignedIn:()=>true,clearCloudData:()=>Promise.resolve({error:{code:'protected_reset',message:'blocked'}})},supabase:{auth:{signOut(){signedOut++;return Promise.resolve();}}},location:{reload(){throw Error('reload запрещён при отказе');}}},FileReader:class{readAsText(file){this.onload({target:{result:file.text}});}}};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  var APP_STORAGE_KEYS'),source.indexOf("  document.getElementById('exportBtn')")),ctx);
 return {ctx,nodes,map,counts:()=>({cleared,signedOut})};
}
test('реальный reset handler сохраняет local/pending/auth при отказе облака',async()=>{
 const h=load();vm.runInContext(source.slice(source.indexOf('  // --- Reset ---'),source.indexOf('  // --- Data transfer:')),h.ctx);
 await h.nodes.resetBtn.click.call(h.nodes.resetBtn);await new Promise(r=>setImmediate(r));
 assert.deepEqual(h.counts(),{cleared:0,signedOut:0});assert.equal(h.map.get('_sync_cas_v2:u1'),'pending');assert.equal(h.map.get('horizons_goals_v2'),'local');
});
test('реальный import handler не подменяет metadata/auth и сохраняет app values',()=>{
 const h=load();h.ctx.showTransferStatus=()=>{};
 vm.runInContext(source.slice(source.indexOf("  document.getElementById('importFile').addEventListener"),source.indexOf('  function renderAll()')),h.ctx);
 h.nodes.importFile.change({target:{files:[{text:JSON.stringify({'horizons_goals_v2':'imported','_sync_cas_v2:u1':'forged','sb-auth':'stolen','revision':'99','goals:revision':'99'})}],value:'file'}});
 assert.equal(h.map.get('_sync_cas_v2:u1'),'pending');assert.equal(h.map.get('sb-auth'),'session');assert.equal(h.map.get('horizons_goals_v2'),'imported');assert.equal(h.map.has('revision'),false);assert.equal(h.map.has('goals:revision'),false);
});
