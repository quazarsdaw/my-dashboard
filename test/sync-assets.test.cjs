const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=path.join(__dirname,'..');
test('all_pages_load_core_before_sync с одной cache version',()=>{
 const pages=fs.readdirSync(root).filter(f=>f.endsWith('.html')&&fs.readFileSync(path.join(root,f),'utf8').includes('supabase-sync.js'));
 assert.equal(pages.length,13);
 for(const page of pages){const s=fs.readFileSync(path.join(root,page),'utf8');
  for(const asset of ['dashboard-sync-core.js','dashboard-sync-conflicts.js','dashboard-sync-conflicts.css']) assert.ok(s.includes(asset+'?v=409-cas'),page+': '+asset);
  assert.ok(s.indexOf('dashboard-sync-core.js')<s.indexOf('supabase-sync.js'),page);
  assert.ok(s.indexOf('dashboard-sync-conflicts.js')<s.indexOf('supabase-sync.js'),page);
  assert.ok(s.includes('supabase-sync.js?v=409-cas'),page);
 }
});
test('import_cannot_supply_sync_metadata_or_revision',()=>{
 const source=fs.readFileSync(path.join(root,'profile.html'),'utf8');
 const part=source.slice(source.indexOf('  var APP_STORAGE_KEYS'),source.indexOf("  document.getElementById('exportBtn')"));
 const ctx={}; vm.createContext(ctx);vm.runInContext(part,ctx);
 for(const key of ['_sync_cas_v2:u1','revision','write_base_revision','access_token','refresh_token','sb-secret','dashboard_writer_token','_sync_cas_display_owner_v2']) assert.equal(ctx.isAppStorageKey(key),false,key);
 assert.equal(ctx.isAppStorageKey('goals:2026-10-27'),true);
 assert.equal(ctx.isAppStorageKey('goals:revision'),false);
});
test('reset отказ не предлагает очистить локальные данные и не очищает весь storage',()=>{
 const s=fs.readFileSync(path.join(root,'profile.html'),'utf8');
 const part=s.slice(s.indexOf('  // --- Reset ---'),s.indexOf('  // --- Data transfer:'));
 assert.ok(!part.includes('localStorage.clear()'));
 assert.ok(!part.includes('локальные данные всё равно'));
 assert.ok(part.includes('throw new Error'));
});
