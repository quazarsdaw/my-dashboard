(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HabitRewardsUI = factory();
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  function create(o) {
    var pending = new Set(),
      recovering = false;
    function error(e) {
      o.onError(
        e && e.message === 'OWNER_CHANGED'
          ? 'Аккаунт изменился. Проверьте отметки после синхронизации.'
          : 'Не удалось сохранить награду. Обновите страницу для восстановления; не повторяйте отметку до проверки.',
      );
    }
    async function toggle(id, date) {
      var key = id + ':' + date;
      if (pending.has(key) || recovering) return false;
      var data = o.getTracker(),
        current = data.marks[key] || 0,
        target = current === 0 ? 1 : current === 1 ? 0.5 : 0;
      pending.add(key);
      o.onPending(key, true);
      o.onError('');
      try {
        await o.service.setGoodMark(id, date, target, {
          expectedMark: current,
          operationId: o.uuid(),
        });
        o.onChange();
        return true;
      } catch (e) {
        error(e);
        o.onChange();
        return false;
      } finally {
        pending.delete(key);
        o.onPending(key, false);
      }
    }
    async function recover() {
      if (recovering) return;
      recovering = true;
      try {
        var result = await o.service.recover();
        if (result) o.onChange();
      } catch (e) {
        error(e);
      } finally {
        recovering = false;
      }
    }
    return {
      toggle: toggle,
      recover: recover,
      isPending: (key) => pending.has(key) || recovering,
    };
  }
  return { create: create };
});
