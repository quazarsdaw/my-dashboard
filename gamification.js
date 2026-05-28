(function () {
  'use strict';

  var DEFAULT_SPHERES = [
    { id: 'health',    name: 'Здоровье',      icon: '🏃', color: '#6BE3A4' },
    { id: 'career',    name: 'Карьера',        icon: '💼', color: '#7DD3FC' },
    { id: 'finance',   name: 'Финансы',        icon: '💰', color: '#F2C063' },
    { id: 'relations', name: 'Отношения',      icon: '💛', color: '#FF6B6B' },
    { id: 'growth',    name: 'Саморазвитие',   icon: '📚', color: '#C084FC' },
    { id: 'hobbies',   name: 'Хобби',          icon: '🎮', color: '#FB923C' },
  ];
  var SPHERE_COLORS = ['#6BE3A4','#7DD3FC','#F2C063','#FF6B6B','#C084FC','#FB923C','#F472B6','#34D399','#A78BFA','#FBBF24'];

  // Load custom sphere defs or use defaults
  var SPHERES = (function(){
    try { var c = JSON.parse(localStorage.getItem('sphere_defs_v1')); if(c && c.length) return c; } catch(e){}
    return DEFAULT_SPHERES.map(function(s){ return {id:s.id, name:s.name, icon:s.icon, color:s.color}; });
  })();

  function getSphereDefs(){ return SPHERES; }
  function setSphereDefs(defs){
    SPHERES = defs;
    localStorage.setItem('sphere_defs_v1', JSON.stringify(defs));
    window.Gamification.SPHERES = SPHERES;
    window.dispatchEvent(new CustomEvent('gamification-update'));
  }
  function renameSphere(id, newName, newIcon){
    for(var i=0;i<SPHERES.length;i++){
      if(SPHERES[i].id===id){
        if(newName) SPHERES[i].name = newName;
        if(newIcon) SPHERES[i].icon = newIcon;
        break;
      }
    }
    setSphereDefs(SPHERES);
  }
  function addSphere(name, icon){
    var id = 's_'+Date.now();
    var color = SPHERE_COLORS[SPHERES.length % SPHERE_COLORS.length];
    SPHERES.push({id:id, name:name, icon:icon||'🔵', color:color});
    setSphereDefs(SPHERES);
    return id;
  }
  function removeSphere(id){
    SPHERES = SPHERES.filter(function(s){ return s.id !== id; });
    setSphereDefs(SPHERES);
  }

  var MAX_LEVEL = 100;
  var XP_BASE = 100;
  var XP_EXPONENT = 1.5;

  var DIFFICULTY_COIN_MULT = { easy: 0.15, medium: 0.35, hard: 0.6 };
  var DIFFICULTY_LABELS = { easy: 'Лёгкая', medium: 'Средняя', hard: 'Сложная' };

  function xpForLevel(level) {
    if (level >= MAX_LEVEL) return Infinity;
    return Math.floor(XP_BASE * Math.pow(level, XP_EXPONENT));
  }

  function getLevelInfo(totalXp) {
    var level = 1;
    var xpUsed = 0;
    while (level < MAX_LEVEL) {
      var needed = xpForLevel(level);
      if (xpUsed + needed > totalXp) {
        return { level: level, xpInLevel: totalXp - xpUsed, xpNeeded: needed, totalXp: totalXp };
      }
      xpUsed += needed;
      level++;
    }
    return { level: MAX_LEVEL, xpInLevel: 0, xpNeeded: 0, totalXp: totalXp };
  }

  function getOverallLevel(spheresData) {
    var totalXp = 0;
    for (var i = 0; i < SPHERES.length; i++) {
      totalXp += (spheresData[SPHERES[i].id] || { xp: 0 }).xp;
    }
    return getLevelInfo(totalXp);
  }

  // --- localStorage helpers ---

  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function notifyDataChanged(key) {
    try {
      window.dispatchEvent(new CustomEvent('dashboard-data-changed', { detail: { key: key } }));
    } catch (e) {}
  }

  function storeSet(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    notifyDataChanged(key);
  }

  // --- Spheres ---

  function getSpheres() {
    return storeGet('spheres_v1') || {};
  }

  function addXpToSphere(sphereId, amount) {
    var data = getSpheres();
    if (!data[sphereId]) data[sphereId] = { xp: 0 };
    data[sphereId].xp = Math.max(0, data[sphereId].xp + amount);
    storeSet('spheres_v1', data);
    return data;
  }

  // --- Coins ---

  function getCoins() {
    return storeGet('coins_v1') || { balance: 0, earned: 0, spent: 0, history: [] };
  }

  function earnCoins(amount, reason) {
    var data = getCoins();
    data.balance += amount;
    data.earned += amount;
    data.history.unshift({ amount: amount, type: 'earn', reason: reason, date: new Date().toISOString() });
    if (data.history.length > 200) data.history.length = 200;
    storeSet('coins_v1', data);
    return data;
  }

  function spendCoins(amount, reason, force) {
    var data = getCoins();
    if (!force && data.balance < amount) return null;
    data.balance = data.balance - amount;
    data.spent += amount;
    data.history.unshift({ amount: amount, type: 'spend', reason: reason, date: new Date().toISOString() });
    if (data.history.length > 200) data.history.length = 200;
    storeSet('coins_v1', data);
    return data;
  }

  // --- Store ---

  var DEFAULT_REWARDS = [
    { id: 'series_1h',     name: '1 час сериала',         price: 50,  icon: '📺' },
    { id: 'gaming_1h',     name: '1 час игр',             price: 50,  icon: '🎮' },
    { id: 'junk_food',     name: 'Фастфуд',               price: 80,  icon: '🍔' },
    { id: 'sleep_in',      name: 'Поспать подольше',       price: 30,  icon: '😴' },
    { id: 'shopping',      name: 'Покупка до 1000₽',      price: 100, icon: '🛍️' },
    { id: 'day_off',       name: 'Выходной без дел',       price: 200, icon: '🏖️' },
    { id: 'social_scroll', name: '30 мин соцсети',         price: 25,  icon: '📱' },
  ];

  function getStore() {
    var data = storeGet('store_v1');
    if (!data) {
      // Return defaults in memory but DON'T write to localStorage.
      // This prevents default data from overwriting custom data during sync.
      return { rewards: DEFAULT_REWARDS, purchases: [] };
    }
    return data;
  }

  function purchaseReward(rewardId) {
    var store = getStore();
    var reward = null;
    for (var i = 0; i < store.rewards.length; i++) {
      if (store.rewards[i].id === rewardId) { reward = store.rewards[i]; break; }
    }
    if (!reward) return null;
    var coins = spendCoins(reward.price, reward.name);
    if (!coins) return null;
    store.purchases.unshift({ rewardId: rewardId, name: reward.name, price: reward.price, date: new Date().toISOString() });
    if (store.purchases.length > 200) store.purchases.length = 200;
    storeSet('store_v1', store);
    return { coins: coins, store: store };
  }

  function addReward(name, price, icon) {
    var store = getStore();
    var id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    store.rewards.push({ id: id, name: name, price: price, icon: icon || '🎁' });
    storeSet('store_v1', store);
    return store;
  }

  function removeReward(rewardId) {
    var store = getStore();
    store.rewards = store.rewards.filter(function (r) { return r.id !== rewardId; });
    storeSet('store_v1', store);
    return store;
  }

  // --- Task completion (time-based XP, difficulty coins with floor) ---
  // XP = actualMinutes (1 min = 1 XP)
  // Coins = floor(actualMinutes * difficultyMult)
  // easy=0.15, medium=0.35, hard=0.6  →  30min easy=4, 30min med=10, 30min hard=18

  function completeTask(sphereId, difficulty, actualMinutes) {
    var diff = difficulty || 'medium';
    var mins = actualMinutes || 15;
    var xp = mins;
    var mult = DIFFICULTY_COIN_MULT[diff] || 0.35;
    var coins = Math.max(1, Math.floor(mins * mult));
    var sphere = SPHERES.find(function (s) { return s.id === sphereId; });
    var sphereName = sphere ? sphere.name : 'без сектора';
    earnCoins(coins, 'Задача (' + sphereName + ')');
    if (sphere) addXpToSphere(sphereId, xp);
    addTotalStats(mins, 1);
    checkAchievements();
    window.dispatchEvent(new CustomEvent('gamification-update'));
    return { coins: coins, xp: xp };
  }

  // --- Total stats (for achievements & profile) ---

  function getTotalStats() {
    return storeGet('total_stats_v1') || { totalMinutes: 0, totalTasks: 0, totalDays: 0, firstDay: null };
  }

  function addTotalStats(minutes, tasks) {
    var stats = getTotalStats();
    stats.totalMinutes += minutes;
    stats.totalTasks += tasks;
    if (!stats.firstDay) stats.firstDay = new Date().toISOString();
    var today = new Date().toISOString().slice(0, 10);
    if (stats.lastActiveDay !== today) {
      stats.totalDays = (stats.totalDays || 0) + 1;
      stats.lastActiveDay = today;
    }
    storeSet('total_stats_v1', stats);
    return stats;
  }

  // --- Activity Timer ---

  function getTimerState() {
    return storeGet('timer_v1') || { running: false, sphereId: null, startTime: null, label: '' };
  }

  function startTimer(sphereId, label) {
    var state = { running: true, sphereId: sphereId, startTime: Date.now(), label: label || '' };
    storeSet('timer_v1', state);
    window.dispatchEvent(new CustomEvent('timer-update'));
    return state;
  }

  function stopTimer() {
    var state = getTimerState();
    if (!state.running) return null;
    var elapsed = Math.round((Date.now() - state.startTime) / 60000);
    if (elapsed < 1) elapsed = 1;
    state.running = false;
    storeSet('timer_v1', state);
    var log = getActivityLog();
    log.unshift({
      label: state.label,
      sphereId: state.sphereId,
      startTime: new Date(state.startTime).toISOString(),
      endTime: new Date().toISOString(),
      minutes: elapsed
    });
    if (log.length > 500) log.length = 500;
    storeSet('activity_log_v1', log);
    if (state.sphereId) {
      addXpToSphere(state.sphereId, elapsed);
      var timerCoins = Math.max(1, Math.floor(elapsed * DIFFICULTY_COIN_MULT['medium']));
      earnCoins(timerCoins, 'Таймер: ' + (state.label || state.sphereId));
      addTotalStats(elapsed, 0);
    }
    checkAchievements();
    window.dispatchEvent(new CustomEvent('gamification-update'));
    window.dispatchEvent(new CustomEvent('timer-update'));
    return { minutes: elapsed, sphereId: state.sphereId };
  }

  function getActivityLog() {
    return storeGet('activity_log_v1') || [];
  }

  // --- Achievements ---

  var ACHIEVEMENT_DEFS = [
    { id: 'first_task',       name: 'Первая задача',         icon: '🌱', desc: 'Выполни первую задачу', check: function(s){ return s.totalTasks >= 1; } },
    { id: 'tasks_10',         name: '10 задач',              icon: '⭐', desc: 'Выполни 10 задач', check: function(s){ return s.totalTasks >= 10; } },
    { id: 'tasks_50',         name: '50 задач',              icon: '🌟', desc: 'Выполни 50 задач', check: function(s){ return s.totalTasks >= 50; } },
    { id: 'tasks_100',        name: 'Сотня!',                icon: '💯', desc: 'Выполни 100 задач', check: function(s){ return s.totalTasks >= 100; } },
    { id: 'tasks_500',        name: 'Машина',                icon: '🤖', desc: 'Выполни 500 задач', check: function(s){ return s.totalTasks >= 500; } },
    { id: 'hours_1',          name: 'Первый час',            icon: '⏱️', desc: '1 час полезного времени', check: function(s){ return s.totalMinutes >= 60; } },
    { id: 'hours_10',         name: '10 часов',              icon: '🕐', desc: '10 часов полезного времени', check: function(s){ return s.totalMinutes >= 600; } },
    { id: 'hours_100',        name: '100 часов',             icon: '🔥', desc: '100 часов полезного времени', check: function(s){ return s.totalMinutes >= 6000; } },
    { id: 'days_7',           name: 'Неделя',                icon: '📅', desc: '7 активных дней', check: function(s){ return s.totalDays >= 7; } },
    { id: 'days_30',          name: 'Месяц',                 icon: '🗓️', desc: '30 активных дней', check: function(s){ return s.totalDays >= 30; } },
    { id: 'days_100',         name: '100 дней',              icon: '🏆', desc: '100 активных дней', check: function(s){ return s.totalDays >= 100; } },
    { id: 'coins_100',        name: 'Копилка',               icon: '🪙', desc: 'Заработай 100 монет', check: function(s){ return (s.coinsEarned||0) >= 100; } },
    { id: 'coins_1000',       name: 'Богач',                 icon: '💎', desc: 'Заработай 1000 монет', check: function(s){ return (s.coinsEarned||0) >= 1000; } },
    { id: 'level_5',          name: 'Уровень 5',             icon: '🎯', desc: 'Достигни 5 уровня', check: function(s){ return (s.overallLevel||1) >= 5; } },
    { id: 'level_10',         name: 'Уровень 10',            icon: '🏅', desc: 'Достигни 10 уровня', check: function(s){ return (s.overallLevel||1) >= 10; } },
    { id: 'level_25',         name: 'Уровень 25',            icon: '👑', desc: 'Достигни 25 уровня', check: function(s){ return (s.overallLevel||1) >= 25; } },
    { id: 'level_50',         name: 'Полтинник',             icon: '🎖️', desc: 'Достигни 50 уровня', check: function(s){ return (s.overallLevel||1) >= 50; } },
    { id: 'level_100',        name: 'МАКС',                  icon: '🏛️', desc: 'Достигни 100 уровня', check: function(s){ return (s.overallLevel||1) >= 100; } },
    { id: 'all_spheres',      name: 'Универсал',             icon: '🌈', desc: 'XP во всех сферах', check: function(s){ return (s.activeSpheres||0) >= (s.totalSpheres||6); } },
    { id: 'first_purchase',   name: 'Первая покупка',        icon: '🛒', desc: 'Купи награду в магазине', check: function(s){ return (s.totalPurchases||0) >= 1; } },
    { id: 'workout_10',       name: '10 тренировок',         icon: '💪', desc: 'Завершил 10 тренировок', check: function(s){ return (s.totalWorkouts||0) >= 10; } },
  ];

  function getAchievements() {
    return storeGet('achievements_v1') || { unlocked: {} };
  }

  function checkAchievements() {
    var stats = getTotalStats();
    var coins = getCoins();
    var spheres = getSpheres();
    var overall = getOverallLevel(spheres);
    var store = getStore();
    var gymHistory = storeGet('gym_history_v1') || [];
    var activeSpheres = 0;
    for (var i = 0; i < SPHERES.length; i++) {
      if (spheres[SPHERES[i].id] && spheres[SPHERES[i].id].xp > 0) activeSpheres++;
    }

    var checkData = {
      totalTasks: stats.totalTasks,
      totalMinutes: stats.totalMinutes,
      totalDays: stats.totalDays,
      coinsEarned: coins.earned,
      overallLevel: overall.level,
      activeSpheres: activeSpheres,
      totalSpheres: SPHERES.length,
      totalPurchases: store.purchases ? store.purchases.length : 0,
      totalWorkouts: gymHistory.length,
    };

    var achievements = getAchievements();
    var newUnlocks = [];
    for (var j = 0; j < ACHIEVEMENT_DEFS.length; j++) {
      var a = ACHIEVEMENT_DEFS[j];
      if (achievements.unlocked[a.id]) continue;
      if (a.check(checkData)) {
        achievements.unlocked[a.id] = new Date().toISOString();
        newUnlocks.push(a);
      }
    }
    if (newUnlocks.length > 0) {
      storeSet('achievements_v1', achievements);
      window.dispatchEvent(new CustomEvent('achievement-unlocked', { detail: newUnlocks }));
    }
    return achievements;
  }

  function unlockManualAchievement(id, name, icon) {
    var achievements = getAchievements();
    if (!achievements.unlocked[id]) {
      achievements.unlocked[id] = new Date().toISOString();
      if (!achievements.custom) achievements.custom = [];
      achievements.custom.push({ id: id, name: name, icon: icon || '🏅', date: new Date().toISOString() });
      storeSet('achievements_v1', achievements);
      window.dispatchEvent(new CustomEvent('achievement-unlocked', { detail: [{ id: id, name: name, icon: icon }] }));
    }
    return achievements;
  }

  // --- Player Profile ---

  function getProfile() {
    return storeGet('profile_v1') || { name: 'Игрок', avatar: '🧑‍💻' };
  }

  function setProfile(data) {
    storeSet('profile_v1', data);
    window.dispatchEvent(new CustomEvent('gamification-update'));
  }

  // --- Public API ---

  window.Gamification = {
    SPHERES: SPHERES,
    getSphereDefs: getSphereDefs,
    setSphereDefs: setSphereDefs,
    renameSphere: renameSphere,
    addSphere: addSphere,
    removeSphere: removeSphere,
    MAX_LEVEL: MAX_LEVEL,
    DIFFICULTY_COIN_MULT: DIFFICULTY_COIN_MULT,
    DIFFICULTY_LABELS: DIFFICULTY_LABELS,
    ACHIEVEMENT_DEFS: ACHIEVEMENT_DEFS,
    xpForLevel: xpForLevel,
    getLevelInfo: getLevelInfo,
    getOverallLevel: getOverallLevel,
    getSpheres: getSpheres,
    addXpToSphere: addXpToSphere,
    getCoins: getCoins,
    earnCoins: earnCoins,
    spendCoins: spendCoins,
    getStore: getStore,
    purchaseReward: purchaseReward,
    addReward: addReward,
    removeReward: removeReward,
    completeTask: completeTask,
    getTotalStats: getTotalStats,
    getTimerState: getTimerState,
    startTimer: startTimer,
    stopTimer: stopTimer,
    getActivityLog: getActivityLog,
    getAchievements: getAchievements,
    checkAchievements: checkAchievements,
    unlockManualAchievement: unlockManualAchievement,
    getProfile: getProfile,
    setProfile: setProfile,
    storeGet: storeGet,
    storeSet: storeSet,
  };
})();
