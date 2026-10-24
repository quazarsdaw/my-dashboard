(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./habit-rewards-core.js'));else root.HabitRewardsStore=factory(root.HabitRewardsCore);})(typeof window==='object'?window:globalThis,function(H){
 'use strict';
 function create(o){
  function key(who){return '_habit_reward_tx_v1:'+encodeURIComponent(who);}
  function check(who){if(o.getOwner()!==who)throw new Error('OWNER_CHANGED');}
  function readJournal(who){var raw=o.runtimeStorage.getItem(key(who));if(!raw)return null;var j;try{j=JSON.parse(raw);}catch(_){throw new Error('INVALID_JOURNAL');}if(!j||j.version!==1||j.owner!==who||H.validateCommand(j.command).owner!==who)throw new Error('INVALID_JOURNAL');return j;}
  function perform(j,who){check(who);var tracker=o.get('tracker_v1'),coins=o.get('coins_v1'),change=H.prepareChange(tracker,coins,j.command);var nextCoins=H.applyCoinChange(coins,change);if(nextCoins!==coins){check(who);o.set('coins_v1',nextCoins);}check(who);var freshTracker=o.get('tracker_v1'),nextTracker=H.applyTrackerChange(freshTracker,change);if(nextTracker!==freshTracker)o.set('tracker_v1',nextTracker);check(who);
   var finalCoins=o.get('coins_v1'),finalTracker=o.get('tracker_v1'),slot=finalCoins&&finalCoins.habitRewardsV1&&finalCoins.habitRewardsV1[change.markKey];if(!slot||slot.operationId!==j.command.operationId||(finalTracker.marks[change.markKey]||0)!==j.command.targetMark)throw new Error('INCOMPLETE_REWARD_WRITE');o.runtimeStorage.removeItem(key(who));return {tracker:finalTracker,coins:finalCoins,delta:change.delta};
  }
  function recoverOwned(who){check(who);var j=readJournal(who);return j?perform(j,who):null;}
  function recover(){var who=o.getOwner();return o.withLock(who,function(){return recoverOwned(who);});}
  function setGoodMark(habitId,date,targetMark,options){var who=o.getOwner();options=options||{};var command=H.validateCommand({operationId:options.operationId||o.uuid(),habitId:habitId,date:date,targetMark:targetMark,expectedMark:options.expectedMark,owner:who,at:o.now()});return o.withLock(who,function(){check(who);recoverOwned(who);var change=H.prepareChange(o.get('tracker_v1'),o.get('coins_v1'),command);if(change.noOp&&(o.get('tracker_v1').marks[change.markKey]||0)===targetMark)return {tracker:o.get('tracker_v1'),coins:o.get('coins_v1'),delta:0};var j={version:1,owner:who,command:command};o.runtimeStorage.setItem(key(who),JSON.stringify(j));return perform(j,who);});}
  return {setGoodMark:setGoodMark,recover:recover};
 }
 return {create:create};
});
