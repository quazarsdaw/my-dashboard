(function (root, factory) {
  if (typeof module === 'object' && module.exports)
    module.exports = factory(require('./browser-lock.js'));
  else root.HabitRewardsLock = factory(root.BrowserLock);
})(typeof window === 'object' ? window : globalThis, function (B) {
  'use strict';
  return {
    create: function (o) {
      var lock = B.create(o);
      return {
        withLock: function (owner, work) {
          return lock.withLock('habit-rewards:' + owner, work);
        },
      };
    },
  };
});
