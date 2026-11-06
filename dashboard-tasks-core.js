(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DashboardTasksCore = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  function newId(uuidFn) {
    var id = typeof uuidFn === 'function' ? uuidFn() : null;
    if (typeof id !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(id)) throw new Error('UUID_UNAVAILABLE');
    return id;
  }

  function createTask(fields, uuidFn) {
    var task = Object.assign({}, fields, { id: newId(uuidFn), done: false });
    delete task.doneAt;
    delete task.actualMin;
    return task;
  }

  function indexFor(tasks, target) {
    if (!Array.isArray(tasks) || !target) throw new Error('TASK_NOT_FOUND');
    if (typeof target.id === 'string' && target.id) {
      var matches = [];
      tasks.forEach(function(task, index) { if (task && task.id === target.id) matches.push(index); });
      if (matches.length > 1) throw new Error('AMBIGUOUS_TASK');
      if (matches.length !== 1) throw new Error('TASK_NOT_FOUND');
      return matches[0];
    }
    if (!Number.isInteger(target.index) || target.index < 0 || target.index >= tasks.length) throw new Error('TASK_NOT_FOUND');
    return target.index;
  }

  function patchTask(tasks, target, patch) {
    var index = indexFor(tasks, target), result = tasks.slice();
    if (Object.hasOwn(patch, 'id') && patch.id !== tasks[index].id) throw new Error('IDENTITY_IMMUTABLE');
    result[index] = Object.assign({}, tasks[index], patch);
    return result;
  }

  function moveTask(source, destination, target) {
    var index = indexFor(source, target), item = source[index];
    if (!Array.isArray(destination)) throw new Error('INVALID_DESTINATION');
    if (item.id && destination.some(function(task) { return task.id === item.id; })) throw new Error('DUPLICATE_TASK');
    return { source: source.filter(function(_task, i) { return i !== index; }), destination: destination.concat([Object.assign({}, item)]) };
  }

  function documentMatches(binding, serialized, token) {
    if (!binding || binding.serialized !== serialized) return false;
    if (!binding.token || !token) return binding.token === token;
    return binding.token.owner === token.owner && binding.token.key === token.key &&
      binding.token.localEpoch === token.localEpoch && binding.token.remoteRevision === token.remoteRevision;
  }

  function dateKey(now, offset) {
    if (offset === undefined) offset = 0;
    if (!now || !Number.isFinite(now.getTime()) || !Number.isSafeInteger(offset)) throw new Error('INVALID_DATE');
    return new Date(now.getTime() - 3600000 + offset * 86400000).toISOString().slice(0, 10);
  }

  return { newId: newId, createTask: createTask, indexFor: indexFor, patchTask: patchTask, moveTask: moveTask, documentMatches: documentMatches, dateKey: dateKey };
});
