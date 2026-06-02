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
    // --- EASY (🥉) ---
    { id: 'first_task', tier: 'easy', bonus: 10, name: 'Первый шаг', icon: '🌱', desc: 'Выполни первую задачу', check: function(s){ return s.totalTasks >= 1; } },
    { id: 'tasks_10', tier: 'easy', bonus: 25, name: 'Разогрев', icon: '🔥', desc: 'Выполни 10 задач', check: function(s){ return s.totalTasks >= 10; } },
    { id: 'hours_1', tier: 'easy', bonus: 20, name: 'Час пользы', icon: '⏱️', desc: 'Набери 1 час чистого времени', check: function(s){ return s.totalMinutes >= 60; } },
    { id: 'coins_100', tier: 'easy', bonus: 30, name: 'Копилка', icon: '🪙', desc: 'Заработай 100 монет всего', check: function(s){ return (s.coinsEarned||0) >= 100; } },
    { id: 'level_5', tier: 'easy', bonus: 50, name: 'Новичок+', icon: '🎯', desc: 'Достигни 5 уровня', check: function(s){ return (s.overallLevel||1) >= 5; } },
    { id: 'early_bird', tier: 'easy', bonus: 15, name: 'Утренняя пташка', icon: '☀️', desc: 'Заверши задачу до 9:00', check: function(s){ return s.earlyTask; } },
    
    // --- MEDIUM (🥈) ---
    { id: 'tasks_50', tier: 'medium', bonus: 75, name: 'В ритме', icon: '🌟', desc: 'Выполни 50 задач', check: function(s){ return s.totalTasks >= 50; } },
    { id: 'hours_10', tier: 'medium', bonus: 100, name: 'Глубокая работа', icon: '🕐', desc: '10 часов полезного времени', check: function(s){ return s.totalMinutes >= 600; } },
    { id: 'days_7', tier: 'medium', bonus: 150, name: 'Недельный спринт', icon: '📅', desc: '7 активных дней подряд', check: function(s){ return s.totalDays >= 7; } },
    { id: 'coins_1000', tier: 'medium', bonus: 200, name: 'Богач', icon: '💎', desc: 'Заработай 1000 монет', check: function(s){ return (s.coinsEarned||0) >= 1000; } },
    { id: 'level_15', tier: 'medium', bonus: 250, name: 'Профи', icon: '🏅', desc: 'Достигни 15 уровня', check: function(s){ return (s.overallLevel||1) >= 15; } },
    { id: 'all_spheres', tier: 'medium', bonus: 100, name: 'Универсал', icon: '🌈', desc: 'Получи XP во всех сферах', check: function(s){ return (s.activeSpheres||0) >= (s.totalSpheres||6); } },
    { id: 'store_fan', tier: 'medium', bonus: 80, name: 'Шопоголик', icon: '🛍️', desc: 'Купи 5 наград в магазине', check: function(s){ return (s.totalPurchases||0) >= 5; } },

    // --- HARD (🥇) ---
    { id: 'tasks_200', tier: 'hard', bonus: 400, name: 'Стахановец', icon: '💯', desc: 'Выполни 200 задач', check: function(s){ return s.totalTasks >= 200; } },
    { id: 'hours_50', tier: 'hard', bonus: 500, name: 'Мастер фокуса', icon: '⚡', desc: '50 часов в потоке', check: function(s){ return s.totalMinutes >= 3000; } },
    { id: 'days_30', tier: 'hard', bonus: 600, name: 'Железная воля', icon: '🗓️', desc: '30 активных дней', check: function(s){ return s.totalDays >= 30; } },
    { id: 'level_30', tier: 'hard', bonus: 700, name: 'Ветеран', icon: '👑', desc: 'Достигни 30 уровня', check: function(s){ return (s.overallLevel||1) >= 30; } },
    { id: 'finance_master', tier: 'hard', bonus: 300, name: 'Инвестор', icon: '💹', desc: 'Уровень 10 в сфере Финансы', check: function(s){ return (s.sphereLevels['finance']||1) >= 10; } },
    { id: 'career_beast', tier: 'hard', bonus: 300, name: 'Акула бизнеса', icon: '🦈', desc: 'Уровень 10 в сфере Карьера', check: function(s){ return (s.sphereLevels['career']||1) >= 10; } },

    // --- ULTRA (💎) ---
    { id: 'tasks_1000', tier: 'ultra', bonus: 2000, name: 'Легенда', icon: '🤖', desc: 'Выполни 1000 задач', check: function(s){ return s.totalTasks >= 1000; } },
    { id: 'hours_200', tier: 'ultra', bonus: 2500, name: 'Повелитель времени', icon: '⏳', desc: '200 часов продуктивности', check: function(s){ return s.totalMinutes >= 12000; } },
    { id: 'days_100', tier: 'ultra', bonus: 3000, name: 'Бессмертный', icon: '🏆', desc: '100 активных дней', check: function(s){ return s.totalDays >= 100; } },
    { id: 'level_100', tier: 'ultra', bonus: 5000, name: 'АБСОЛЮТ', icon: '🏛️', desc: 'Достигни 100 уровня', check: function(s){ return (s.overallLevel||1) >= 100; } },
  ];

  function getAchievements() {
    return storeGet('achievements_v1') || { unlocked: {} };
  }

  function checkAchievements() {
    var stats = getTotalStats();
    var coins = getCoins();
    var spheres = getSpheres();
    var overall = getLevelInfo(0); // initial call to get overall
    var totalXp = 0;
    var sphereLevels = {};
    var activeSpheres = 0;
    for (var i = 0; i < SPHERES.length; i++) {
      var sId = SPHERES[i].id;
      var xp = (spheres[sId] && spheres[sId].xp) || 0;
      totalXp += xp;
      sphereLevels[sId] = getLevelInfo(xp).level;
      if (xp > 0) activeSpheres++;
    }
    overall = getLevelInfo(totalXp);
    var store = getStore();
    var gymHistory = storeGet('gym_history_v1') || [];
    
    // Custom check for "early bird"
    var lastTaskDate = localStorage.getItem('_last_task_date');
    var earlyTask = false;
    if (lastTaskDate) {
        var d = new Date(lastTaskDate);
        if (d.getHours() < 9) earlyTask = true;
    }

    var checkData = {
      totalTasks: stats.totalTasks,
      totalMinutes: stats.totalMinutes,
      totalDays: stats.totalDays,
      coinsEarned: coins.earned,
      overallLevel: overall.level,
      sphereLevels: sphereLevels,
      activeSpheres: activeSpheres,
      totalSpheres: SPHERES.length,
      totalPurchases: store.purchases ? store.purchases.length : 0,
      totalWorkouts: gymHistory.length,
      earlyTask: earlyTask
    };

    var achievements = getAchievements();
    var newUnlocks = [];
    for (var j = 0; j < ACHIEVEMENT_DEFS.length; j++) {
      var a = ACHIEVEMENT_DEFS[j];
      if (achievements.unlocked[a.id]) continue;
      if (a.check(checkData)) {
        achievements.unlocked[a.id] = new Date().toISOString();
        newUnlocks.push(a);
        // Award bonus coins
        if (a.bonus) {
            earnCoins(a.bonus, 'Награда: ' + a.name);
        }
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
