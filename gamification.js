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
    if (!data) return { rewards: DEFAULT_REWARDS, purchases: [] };
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
    localStorage.setItem('_last_task_date', new Date().toISOString());
    checkAchievements();
    window.dispatchEvent(new CustomEvent('gamification-update'));
    return { coins: coins, xp: xp };
  }

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
    log.unshift({ label: state.label, sphereId: state.sphereId, startTime: new Date(state.startTime).toISOString(), endTime: new Date().toISOString(), minutes: elapsed });
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

  var ACHIEVEMENT_DEFS = [
    // --- COMMON (Bonuses: 5-15) ---
    { id: 'first_task', rarity: 'common', bonus: 5, name: 'База', icon: '🌱', desc: 'Выполни первую задачу' },
    { id: 'altushka', rarity: 'common', bonus: 10, name: 'Альтушка с госуслуг', icon: '👩‍🎤', desc: 'Первая покупка в магазине' },
    { id: 'tasks_10', rarity: 'common', bonus: 15, name: 'Разогрев', icon: '🔥', desc: 'Выполни 10 задач' },
    { id: 'hours_1', rarity: 'common', bonus: 10, name: 'Час пользы', icon: '⏱️', desc: '1 час в фокусе' },
    { id: 'days_3', rarity: 'common', bonus: 15, name: 'Стабильность', icon: '📅', desc: '3 активных дня' },
    { id: 'coins_50', rarity: 'common', bonus: 10, name: 'Мелочь', icon: '🪙', desc: 'Заработай 50 монет' },
    { id: 'level_5', rarity: 'common', bonus: 25, name: 'Новичок+', icon: '🏅', desc: 'Достигни 5 уровня' },
    { id: 'gym_1', rarity: 'common', bonus: 15, name: 'Спортсмен', icon: '💪', desc: 'Первая тренировка' },
    { id: 'sphere_xp', rarity: 'common', bonus: 10, name: 'Первый опыт', icon: '✨', desc: 'Получи XP в любой сфере' },
    { id: 'early_bird', rarity: 'common', bonus: 10, name: 'Кто понял жизнь...', icon: '☀️', desc: 'Задача до 9:00' },
    { id: 'number_67', rarity: 'common', bonus: 67, name: '67', icon: '🎰', desc: 'Выполни ровно 67 задач' },
    { id: 'clothing_78', rarity: 'common', bonus: 15, name: '7-8 одежда', icon: '👕', desc: 'Выполни 8 задач за день' },

    // --- RARE (Bonuses: 30-60) ---
    { id: 'tasks_50', rarity: 'rare', bonus: 50, name: '52', icon: '🏙️', desc: 'Да здравствует Санкт-Петербург!' },
    { id: 'temshik', rarity: 'rare', bonus: 100, name: 'Темщик', icon: '💸', desc: 'Набери 1000 монет' },
    { id: 'surgut', rarity: 'rare', bonus: 80, name: 'Сургут', icon: '❄️', desc: '10 тренировок за всё время' },
    { id: 'technik', rarity: 'rare', bonus: 60, name: 'Техник', icon: '🎧', desc: 'Купи 10 наград в магазине' },
    { id: 'skuf', rarity: 'rare', bonus: 5, name: 'Скуф', icon: '🍺', desc: '30 дней без тренировок' },
    { id: 'hours_20', rarity: 'rare', bonus: 80, name: 'Сутки пользы', icon: '⏳', desc: '24 часа чистого времени' },
    { id: 'days_7', rarity: 'rare', bonus: 60, name: 'Недельный стрик', icon: '📆', desc: '7 активных дней подряд' },
    { id: 'level_15', rarity: 'rare', bonus: 120, name: 'Профи', icon: '🌟', desc: 'Достигни 15 уровня' },
    { id: 'all_spheres', rarity: 'rare', bonus: 60, name: 'Универсал', icon: '🌈', desc: 'XP во всех сферах' },
    { id: 'habit_7', rarity: 'rare', bonus: 50, name: 'Привычка', icon: '🔄', desc: '7 активных дней' },

    // --- EPIC (Bonuses: 150-300) ---
    { id: 'svo', rarity: 'epic', bonus: 300, name: 'С.В.О.', icon: '🎖️', desc: 'Специальная Волевая Операция (5 сложных задач)' },
    { id: 'borov', rarity: 'epic', bonus: 500, name: 'Боров', icon: '🐗', desc: 'Накопи 5000 монет' },
    { id: 'mamont', rarity: 'epic', bonus: 250, name: 'Мамонт', icon: '🦣', desc: 'Потрачено 5000 монет' },
    { id: 'mamkin_investor', rarity: 'epic', bonus: 300, name: 'Мамкин инвестор', icon: '📈', desc: 'Баланс финансов > 10000' },
    { id: 'dedinsight', rarity: 'epic', bonus: 100, name: 'Дединсайд', icon: '🦉', desc: 'Задача после 00:00' },
    { id: 'sigma', rarity: 'epic', bonus: 400, name: 'Сигма', icon: '🗿', desc: '50 тренировок завершено' },
    { id: 'tasks_300', rarity: 'epic', bonus: 400, name: 'Неудержимый', icon: '🚀', desc: '300 выполненных задач' },
    { id: 'hours_100', rarity: 'epic', bonus: 400, name: 'Мастер времени', icon: '🌓', desc: '100 часов в фокусе' },
    { id: 'days_60', rarity: 'epic', bonus: 500, name: 'Железная воля', icon: '🛡️', desc: '60 активных дней' },
    { id: 'all_spheres_5', rarity: 'epic', bonus: 300, name: 'Разносторонний', icon: '💠', desc: '5 уровень во всех сферах' },

    // --- LEGENDARY (Bonuses: 800-1500) ---
    { id: 'river_walker', rarity: 'legendary', bonus: 1500, name: 'Идущий к реке', icon: '🌊', desc: '500 часов общего времени' },
    { id: 'gigachad', rarity: 'legendary', bonus: 1500, name: 'Гигачад', icon: '💪', desc: '100 тренировок' },
    { id: 'moms_friend_son', rarity: 'legendary', bonus: 2000, name: 'Сын маминой подруги', icon: '🥇', desc: '10 уровень во всех сферах' },
    { id: 'chinazes', rarity: 'legendary', bonus: 2500, name: 'Чиназес', icon: '😎', desc: '1000 выполненных задач' },
    { id: 'tasks_500', rarity: 'legendary', bonus: 1000, name: 'Сверхчеловек', icon: '⚡', desc: '500 выполненных задач' },
    { id: 'days_365', rarity: 'legendary', bonus: 5000, name: 'Год жизни', icon: '🌍', desc: '365 активных дней' },
    { id: 'level_75', rarity: 'legendary', bonus: 2500, name: 'Легенда', icon: '🔱', desc: 'Достигни 75 уровня' },
    { id: 'capitalist', rarity: 'legendary', bonus: 3000, name: 'Капиталист', icon: '🏦', desc: 'Баланс финансов > 100000' },

    // --- MYTHIC (Bonuses: 3000-7000) ---
    { id: 'tasks_5000', rarity: 'mythic', bonus: 10000, name: 'Творец миров', icon: '🌌', desc: '5000 выполненных задач' },
    { id: 'level_100', rarity: 'mythic', bonus: 30000, name: 'БОЖЕСТВО', icon: '🪐', desc: 'Достигни 100 уровня' },
    { id: 'billionaire', rarity: 'mythic', bonus: 50000, name: 'Властелин богатства', icon: '♾️', desc: 'Заработай 100к монет' },
    { id: 'perfectionist', rarity: 'mythic', bonus: 15000, name: 'Перфекционист', icon: '💎', desc: 'Все сферы на 50 уровне' }
  ];

  function getAchievements() { return storeGet('achievements_v1') || { unlocked: {} }; }

  function checkAchievements() {
    var stats = getTotalStats(), coins = getCoins(), spheresData = getSpheres(), overall = getOverallLevel(spheresData), store = getStore(), gymHistory = storeGet('gym_history_v1') || [], log = getActivityLog(), finData = storeGet('finance_v1') || { balance: 0 };
    var sphereLevels = {}, activeSpheres = 0;
    for (var i = 0; i < SPHERES.length; i++) {
      var sId = SPHERES[i].id, xp = (spheresData[sId] && spheresData[sId].xp) || 0;
      sphereLevels[sId] = getLevelInfo(xp).level;
      if (xp > 0) activeSpheres++;
    }
    var lastTaskDate = localStorage.getItem('_last_task_date'), taskHour = lastTaskDate ? new Date(lastTaskDate).getHours() : -1;
    
    // Check for "SVO" - 5 hard tasks
    var taskHistory = storeGet('task_history_v1') || [];
    var hardTasksInARow = 0;
    for(var i=0; i<Math.min(taskHistory.length, 10); i++) {
        if(taskHistory[i].difficulty === 'hard') hardTasksInARow++;
        else if (hardTasksInARow < 5) hardTasksInARow = 0;
    }

    var d = { 
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
        earlyTask: taskHour >= 4 && taskHour < 9, 
        nightTask: (taskHour >= 0 && taskHour < 4) || taskHour > 23, 
        pomoCount: log.length, 
        finBalance: finData.balance || 0, 
        coinBalance: coins.balance,
        hardStreak: hardTasksInARow >= 5,
        lastGymDate: gymHistory.length ? gymHistory[0].date : stats.firstDay
    };
    
    var daysSinceGym = d.lastGymDate ? (Date.now() - new Date(d.lastGymDate).getTime()) / (1000*3600*24) : 0;

    var achievements = getAchievements(), newUnlocks = [];
    var checker = {
      first_task: function(d) { return d.totalTasks >= 1; },
      altushka: function(d) { return d.totalPurchases >= 1; },
      tasks_10: function(d) { return d.totalTasks >= 10; },
      hours_1: function(d) { return d.totalMinutes >= 60; },
      days_3: function(d) { return d.totalDays >= 3; },
      coins_50: function(d) { return d.coinsEarned >= 50; },
      level_5: function(d) { return d.overallLevel >= 5; },
      gym_1: function(d) { return d.totalWorkouts >= 1; },
      sphere_xp: function(d) { return d.activeSpheres >= 1; },
      early_bird: function(d) { return d.earlyTask; },
      number_67: function(d) { return d.totalTasks === 67; },
      clothing_78: function(d) { return d.totalTasks >= 8; }, // Simplified
      tasks_50: function(d) { return d.totalTasks >= 50; },
      temshik: function(d) { return d.coinsEarned >= 1000; },
      surgut: function(d) { return d.totalWorkouts >= 10; },
      technik: function(d) { return d.totalPurchases >= 10; },
      skuf: function(d) { return daysSinceGym >= 30; },
      hours_20: function(d) { return d.totalMinutes >= 1200; },
      days_7: function(d) { return d.totalDays >= 7; },
      level_15: function(d) { return d.overallLevel >= 15; },
      all_spheres: function(d) { return d.activeSpheres >= d.totalSpheres; },
      habit_7: function(d) { return d.totalDays >= 7; },
      svo: function(d) { return d.hardStreak; },
      borov: function(d) { return d.coinsEarned >= 5000; },
      mamont: function(d) { return (d.coinsEarned - d.coinBalance) >= 5000; },
      mamkin_investor: function(d) { return d.finBalance >= 10000; },
      dedinsight: function(d) { return d.nightTask; },
      sigma: function(d) { return d.totalWorkouts >= 50; },
      tasks_300: function(d) { return d.totalTasks >= 300; },
      hours_100: function(d) { return d.totalMinutes >= 6000; },
      days_60: function(d) { return d.totalDays >= 60; },
      all_spheres_5: function(d) { var m = true; for(var k in d.sphereLevels) if(d.sphereLevels[k] < 5) m = false; return m; },
      river_walker: function(d) { return d.totalMinutes >= 30000; },
      gigachad: function(d) { return d.totalWorkouts >= 100; },
      moms_friend_son: function(d) { var m = true; for(var k in d.sphereLevels) if(d.sphereLevels[k] < 10) m = false; return m; },
      chinazes: function(d) { return d.totalTasks >= 1000; },
      tasks_500: function(d) { return d.totalTasks >= 500; },
      days_365: function(d) { return d.totalDays >= 365; },
      level_75: function(d) { return d.overallLevel >= 75; },
      capitalist: function(d) { return d.finBalance >= 100000; },
      tasks_5000: function(d) { return d.totalTasks >= 5000; },
      level_100: function(d) { return d.overallLevel >= 100; },
      billionaire: function(d) { return d.coinsEarned >= 100000; },
      perfectionist: function(d) { var m = true; for(var k in d.sphereLevels) if(d.sphereLevels[k] < 50) m = false; return m; }
    };
    for (var j = 0; j < ACHIEVEMENT_DEFS.length; j++) {
      var a = ACHIEVEMENT_DEFS[j];
      if (achievements.unlocked[a.id]) continue;
      if (checker[a.id] && checker[a.id](d)) { achievements.unlocked[a.id] = new Date().toISOString(); newUnlocks.push(a); if (a.bonus) earnCoins(a.bonus, 'Награда: ' + a.name); }
    }
    if (newUnlocks.length > 0) { storeSet('achievements_v1', achievements); window.dispatchEvent(new CustomEvent('achievement-unlocked', { detail: newUnlocks })); }
    return achievements;
  }

  function unlockManualAchievement(id, name, icon) {
    var achievements = getAchievements();
    if (!achievements.unlocked[id]) { achievements.unlocked[id] = new Date().toISOString(); if (!achievements.custom) achievements.custom = []; achievements.custom.push({ id: id, name: name, icon: icon || '🏅', date: new Date().toISOString() }); storeSet('achievements_v1', achievements); window.dispatchEvent(new CustomEvent('achievement-unlocked', { detail: [{ id: id, name: name, icon: icon }] })); }
    return achievements;
  }

  function getProfile() { return storeGet('profile_v1') || { name: 'Игрок', avatar: '🧑‍💻' }; }
  function setProfile(data) { storeSet('profile_v1', data); window.dispatchEvent(new CustomEvent('gamification-update')); }

  window.Gamification = {
    SPHERES: SPHERES, getSphereDefs: getSphereDefs, setSphereDefs: setSphereDefs, renameSphere: renameSphere, addSphere: addSphere, removeSphere: removeSphere,
    MAX_LEVEL: MAX_LEVEL, DIFFICULTY_COIN_MULT: DIFFICULTY_COIN_MULT, DIFFICULTY_LABELS: DIFFICULTY_LABELS, ACHIEVEMENT_DEFS: ACHIEVEMENT_DEFS,
    xpForLevel: xpForLevel, getLevelInfo: getLevelInfo, getOverallLevel: getOverallLevel, getSpheres: getSpheres, addXpToSphere: addXpToSphere,
    getCoins: getCoins, earnCoins: earnCoins, spendCoins: spendCoins, getStore: getStore, purchaseReward: purchaseReward, addReward: addReward, removeReward: removeReward,
    completeTask: completeTask, getTotalStats: getTotalStats, getTimerState: getTimerState, startTimer: startTimer, stopTimer: stopTimer,
    getActivityLog: getActivityLog, getAchievements: getAchievements, checkAchievements: checkAchievements, unlockManualAchievement: unlockManualAchievement,
    getProfile: getProfile, setProfile: setProfile, storeGet: storeGet, storeSet: storeSet,
  };
})();
