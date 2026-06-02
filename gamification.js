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
    // --- COMMON (Обычные) 🥉 ---
    { id: 'first_task', rarity: 'common', bonus: 10, name: 'Первый шаг', icon: '🌱', desc: 'Выполни первую задачу' },
    { id: 'tasks_5', rarity: 'common', bonus: 15, name: 'Начало пути', icon: '👣', desc: 'Выполни 5 задач' },
    { id: 'tasks_10', rarity: 'common', bonus: 25, name: 'Разогрев', icon: '🔥', desc: 'Выполни 10 задач' },
    { id: 'hours_1', rarity: 'common', bonus: 20, name: 'Час пользы', icon: '⏱️', desc: '1 час в фокусе' },
    { id: 'hours_5', rarity: 'common', bonus: 50, name: 'Пятилетка', icon: '🕒', desc: '5 часов продуктивности' },
    { id: 'days_3', rarity: 'common', bonus: 30, name: 'Стабильность', icon: '📅', desc: '3 активных дня' },
    { id: 'coins_50', rarity: 'common', bonus: 20, name: 'Мелочь', icon: '🪙', desc: 'Заработай 50 монет' },
    { id: 'coins_200', rarity: 'common', bonus: 40, name: 'Копилка', icon: '💰', desc: 'Набери 200 монет' },
    { id: 'level_3', rarity: 'common', bonus: 30, name: 'Растем', icon: '🎯', desc: 'Достигни 3 уровня' },
    { id: 'level_5', rarity: 'common', bonus: 50, name: 'Новичок+', icon: '🏅', desc: 'Достигни 5 уровня' },
    { id: 'gym_1', rarity: 'common', bonus: 30, name: 'Спортсмен', icon: '💪', desc: 'Первая тренировка' },
    { id: 'gym_3', rarity: 'common', bonus: 50, name: 'В форме', icon: '🏋️', desc: '3 тренировки' },
    { id: 'finance_1', rarity: 'common', bonus: 20, name: 'Счетовод', icon: '📊', desc: 'Первая запись в финансах' },
    { id: 'sphere_xp', rarity: 'common', bonus: 15, name: 'Первый опыт', icon: '✨', desc: 'Получи XP в любой сфере' },
    { id: 'early_bird', rarity: 'common', bonus: 15, name: 'Утренняя пташка', icon: '☀️', desc: 'Задача до 9:00' },

    // --- RARE (Редкие) 🥈 ---
    { id: 'tasks_50', rarity: 'rare', bonus: 100, name: 'В ритме', icon: '🌟', desc: '50 выполненных задач' },
    { id: 'tasks_75', rarity: 'rare', bonus: 150, name: 'Специалист', icon: '🛠️', desc: '75 выполненных задач' },
    { id: 'hours_20', rarity: 'rare', bonus: 200, name: 'Сутки пользы', icon: '⏳', desc: '24 часа чистого времени' },
    { id: 'hours_40', rarity: 'rare', bonus: 300, name: 'Трудоголик', icon: '👔', desc: '40 часов в фокусе' },
    { id: 'days_7', rarity: 'rare', bonus: 150, name: 'Недельный стрик', icon: '📆', desc: '7 активных дней подряд' },
    { id: 'days_14', rarity: 'rare', bonus: 300, name: 'Две недели', icon: '🌓', desc: '14 активных дней' },
    { id: 'coins_500', rarity: 'rare', bonus: 100, name: 'Состоятельный', icon: '💎', desc: 'Заработай 500 монет' },
    { id: 'coins_1000', rarity: 'rare', bonus: 200, name: 'Богач', icon: '💸', desc: 'Набери 1000 монет' },
    { id: 'level_10', rarity: 'rare', bonus: 250, name: 'Десятка', icon: '🎖️', desc: 'Достигни 10 уровня' },
    { id: 'level_15', rarity: 'rare', bonus: 350, name: 'Профи', icon: '🌟', desc: 'Достигни 15 уровня' },
    { id: 'gym_10', rarity: 'rare', bonus: 200, name: 'Атлет', icon: '🏃', desc: '10 тренировок' },
    { id: 'gym_streak', rarity: 'rare', bonus: 150, name: 'Режим', icon: '🔋', desc: '3 тренировки за неделю' },
    { id: 'all_spheres', rarity: 'rare', bonus: 100, name: 'Универсал', icon: '🌈', desc: 'XP во всех сферах' },
    { id: 'store_5', rarity: 'rare', bonus: 80, name: 'Шопоголик', icon: '🛍️', desc: '5 покупок в магазине' },
    { id: 'health_5', rarity: 'rare', bonus: 100, name: 'ЗОЖник', icon: '🍎', desc: '5 уровень в Здоровье' },
    { id: 'finance_5', rarity: 'rare', bonus: 100, name: 'Экономист', icon: '📈', desc: '5 уровень в Финансах' },
    { id: 'career_5', rarity: 'rare', bonus: 100, name: 'Карьерист', icon: '💼', desc: '5 уровень в Карьере' },

    // --- EPIC (Эпические) 🥇 ---
    { id: 'tasks_150', rarity: 'epic', bonus: 400, name: 'Машина', icon: '🤖', desc: '150 выполненных задач' },
    { id: 'tasks_300', rarity: 'epic', bonus: 700, name: 'Неудержимый', icon: '🚀', desc: '300 выполненных задач' },
    { id: 'hours_100', rarity: 'epic', bonus: 800, name: 'Мастер времени', icon: '🌓', desc: '100 часов в фокусе' },
    { id: 'hours_150', rarity: 'epic', bonus: 1200, name: 'Ветеран труда', icon: '🛠️', desc: '150 часов продуктивности' },
    { id: 'days_30', rarity: 'epic', bonus: 600, name: 'Месячный марафон', icon: '🗓️', desc: '30 активных дней' },
    { id: 'days_60', rarity: 'epic', bonus: 1000, name: 'Железная воля', icon: '🛡️', desc: '60 активных дней' },
    { id: 'coins_5000', rarity: 'epic', bonus: 1000, name: 'Миллионер', icon: '🏛️', desc: 'Набери 5000 монет' },
    { id: 'level_25', rarity: 'epic', bonus: 1500, name: 'Четверть пути', icon: '👑', desc: 'Достигни 25 уровня' },
    { id: 'level_40', rarity: 'epic', bonus: 2000, name: 'Элита', icon: '💎', desc: 'Достигни 40 уровня' },
    { id: 'gym_30', rarity: 'epic', bonus: 600, name: 'Бодибилдер', icon: '🏋️‍♂️', desc: '30 тренировок' },
    { id: 'finance_master', rarity: 'epic', bonus: 500, name: 'Инвестор', icon: '💹', desc: '15 уровень в Финансах' },
    { id: 'career_master', rarity: 'epic', bonus: 500, name: 'Директор', icon: '🏢', desc: '15 уровень в Карьере' },
    { id: 'growth_master', rarity: 'epic', bonus: 500, name: 'Мудрец', icon: '🧙‍♂️', desc: '15 уровень в Развитии' },
    { id: 'pomo_master', rarity: 'epic', bonus: 300, name: 'Помидорный маг', icon: '🍅', desc: 'Использовал таймер 50 раз' },
    { id: 'night_owl', rarity: 'epic', bonus: 100, name: 'Ночной дозор', icon: '🦉', desc: 'Задача после 00:00' },

    // --- LEGENDARY (Легендарные) 💎 ---
    { id: 'tasks_500', rarity: 'legendary', bonus: 2000, name: 'Сверхчеловек', icon: '⚡', desc: '500 выполненных задач' },
    { id: 'tasks_1000', rarity: 'legendary', bonus: 5000, name: 'АБСОЛЮТ', icon: '🏛️', desc: '1000 выполненных задач' },
    { id: 'hours_500', rarity: 'legendary', bonus: 4000, name: 'Повелитель времени', icon: '⏳', desc: '500 часов в фокусе' },
    { id: 'days_100', rarity: 'legendary', bonus: 3000, name: 'Стодневник', icon: '🏆', desc: '100 активных дней' },
    { id: 'days_365', rarity: 'legendary', bonus: 10000, name: 'Год жизни', icon: '🌍', desc: '365 активных дней' },
    { id: 'coins_25000', rarity: 'legendary', bonus: 5000, name: 'Золотой фонд', icon: '🏺', desc: 'Набери 25000 монет' },
    { id: 'level_75', rarity: 'legendary', bonus: 7000, name: 'Легенда', icon: '🔱', desc: 'Достигни 75 уровня' },
    { id: 'gym_100', rarity: 'legendary', bonus: 2500, name: 'Олимпиец', icon: '🥇', desc: '100 тренировок' },
    { id: 'all_max_lvl', rarity: 'legendary', bonus: 5000, name: 'Магистр сфер', icon: '🔮', desc: '10 уровень во всех сферах' },
    { id: 'streak_30', rarity: 'legendary', bonus: 2000, name: 'Несгораемый', icon: '🧨', desc: 'Стрик активности 30 дней' },

    // --- ADDITIONAL (Extra) ---
    { id: 'gym_50', rarity: 'epic', bonus: 1000, name: 'Геракл', icon: '🏺', desc: '50 тренировок завершено' },
    { id: 'finance_balance_1000', rarity: 'rare', bonus: 200, name: 'Первый капитал', icon: '💵', desc: 'Баланс финансов > 1000' },
    { id: 'finance_balance_10000', rarity: 'epic', bonus: 1000, name: 'Инвестор', icon: '📈', desc: 'Баланс финансов > 10000' },
    { id: 'finance_balance_100000', rarity: 'legendary', bonus: 5000, name: 'Капиталист', icon: '🏦', desc: 'Баланс финансов > 100000' },
    { id: 'task_spree_10', rarity: 'rare', bonus: 100, name: 'Спринтер', icon: '🏃‍♂️', desc: '10 задач за один день' },
    { id: 'task_spree_20', rarity: 'epic', bonus: 300, name: 'Марафонец', icon: '🏁', desc: '20 задач за один день' },
    { id: 'pomo_100', rarity: 'legendary', bonus: 1500, name: 'Дзен', icon: '🧘', desc: '100 сессий таймера' },
    { id: 'pomo_500', rarity: 'mythic', bonus: 10000, name: 'Абсолютный фокус', icon: '🧿', desc: '500 сессий таймера' },
    { id: 'all_spheres_5', rarity: 'epic', bonus: 800, name: 'Разносторонний', icon: '💠', desc: '5 уровень во всех сферах' },
    { id: 'night_owl_3', rarity: 'rare', bonus: 100, name: 'Полуночник', icon: '🌑', desc: '3 задачи ночью' },
    { id: 'early_bird_10', rarity: 'rare', bonus: 200, name: 'Жаворонок', icon: '🌄', desc: '10 задач ранним утром' },
    { id: 'gym_variety', rarity: 'rare', bonus: 150, name: 'Многоборец', icon: '🏟️', desc: 'Тренировки в 3 разных залах' },
    { id: 'habit_7', rarity: 'rare', bonus: 100, name: 'Привычка', icon: '🔄', desc: '7 дней подряд одна сфера' },
    { id: 'big_spender', rarity: 'epic', bonus: 500, name: 'Магнат', icon: '🥂', desc: 'Потрачено 5000 монет' },
    { id: 'saver', rarity: 'epic', bonus: 500, name: 'Скряга', icon: '🔒', desc: 'Баланс монет > 2000' },
    ];
    // --- MYTHIC (Мифические) 💀 ---
    { id: 'tasks_5000', rarity: 'mythic', bonus: 25000, name: 'Творец миров', icon: '🌌', desc: '5000 выполненных задач' },
    { id: 'hours_2000', rarity: 'mythic', bonus: 50000, name: 'Вне времени', icon: '🌀', desc: '2000 часов продуктивности' },
    { id: 'level_100', rarity: 'mythic', bonus: 100000, name: 'БОЖЕСТВО', icon: '🪐', desc: 'Достигни 100 уровня' },
    { id: 'billionaire', rarity: 'mythic', bonus: 100000, name: 'Властелин богатства', icon: '♾️', desc: 'Заработай 100к монет' },
    { id: 'perfectionist', rarity: 'mythic', bonus: 20000, name: 'Перфекционист', icon: '💎', desc: 'Все сферы на 50 уровне' },
  ];

  function getAchievements() {
    return storeGet('achievements_v1') || { unlocked: {} };
  }

  function checkAchievements() {
    var stats = getTotalStats();
    var coins = getCoins();
    var spheres = getSpheres();
    var overall = getLevelInfo(0); 
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
    var log = getActivityLog();
    
    // Custom check for "early bird" and "night owl"
    var lastTaskDate = localStorage.getItem('_last_task_date') || new Date().toISOString();
    var taskHour = new Date(lastTaskDate).getHours();

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
      earlyTask: taskHour >= 4 && taskHour < 9,
      nightTask: taskHour >= 0 && taskHour < 4,
      pomoCount: log.length
    };

    var achievements = getAchievements();
    var newUnlocks = [];

    var checker = {
        first_task: function(d) { return d.totalTasks >= 1; },
        tasks_5: function(d) { return d.totalTasks >= 5; },
        tasks_10: function(d) { return d.totalTasks >= 10; },
        tasks_50: function(d) { return d.totalTasks >= 50; },
        tasks_75: function(d) { return d.totalTasks >= 75; },
        tasks_150: function(d) { return d.totalTasks >= 150; },
        tasks_300: function(d) { return d.totalTasks >= 300; },
        tasks_500: function(d) { return d.totalTasks >= 500; },
        tasks_1000: function(d) { return d.totalTasks >= 1000; },
        tasks_5000: function(d) { return d.totalTasks >= 5000; },
        hours_1: function(d) { return d.totalMinutes >= 60; },
        hours_5: function(d) { return d.totalMinutes >= 300; },
        hours_20: function(d) { return d.totalMinutes >= 1200; },
        hours_40: function(d) { return d.totalMinutes >= 2400; },
        hours_100: function(d) { return d.totalMinutes >= 6000; },
        hours_150: function(d) { return d.totalMinutes >= 9000; },
        hours_500: function(d) { return d.totalMinutes >= 30000; },
        hours_2000: function(d) { return d.totalMinutes >= 120000; },
        days_3: function(d) { return d.totalDays >= 3; },
        days_7: function(d) { return d.totalDays >= 7; },
        days_14: function(d) { return d.totalDays >= 14; },
        days_30: function(d) { return d.totalDays >= 30; },
        days_60: function(d) { return d.totalDays >= 60; },
        days_100: function(d) { return d.totalDays >= 100; },
        days_365: function(d) { return d.totalDays >= 365; },
        coins_50: function(d) { return d.coinsEarned >= 50; },
        coins_200: function(d) { return d.coinsEarned >= 200; },
        coins_500: function(d) { return d.coinsEarned >= 500; },
        coins_1000: function(d) { return d.coinsEarned >= 1000; },
        coins_5000: function(d) { return d.coinsEarned >= 5000; },
        coins_25000: function(d) { return d.coinsEarned >= 25000; },
        billionaire: function(d) { return d.coinsEarned >= 100000; },
        level_3: function(d) { return d.overallLevel >= 3; },
        level_5: function(d) { return d.overallLevel >= 5; },
        level_10: function(d) { return d.overallLevel >= 10; },
        level_15: function(d) { return d.overallLevel >= 15; },
        level_25: function(d) { return d.overallLevel >= 25; },
        level_40: function(d) { return d.overallLevel >= 40; },
        level_75: function(d) { return d.overallLevel >= 75; },
        level_100: function(d) { return d.overallLevel >= 100; },
        gym_1: function(d) { return d.totalWorkouts >= 1; },
        gym_3: function(d) { return d.totalWorkouts >= 3; },
        gym_10: function(d) { return d.totalWorkouts >= 10; },
        gym_30: function(d) { return d.totalWorkouts >= 30; },
        gym_100: function(d) { return d.totalWorkouts >= 100; },
        finance_1: function(d) { return d.sphereLevels['finance'] >= 1; },
        finance_5: function(d) { return d.sphereLevels['finance'] >= 5; },
        finance_master: function(d) { return d.sphereLevels['finance'] >= 15; },
        career_5: function(d) { return d.sphereLevels['career'] >= 5; },
        career_master: function(d) { return d.sphereLevels['career'] >= 15; },
        health_5: function(d) { return d.sphereLevels['health'] >= 5; },
        growth_master: function(d) { return d.sphereLevels['growth'] >= 15; },
        all_spheres: function(d) { return d.activeSpheres >= d.totalSpheres; },
        all_max_lvl: function(d) { 
            var allMax = true;
            for(var k in d.sphereLevels) if(d.sphereLevels[k] < 10) allMax = false;
            return allMax;
        },
        perfectionist: function(d) {
            var allMax = true;
            for(var k in d.sphereLevels) if(d.sphereLevels[k] < 50) allMax = false;
            return allMax;
        },
        store_5: function(d) { return d.totalPurchases >= 5; },
        early_bird: function(d) { return d.earlyTask; },
        night_owl: function(d) { return d.nightTask; },
        pomo_master: function(d) { return d.pomoCount >= 50; },
        sphere_xp: function(d) { return d.activeSpheres >= 1; }
    };

    for (var j = 0; j < ACHIEVEMENT_DEFS.length; j++) {
      var a = ACHIEVEMENT_DEFS[j];
      if (achievements.unlocked[a.id]) continue;
      
      var canUnlock = checker[a.id] ? checker[a.id](checkData) : false;
      if (canUnlock) {
        achievements.unlocked[a.id] = new Date().toISOString();
        newUnlocks.push(a);
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
