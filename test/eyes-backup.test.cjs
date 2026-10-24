const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('backup разрешает только пользовательские eye-ключи с валидным id',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../profile.html'),'utf8');
 const code=source.slice(source.indexOf('  var APP_STORAGE_KEYS'),source.indexOf("  document.getElementById('exportBtn')"));
 const ctx={};vm.createContext(ctx);vm.runInContext(code+';this.allowed=isAppStorageKey;',ctx);
 for(const key of ['eye_break_settings_v1','eye_break_stats_epoch_v1','eye_break_session_v1:11111111-1111-4111-8111-111111111111'])assert.equal(ctx.allowed(key),true,key);
 for(const key of ['eye_break_session_v1:bad','_eye_break_active_v1','_habit_reward_tx_v1','sb-secret','eye_break_session_v1:<img>'])assert.equal(ctx.allowed(key),false,key);
});
