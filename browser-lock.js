(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.BrowserLock=factory();})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 function create(o){o=o||{};var now=o.now||Date.now,uuid=o.uuid||function(){return crypto.randomUUID();},dbPromise;
  function database(){if(!o.indexedDB)return Promise.reject(new Error('COORDINATION_UNAVAILABLE'));if(!dbPromise)dbPromise=new Promise(function(resolve,reject){var r=o.indexedDB.open('dashboard-local-locks-v1',1);r.onupgradeneeded=function(){if(!r.result.objectStoreNames.contains('leases'))r.result.createObjectStore('leases',{keyPath:'key'});};r.onsuccess=function(){resolve(r.result);};r.onerror=r.onblocked=function(){dbPromise=null;reject(new Error('COORDINATION_UNAVAILABLE'));};});return dbPromise;}
  function mutate(key,fn){return database().then(function(db){return new Promise(function(resolve,reject){var result,tx=db.transaction('leases','readwrite'),store=tx.objectStore('leases'),r=store.get(key);r.onsuccess=function(){try{var change=fn(r.result);result=change.result;if(change.remove)store.delete(key);else if(change.value)store.put(change.value);}catch(e){reject(e);tx.abort();}};tx.oncomplete=function(){resolve(result);};tx.onabort=tx.onerror=function(){reject(new Error('COORDINATION_UNAVAILABLE'));};});});}
  async function withLock(name,work){var key='dashboard:'+name;
   if(o.locks&&typeof o.locks.request==='function')return o.locks.request(key,{mode:'exclusive'},work);
   var token=uuid(),deadline=now()+3000,acquired=false;
   while(!acquired){acquired=await mutate(key,function(old){if(old&&old.until>now())return {result:false};return {result:true,value:{key:key,token:token,until:now()+30000}};});if(!acquired){if(now()>=deadline)throw new Error('LOCK_BUSY');await new Promise(function(r){setTimeout(r,80);});}}
   var heartbeat=setInterval(function(){mutate(key,function(old){return old&&old.token===token?{value:{key:key,token:token,until:now()+30000},result:true}:{result:false};}).catch(function(){});},5000);
   try{return await work();}finally{clearInterval(heartbeat);await mutate(key,function(old){return old&&old.token===token?{remove:true,result:true}:{result:false};});}
  }
  return {withLock:withLock};
 }
 return {create:create};
});
