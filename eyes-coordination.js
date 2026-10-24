(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./browser-lock.js'));else root.EyesCoordination=factory(root.BrowserLock);})(typeof window==='object'?window:globalThis,function(B){
 'use strict';var KEY='_eye_break_session_lease_v1';
 function create(o){var lock=B.create(o),now=o.now||Date.now,channel=o.channelFactory?o.channelFactory('dashboard-eye-breaks'):null,listeners=[];
  function active(){try{var x=JSON.parse(o.storage.getItem(KEY));return x&&typeof x.token==='string'&&x.until>now()&&x.until<=now()+16000?x:null;}catch(_){return null;}}
  function publish(){if(channel)channel.postMessage({type:'changed'});listeners.forEach(function(fn){fn();});}
  if(channel)channel.onmessage=publishLocal;
  function publishLocal(){listeners.forEach(function(fn){fn();});}
  async function claimSession(request){return lock.withLock('eye-active-session',function(){var x=active();if(x&&(x.id!==request.id||x.owner!==request.owner||x.tabId!==o.tabId))return {ok:false,active:x};var token=x?x.token:o.uuid();o.storage.setItem(KEY,JSON.stringify({id:request.id,owner:request.owner,tabId:o.tabId,token:token,until:now()+15000}));publish();return {ok:true,token:token};});}
  async function renewSession(token){return lock.withLock('eye-active-session',function(){var x=active();if(!x||x.token!==token||x.tabId!==o.tabId)return false;x.until=now()+15000;o.storage.setItem(KEY,JSON.stringify(x));return true;});}
  async function releaseSession(token){return lock.withLock('eye-active-session',function(){var x=active();if(!x||x.token!==token||x.tabId!==o.tabId)return false;o.storage.removeItem(KEY);publish();return true;});}
  return {withLock:lock.withLock,claimSession:claimSession,renewSession:renewSession,releaseSession:releaseSession,active:active,subscribe:function(fn){listeners.push(fn);return function(){listeners=listeners.filter(function(f){return f!==fn;});};},close:function(){if(channel)channel.close();listeners=[];}};
 }
 return {create:create};
});
