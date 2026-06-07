(function () {
  'use strict';

  // --- Juice (Sounds & Haptic) ---
  var Juice = {
    ctx: null,
    isLock: false,
    init: function() { 
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === 'suspended') this.ctx.resume();
    },
    vibrate: function(ms) { if (navigator.vibrate) navigator.vibrate(ms || 10); },
    
    lock: function(ms) {
        this.isLock = true;
        setTimeout(() => { this.isLock = false; }, ms || 500);
    },

    playSuccess: function(force) {
      if (this.isLock && !force) return;
      this.init(); this.lock(300);
      var osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(900, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.15, this.ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.15);
      osc.connect(gain); gain.connect(this.ctx.destination);
      osc.start(); osc.stop(this.ctx.currentTime + 0.15); this.vibrate(10);
    },

    playAchievement: function() {
      this.init(); this.lock(1000); 
      [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => {
        var osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = f;
        gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + i * 0.08 + 0.04);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + i * 0.08 + 0.3);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(this.ctx.currentTime + i * 0.08); osc.stop(this.ctx.currentTime + i * 0.08 + 0.3);
      });
      this.vibrate([30, 50, 30]);
    },

    playWater: function() {
        if (this.isLock) return;
        this.init(); this.lock(200);
        var osc = this.ctx.createOscillator(), gain = this.ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(400, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.05);
        gain.gain.setValueAtTime(0, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + 0.01);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
        osc.connect(gain); gain.connect(this.ctx.destination);
        osc.start(); osc.stop(this.ctx.currentTime + 0.1); this.vibrate(5);
    }
  };

  // --- Security: HTML Escaping ---
  function escapeHTML(str) {
    if (!str || typeof str !== 'string') return str;
    var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return str.replace(/[&<>"']/g, function(m) { return map[m]; });
  }

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
    for(var i=0;i<SPHERES.length;i++){ if(SPHERES[i].id===id){ if(newName) SPHERES[i].name = newName; if(newIcon) SPHERES[i].icon = newIcon; break; } }
    setSphereDefs(SPHERES);
  }
  function addSphere(name, icon){
    var id = 's_'+Date.now(), color = SPHERE_COLORS[SPHERES.length % SPHERE_COLORS.length];
    SPHERES.push({id:id, name:name, icon:icon||'🔵', color:color});
    setSphereDefs(SPHERES); return id;
  }
  function removeSphere(id){ SPHERES = SPHERES.filter(function(s){ return s.id !== id; }); setSphereDefs(SPHERES); }

  var MAX_LEVEL = 999, XP_BASE = 100, XP_EXPONENT = 1.5;
  var DIFFICULTY_COIN_MULT = { easy: 0.1, medium: 0.2, hard: 0.4 };
  var DIFFICULTY_LABELS = { easy: 'Лёгкая', medium: 'Средняя', hard: 'Сложная' };

  function xpForLevel(level) { if (level >= MAX_LEVEL) return Infinity; return Math.floor(XP_BASE * Math.pow(level, XP_EXPONENT)); }
  function getLevelInfo(totalXp) {
    var level = 1, xpUsed = 0;
    while (level < MAX_LEVEL) {
      var needed = xpForLevel(level);
      if (xpUsed + needed > totalXp) return { level: level, xpInLevel: totalXp - xpUsed, xpNeeded: needed, totalXp: totalXp };
      xpUsed += needed; level++;
    }
    return { level: MAX_LEVEL, xpInLevel: 0, xpNeeded: 0, totalXp: totalXp };
  }

  function getOverallLevel(spheresData) {
    var totalXp = 0;
    for (var i = 0; i < SPHERES.length; i++) totalXp += (spheresData[SPHERES[i].id] || { xp: 0 }).xp;
    return getLevelInfo(totalXp);
  }

  function storeGet(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }
  function notifyDataChanged(key) { try { window.dispatchEvent(new CustomEvent('dashboard-data-changed', { detail: { key: key } })); } catch (e) {} }
  function storeSet(key, value) { localStorage.setItem(key, JSON.stringify(value)); notifyDataChanged(key); }
  function getSpheres() { return storeGet('spheres_v1') || {}; }
  function addXpToSphere(sphereId, amount) { var data = getSpheres(); if (!data[sphereId]) data[sphereId] = { xp: 0 }; data[sphereId].xp = Math.max(0, data[sphereId].xp + amount); storeSet('spheres_v1', data); return data; }
  function getCoins() { return storeGet('coins_v1') || { balance: 0, earned: 0, spent: 0, history: [] }; }

  function earnCoins(amount, reason, silent) {
    var data = getCoins(); data.balance += amount; data.earned += amount;
    data.history.unshift({ amount: amount, type: 'earn', reason: reason, date: new Date().toISOString() });
    if (data.history.length > 200) data.history.length = 200;
    storeSet('coins_v1', data);
    if (!silent) Juice.playSuccess(); 
    return data;
  }

  function spendCoins(amount, reason, force) {
    var data = getCoins(); if (!force && data.balance < amount) return null;
    data.balance = data.balance - amount; data.spent += amount;
    data.history.unshift({ amount: amount, type: 'spend', reason: reason, date: new Date().toISOString() });
    if (data.history.length > 200) data.history.length = 200;
    storeSet('coins_v1', data); return data;
  }

  var DEFAULT_REWARDS = [
    { id: 'series_1h',     name: '1 час сериала',         price: 50,  icon: '📺', expiresIn: 12 },
    { id: 'gaming_1h',     name: '1 час игр',             price: 50,  icon: '🎮', expiresIn: 12 },
    { id: 'junk_food',     name: 'Фастфуд',               price: 80,  icon: '🍕', expiresIn: 6 },
    { id: 'sleep_in',      name: 'Поспать подольше',       price: 30,  icon: '😴', expiresIn: 18 },
    { id: 'shopping',      name: 'Покупка до 1000₽',      price: 150, icon: '🛍️', expiresIn: 24 },
    { id: 'day_off',       name: 'Выходной без дел',       price: 300, icon: '🏖️', expiresIn: 24 },
    { id: 'social_scroll', name: '30 мин соцсети',         price: 20,  icon: '📱', expiresIn: 4 },
    { id: 'coffee_break',  name: 'Вкусный кофе',           price: 25,  icon: '☕', expiresIn: 4 },
    { id: 'pizza_night',   name: 'Пицца-вечер',            price: 100, icon: '🍕', expiresIn: 8 },
    { id: 'movie_theater', name: 'Поход в кино',           price: 120, icon: '🍿', expiresIn: 24 },
    { id: 'music_relax',   name: '30 мин музыки',          price: 15,  icon: '🎧', expiresIn: 4 },
    { id: 'book_time',     name: '1 час чтения',           price: 30,  icon: '📖', expiresIn: 12 },
    { id: 'dessert',       name: 'Десерт',                 price: 40,  icon: '🍰', expiresIn: 6 },
    { id: 'walk_park',     name: 'Прогулка в парке',       price: 20,  icon: '🌳', expiresIn: 8 },
    { id: 'hobby_hour',    name: '1 час хобби',            price: 40,  icon: '🎨', expiresIn: 12 },
    { id: 'spa_bath',      name: 'Горячая ванна/Спа',      price: 35,  icon: '🛁', expiresIn: 6 },
    { id: 'expensive_buy', name: 'Крупная покупка',        price: 500, icon: '💎', expiresIn: 48 },
    { id: 'vacation_day',  name: 'День отпуска',           price: 800, icon: '✈️', expiresIn: 72 },
    { id: 'rest_evening',  name: 'Вечер без гаджетов',     price: 50,  icon: '🕯️', expiresIn: 12 },
    { id: 'fast_food_2',   name: 'Мороженое',              price: 20,  icon: '🍦', expiresIn: 4 },
    { id: 'concert_tick',  name: 'Билет на концерт',       price: 400, icon: '🎸', expiresIn: 168 },
    { id: 'sushi_time',    name: 'Суши/Роллы',             price: 130, icon: '🍣', expiresIn: 8 },
    { id: 'drink_wine',    name: 'Бокал вина',             price: 60,  icon: '🍷', expiresIn: 6 },
    { id: 'new_app',       name: 'Платное приложение',      price: 70,  icon: '📱', expiresIn: 24 },
    { id: 'nice_dinner',   name: 'Ужин в ресторане',       price: 250, icon: '🍽️', expiresIn: 12 },
  ];

  function getStore() { 
    var data = storeGet('store_v2'); 
    if (!data) {
        var old = storeGet('store_v1') || { rewards: [], purchases: [] };
        data = { customRewards: old.rewards || [], catalogOverrides: {}, hiddenCatalogIds: [], purchases: old.purchases || [] };
    }
    if (!data.hiddenCatalogIds) data.hiddenCatalogIds = [];

    // Mix catalog with overrides and filter hidden
    var catalog = DEFAULT_REWARDS.filter(function(r) {
        return data.hiddenCatalogIds.indexOf(r.id) === -1;
    }).map(function(r) {
        var item = Object.assign({}, r);
        if (data.catalogOverrides && data.catalogOverrides[r.id]) {
            item.price = data.catalogOverrides[r.id];
        }
        return item;
    });
    return { catalog: catalog, customRewards: data.customRewards, purchases: data.purchases, catalogOverrides: data.catalogOverrides || {}, hiddenCatalogIds: data.hiddenCatalogIds };
  }

  function setCatalogPrice(rewardId, newPrice) {
    var data = storeGet('store_v2');
    if (!data) {
        var old = storeGet('store_v1') || { rewards: [], purchases: [] };
        data = { customRewards: old.rewards || [], catalogOverrides: {}, hiddenCatalogIds: [], purchases: old.purchases || [] };
    }
    data.catalogOverrides[rewardId] = newPrice;
    storeSet('store_v2', data);
  }

  function purchaseReward(rewardId) {
    var storeData = getStore();
    var allItems = storeData.catalog.concat(storeData.customRewards);
    var reward = allItems.find(function(it) { return it.id === rewardId; });
    if (!reward) return null;
    
    var coins = spendCoins(reward.price, reward.name);
    if (!coins) return null;
    
    var data = storeGet('store_v2');
    if (!data) data = { customRewards: storeData.customRewards, catalogOverrides: storeData.catalogOverrides, purchases: storeData.purchases };
    
    // Add expiration
    var expiresAt = null;
    var hours = reward.expiresIn || 24; 
    expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

    data.purchases.unshift({ 
      id: 'pur_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      rewardId: rewardId, 
      name: reward.name, 
      price: reward.price, 
      icon: reward.icon,
      date: new Date().toISOString(),
      expiresAt: expiresAt
    });
    if (data.purchases.length > 200) data.purchases.length = 200;
    storeSet('store_v2', data);
    
    setTimeout(checkAchievements, 100);
    return { coins: coins, store: data };
  }

  function refundReward(purchaseId) {
    var data = storeGet('store_v2');
    if (!data || !data.purchases) return null;
    
    var idx = -1;
    for(var i=0; i<data.purchases.length; i++) {
        if(data.purchases[i].id === purchaseId) { idx = i; break; }
    }
    if (idx === -1) return null;
    
    var purchase = data.purchases[idx];
    earnCoins(purchase.price, 'Возврат: ' + purchase.name, true);
    data.purchases.splice(idx, 1);
    storeSet('store_v2', data);
    return data;
  }

  function addReward(name, price, icon) { 
    var storeData = getStore();
    var id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    var data = storeGet('store_v2');
    if (!data) data = { customRewards: storeData.customRewards, catalogOverrides: storeData.catalogOverrides, purchases: storeData.purchases };
    data.customRewards.push({ id: id, name: name, price: price, icon: icon || '🎁', expiresIn: 24 });
    storeSet('store_v2', data);
    return data;
  }

  function removeReward(rewardId) { 
    var storeData = getStore();
    var data = storeGet('store_v2');
    if (!data) data = { customRewards: storeData.customRewards, catalogOverrides: storeData.catalogOverrides, hiddenCatalogIds: [], purchases: storeData.purchases };
    
    var isCatalog = DEFAULT_REWARDS.some(function(it) { return it.id === rewardId; });
    
    if (isCatalog) {
        if (!data.hiddenCatalogIds) data.hiddenCatalogIds = [];
        if (data.hiddenCatalogIds.indexOf(rewardId) === -1) {
            data.hiddenCatalogIds.push(rewardId);
        }
    } else {
        data.customRewards = data.customRewards.filter(function (r) { return r.id !== rewardId; });
    }
    
    storeSet('store_v2', data);
    return data;
  }

  function completeTask(sphereId, difficulty, actualMinutes) {
    var diff = difficulty || 'medium', mins = actualMinutes || 15, xp = mins;
    var mult = DIFFICULTY_COIN_MULT[diff] || 0.2;
    var coins = Math.max(1, Math.floor(mins * mult));
    var sphere = SPHERES.find(function (s) { return s.id === sphereId; });
    earnCoins(coins, 'Задача (' + (sphere ? sphere.name : 'без сектора') + ')');
    if (sphere) addXpToSphere(sphereId, xp);
    addTotalStats(mins, 1);
    localStorage.setItem('_last_task_date', new Date().toISOString());
    checkAchievements();
    window.dispatchEvent(new CustomEvent('gamification-update'));
    return { coins: coins, xp: xp };
  }

  function getTotalStats() { return storeGet('total_stats_v1') || { totalMinutes: 0, totalTasks: 0, totalDays: 0, firstDay: null }; }

  function addTotalStats(minutes, tasks) {
    var stats = getTotalStats();
    stats.totalMinutes += minutes; stats.totalTasks += tasks;
    if (!stats.firstDay) stats.firstDay = new Date().toISOString();
    var today = new Date().toISOString().slice(0, 10);
    if (stats.lastActiveDay !== today) { stats.totalDays = (stats.totalDays || 0) + 1; stats.lastActiveDay = today; }
    storeSet('total_stats_v1', stats);
    return stats;
  }

  function getTimerState() { return storeGet('timer_v1') || { running: false, sphereId: null, startTime: null, label: '' }; }
  function startTimer(sphereId, label) { var state = { running: true, sphereId: sphereId, startTime: Date.now(), label: label || '' }; storeSet('timer_v1', state); window.dispatchEvent(new CustomEvent('timer-update')); return state; }

  function stopTimer() {
    var state = getTimerState(); if (!state.running) return null;
    var elapsed = Math.round((Date.now() - state.startTime) / 60000); if (elapsed < 1) elapsed = 1;
    state.running = false; storeSet('timer_v1', state);
    var log = getActivityLog(); log.unshift({ label: state.label, sphereId: state.sphereId, startTime: new Date(state.startTime).toISOString(), endTime: new Date().toISOString(), minutes: elapsed });
    if (log.length > 500) log.length = 500;
    storeSet('activity_log_v1', log);
    if (state.sphereId) {
      addXpToSphere(state.sphereId, elapsed);
      var timerCoins = Math.max(1, Math.floor(elapsed * DIFFICULTY_COIN_MULT['medium']));
      earnCoins(timerCoins, 'Таймер: ' + (state.label || state.sphereId));
      addTotalStats(elapsed, 0);
    }
    checkAchievements(); window.dispatchEvent(new CustomEvent('gamification-update')); window.dispatchEvent(new CustomEvent('timer-update'));
    return { minutes: elapsed, sphereId: state.sphereId };
  }

  function getActivityLog() { return storeGet('activity_log_v1') || []; }

  var ACHIEVEMENT_DEFS = [
    { id: 'first_task', rarity: 'common', bonus: 2, name: 'База', icon: '🌱', desc: 'Ну типа начал что-то делать, а не только в потолок плевать.', req: 'Выполни первую задачу' },
    { id: 'altushka', rarity: 'common', bonus: 5, name: 'Альтушка с госуслуг', icon: '👩‍🎤', desc: 'Купил какую-то херню в магазине. Надеюсь, оно того стоило.', req: 'Первая покупка в магазине' },
    { id: 'tasks_10', rarity: 'common', bonus: 8, name: 'Разогрев', icon: '🔥', desc: 'Уже 10 задач? Ну ты прям стахановец, ебать.', req: 'Выполни 10 задач' },
    { id: 'hours_1', rarity: 'common', bonus: 4, name: 'Час пользы', icon: '⏱️', desc: 'Целый час не втыкал в мемы. Респект.', req: '1 час в фокусе' },
    { id: 'days_3', rarity: 'common', bonus: 10, name: 'Стабильность', icon: '📅', desc: 'Три дня подряд заходил. Глядишь, и человеком станешь.', req: '3 активных дня' },
    { id: 'coins_50', rarity: 'common', bonus: 5, name: 'Мелочь', icon: '🪙', desc: '50 монет накопил. На дошик хватит.', req: 'Заработай 50 монет' },
    { id: 'level_5', rarity: 'common', bonus: 15, name: 'Новичок+', icon: '🏅', desc: '5 уровень. Уже не полный нуб, но всё еще лох.', req: 'Достигни 5 уровня' },
    { id: 'gym_1', rarity: 'common', bonus: 6, name: 'Спортсмен', icon: '💪', desc: 'Один раз сходил в зал и уже думаешь, что Арнольд?', req: 'Первая тренировка' },
    { id: 'sphere_xp', rarity: 'common', bonus: 3, name: 'Первый опыт', icon: '✨', desc: 'ХР капнуло. Приятно, как первый секс (наверное).', req: 'Получи XP в любой сфере' },
    { id: 'early_bird', rarity: 'common', bonus: 5, name: 'Кто понял жизнь...', icon: '☀️', desc: 'Встал рано, сделал дело. Иди поспи теперь.', req: 'Задача до 9:00' },
    { id: 'number_67', rarity: 'common', bonus: 25, name: '67', icon: '🎰', desc: 'Рандомное число, как и твоя жизнь.', req: 'Выполни ровно 67 задач' },
    { id: 'clothing_78', rarity: 'common', bonus: 10, name: '7-8 одежда', icon: '👕', desc: '8 задач за день. Ты че, таблеток объелся?', req: 'Выполни 8 задач за день' },

    { id: 'tasks_50', rarity: 'rare', bonus: 20, name: '52', icon: '🏙️', desc: 'В Питере — пить, а ты тут 50 задач херачишь.', req: 'Выполни 50 задач' },
    { id: 'tasks_75', rarity: 'rare', bonus: 25, name: 'Специалист', icon: '🛠️', desc: '75 задач. Походу, ты реально решил взяться за голову.', req: '75 выполненных задач' },
    { id: 'temshik', rarity: 'rare', bonus: 30, name: 'Темщик', icon: '💸', desc: 'Косарь монет. Время мутить серьезные схемы.', req: 'Набери 1000 монет' },
    { id: 'surgut', rarity: 'rare', bonus: 25, name: 'Сургут', icon: '❄️', desc: '10 трень. Мышцы каменные, как сердце твоей бывшей.', req: '10 тренировок' },
    { id: 'technik', rarity: 'rare', bonus: 20, name: 'Техник', icon: '🎧', desc: '10 наград купил. Шопоголик хренов.', req: 'Купи 10 наград' },
    { id: 'skuf', rarity: 'rare', bonus: 1, name: 'Скуф', icon: '🍺', desc: 'Месяц без спорта. Живот уже вырос или еще ждешь?', req: '30 дней без тренировок' },
    { id: 'hours_20', rarity: 'rare', bonus: 30, name: 'Сутки пользы', icon: '⏳', desc: 'Сутки чистого фокуса. Ты вообще моргаешь?', req: '24 часа в фокусе' },
    { id: 'hours_40', rarity: 'rare', bonus: 40, name: 'Трудоголик', icon: '👔', desc: '40 часов. Твоя личная жизнь вышла из чата.', req: '40 часов в фокусе' },
    { id: 'days_7', rarity: 'rare', bonus: 25, name: 'Недельный стрик', icon: '📆', desc: 'Неделя без прогулов. Мамка была бы довольна.', req: '7 активных дней подряд' },
    { id: 'days_14', rarity: 'rare', bonus: 35, name: 'Две недели', icon: '🌓', desc: '14 дней. Ты в ритме, не просри его теперь.', req: '14 активных дней' },
    { id: 'coins_500', rarity: 'rare', bonus: 20, name: 'Состоятельный', icon: '💎', desc: '500 монет. Можно и шикануть (нет).', req: 'Заработай 500 монет' },
    { id: 'level_10', rarity: 'rare', bonus: 30, name: 'Десятка', icon: '🎖️', desc: '10 уровень. Теперь ты официально «среднячок».', req: 'Достигни 10 уровня' },
    { id: 'level_15', rarity: 'rare', bonus: 40, name: 'Профи', icon: '🌟', desc: '15 уровень. Понтов много, толку... тоже много.', req: 'Достигни 15 уровня' },
    { id: 'gym_10', rarity: 'rare', bonus: 30, name: 'Атлет', icon: '🏃', desc: '10 тренировок. Ты че, в натурашку прешь?', req: '10 тренировок' },
    { id: 'gym_streak', rarity: 'rare', bonus: 20, name: 'Режим', icon: '🔋', desc: '3 трени за неделю. Стабильно, как депрессия осенью.', req: '3 тренировки за неделю' },
    { id: 'all_spheres', rarity: 'rare', bonus: 25, name: 'Универсал', icon: '🌈', desc: 'В каждой бочке затычка. Везде по чуть-чуть.', req: 'XP во всех сферах' },
    { id: 'store_5', rarity: 'rare', bonus: 15, name: 'Шопоголик', icon: '🛍️', desc: 'Тратишь монеты быстрее, чем зарабатываешь.', req: '5 покупок в магазине' },
    { id: 'health_5', rarity: 'rare', bonus: 20, name: 'ЗОЖник', icon: '🍎', desc: 'Овсянка по утрам и слезы по вечерам.', req: '5 уровень в Здоровье' },
    { id: 'finance_5', rarity: 'rare', bonus: 20, name: 'Экономист', icon: '📈', desc: 'Считаешь копейки, а мечтаешь о миллионах.', req: '5 уровень в Финансах' },
    { id: 'career_5', rarity: 'rare', bonus: 20, name: 'Карьерист', icon: '💼', desc: 'Готов грызть глотки за повышение (виртуальное).', req: '5 уровень в Карьере' },
    { id: 'night_owl_3', rarity: 'rare', bonus: 15, name: 'Полуночник', icon: '🌑', desc: 'Ночью работаешь, днем спишь. Сосед-наркоман?', req: '3 задачи ночью' },
    { id: 'early_bird_10', rarity: 'rare', bonus: 20, name: 'Овсянка, сэр!', icon: '🌄', desc: '10 раз встал рано. Ты монстр, честное слово.', req: '10 задач ранним утром' },
    { id: 'gym_variety', rarity: 'rare', bonus: 25, name: 'Многоборец', icon: '🏟️', desc: 'Разные дни — разные мучения. Красава.', req: 'Тренировки в 5 днях' },
    { id: 'habit_7', rarity: 'rare', bonus: 20, name: 'Привычка', icon: '🔄', desc: '7 дней. Поздравляю, ты теперь робот.', req: '7 активных дней' },

    { id: 'svo', rarity: 'epic', bonus: 80, name: 'С.В.О.', icon: '🎖️', desc: 'Сверх-Важные Операции. Пиздец как сложно, но ты смог.', req: '5 сложных задач подряд' },
    { id: 'borov', rarity: 'epic', bonus: 120, name: 'Боров', icon: '🐗', desc: '5к монет. Жирный капитал для жирного борова.', req: 'Накопи 5000 монет' },
    { id: 'mamont', rarity: 'epic', bonus: 60, name: 'Мамонт', icon: '🦣', desc: 'Потратил 5к. Лох — не мамонт, лох не вымрет.', req: 'Потрачено 5000 монет' },
    { id: 'mamkin_investor', rarity: 'epic', bonus: 80, name: 'Мамкин инвестор', icon: '📈', desc: 'Баланс 10к. Скоро купишь остров (в Майнкрафте).', req: 'Баланс финансов > 10000' },
    { id: 'dedinsight', rarity: 'epic', bonus: 40, name: 'Дединсайд', icon: '🦉', desc: '3 часа ночи, а ты фигачишь. В душе дед, снаружи инсайд.', req: 'Задача после 00:00' },
    { id: 'sigma', rarity: 'epic', bonus: 100, name: 'Сигма', icon: '🗿', desc: '50 тренировок. Каменный ебальник прилагается.', req: '50 тренировок' },
    { id: 'tasks_150', rarity: 'epic', bonus: 70, name: 'Машина', icon: '🤖', desc: '150 задач. Тебя вообще можно выключить?', req: '150 выполненных задач' },
    { id: 'tasks_300', rarity: 'epic', bonus: 120, name: 'Неудержимый', icon: '🚀', desc: '300 задач. Ты че, бессмертный что ли?', req: '300 выполненных задач' },
    { id: 'hours_100', rarity: 'epic', bonus: 120, name: 'Мастер времени', icon: '🌓', desc: '100 часов. Время — твоя сучка.', req: '100 часов в фокусе' },
    { id: 'hours_150', rarity: 'epic', bonus: 180, name: 'Ветеран труда', icon: '🛠️', desc: '150 часов. Пора на пенсию, дед.', req: '150 часов продуктивности' },
    { id: 'days_30', rarity: 'epic', bonus: 100, name: 'Работяга', icon: '🗓️', desc: 'Месяц без перебоя. Ну ты и задрот.', req: '30 активных дней' },
    { id: 'days_60', rarity: 'epic', bonus: 150, name: 'Железная воля', icon: '🛡️', desc: '60 дней. Твои яйца (или что там у тебя) из стали.', req: '60 активных дней' },
    { id: 'level_25', rarity: 'epic', bonus: 100, name: 'Четверть пути', icon: '👑', desc: '25 лвл. Еще немного — и станешь боссом качалки.', req: 'Достигни 25 уровня' },
    { id: 'level_40', rarity: 'epic', bonus: 150, name: 'Элита', icon: '💎', desc: '40 лвл. Смотришь на всех как на говно.', req: 'Достигни 40 уровня' },
    { id: 'gym_30', rarity: 'epic', bonus: 100, name: 'Бодибилдер', icon: '🏋️‍♂️', desc: '30 трень. Почти пробил потолок своими банками.', req: '30 тренировок' },
    { id: 'gym_50', rarity: 'epic', bonus: 150, name: 'Геракл', icon: '🏺', desc: '50 трень. Теперь ты можешь задушить льва голыми руками.', req: '50 тренировок завершено' },
    { id: 'finance_master', rarity: 'epic', bonus: 100, name: 'Успешный успех', icon: '💹', desc: '15 лвл в бабле. Где мой откат?', req: '15 уровень в Финансах' },
    { id: 'career_master', rarity: 'epic', bonus: 100, name: 'Директор', icon: '🏢', desc: '15 лвл в карьере. На ковер всех!', req: '15 уровень в Карьере' },
    { id: 'growth_master', rarity: 'epic', bonus: 100, name: 'Мудрец', icon: '🧙‍♂️', desc: '15 лвл в развитии. Познал всё, кроме личной жизни.', req: '15 уровень в Развитии' },
    { id: 'pomo_master', rarity: 'epic', bonus: 60, name: 'Помидорный маг', icon: '🍅', desc: '50 таймеров. Твой мозг — один сплошной томат.', req: 'Использовал таймер 50 раз' },
    { id: 'night_owl', rarity: 'epic', bonus: 40, name: 'Ночной дозор', icon: '🦉', desc: 'Работаешь по ночам, как элитная проститутка.', req: 'Задача после 00:00' },
    { id: 'finance_balance_10000', rarity: 'epic', bonus: 80, name: 'Инвестор+', icon: '📈', desc: '10к на счету. Время покупать крипту на хаях.', req: 'Баланс финансов > 10000' },
    { id: 'task_spree_20', rarity: 'epic', bonus: 80, name: 'Марафонец', icon: '🏁', desc: '20 задач. Твои пятки сверкают, а жопа горит.', req: '20 задач за всё время' },
    { id: 'all_spheres_5', rarity: 'epic', bonus: 120, name: 'Разносторонний', icon: '💠', desc: 'Везде пятый уровень. Мастер на все руки, а толку...', req: '5 уровень во всех сферах' },
    { id: 'big_spender', rarity: 'epic', bonus: 100, name: 'Магнат', icon: '🥂', desc: 'Спустил 5к монет. Красиво жить не запретишь.', req: 'Потрачено 5000 монет' },
    { id: 'saver', rarity: 'epic', bonus: 80, name: 'Скряга', icon: '🔒', desc: '2к на балансе. Трясешься над каждой монетой, жмот.', req: 'Баланс монет > 2000' },

    { id: 'river_walker', rarity: 'legendary', bonus: 400, name: 'Идущий к реке', icon: '🌊', desc: 'Ты преисполнился в своем познании. Этот мир тебе понятен.', req: '500 часов чистого времени' },
    { id: 'gigachad', rarity: 'legendary', bonus: 350, name: 'Гигачад', icon: '💪', desc: '100 трень. Твоя челюсть сама открывает пиво.', req: '100 тренировок' },
    { id: 'moms_friend_son', rarity: 'legendary', bonus: 500, name: 'Сын маминой подруги', icon: '🥇', desc: '10 лвл везде. Идеальный ублюдок.', req: '10 уровень во всех сферах' },
    { id: 'chinazes', rarity: 'legendary', bonus: 600, name: 'Чиназес', icon: '😎', desc: '1000 задач. Сюдаааа, нахуй! Чистый кайф.', req: '1000 выполненных задач' },
    { id: 'capitalist', rarity: 'legendary', bonus: 800, name: 'Капиталист', icon: '🏦', desc: 'Лимон в банке. Поделись, не будь падлой.', req: 'Баланс финансов > 1 000 000' },
    { id: 'level_75', rarity: 'legendary', bonus: 600, name: 'Легенда', icon: '🔱', desc: '75 лвл. Ты вообще человек или нейросеть?', req: 'Достигни 75 уровня' },
    { id: 'tasks_500', rarity: 'legendary', bonus: 300, name: 'Сверхчеловек', icon: '⚡', desc: '500 задач. Ницше тобой гордится.', req: '500 выполненных задач' },
    { id: 'tasks_1000', rarity: 'legendary', bonus: 500, name: 'АБСОЛЮТ', icon: '🏛️', desc: '1000 задач. Ты достиг дзена и перешел на новый уровень ебанутости.', req: '1000 выполненных задач' },
    { id: 'hours_500', rarity: 'legendary', bonus: 500, name: 'Повелитель времени', icon: '⏳', desc: '500 часов фокуса. Ты видел, как рождаются галактики.', req: '500 часов в фокусе' },
    { id: 'days_100', rarity: 'legendary', bonus: 400, name: 'Стодневник', icon: '🏆', desc: '100 дней. Ты продержался дольше, чем все мои отношения.', req: '100 активных дней' },
    { id: 'days_365', rarity: 'legendary', bonus: 1500, name: 'Год жизни', icon: '🌍', desc: 'Год в приложении. Ты либо гений, либо тебе совсем нечем заняться.', req: '365 активных дней' },
    { id: 'coins_25000', rarity: 'legendary', bonus: 600, name: 'Золотой фонд', icon: '🏺', desc: '25к монет. Можно купить этот дашборд целиком.', req: 'Набери 25000 монет всего' },
    { id: 'gym_100', rarity: 'legendary', bonus: 400, name: 'Олимпиец', icon: '🥇', desc: '100 трень. Твое тело — храм, а мы в нем прихожане.', req: '100 тренировок' },
    { id: 'all_max_lvl', rarity: 'legendary', bonus: 500, name: 'Магистр сфер', icon: '🔮', desc: 'Все сферы по десятке. Ты просто ебнутый перфекционист.', req: '10 уровень во всех сферах' },
    { id: 'streak_30', rarity: 'legendary', bonus: 300, name: 'Несгораемый', icon: '🧨', desc: '30 дней без пропусков. Очко не железное, а стрик — да.', req: '30 активных дней' },
    { id: 'finance_balance_100000', rarity: 'legendary', bonus: 500, name: 'Капиталист JR', icon: '🏦', desc: '100к на счету. Мелочь, а приятно.', req: 'Баланс финансов > 100000' },
    { id: 'pomo_100', rarity: 'legendary', bonus: 250, name: 'Дзен', icon: '🧘', desc: '100 помидоров. Ты овощной маг.', req: '100 сессий таймера' },

    { id: 'tasks_5000', rarity: 'mythic', bonus: 2000, name: 'Творец миров', icon: '🌌', desc: '5000 задач. Ты создал новую вселенную и в ней ты — бог.', req: '5000 выполненных задач' },
    { id: 'hours_2000', rarity: 'mythic', bonus: 3000, name: 'Вне времени', icon: '🌀', desc: '2000 часов. Ты стал чистым светом и улетел в ебеня.', req: '2000 часов продуктивности' },
    { id: 'level_100', rarity: 'mythic', bonus: 2500, name: 'БОЖЕСТВО', icon: '🪐', desc: '100 лвл. Твоя стата больше не помещается в экран.', req: 'Достигни 100 уровня' },
    { id: 'billionaire', rarity: 'mythic', bonus: 5000, name: 'Властелин богатства', icon: '♾️', desc: '100к монет. Купи себе уже жизнь.', req: 'Заработай 100к монет всего' },
    { id: 'perfectionist', rarity: 'mythic', bonus: 2000, name: 'Перфекционист', icon: '💎', desc: 'Все сферы по 50 лвл. Лечись, чел. Серьезно.', req: 'Все сферы на 50 уровне' },
    { id: 'pomo_500', rarity: 'mythic', bonus: 1500, name: 'Абсолютный фокус', icon: '🧿', desc: '500 таймеров. Ты видишь сквозь стены и время.', req: '500 сессий таймера' },
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
    var taskHistory = storeGet('task_history_v1') || [];
    var hardTasksInARow = 0;
    for(var i=0; i<Math.min(taskHistory.length, 10); i++) {
        if(taskHistory[i] && taskHistory[i].difficulty === 'hard') hardTasksInARow++;
        else if (hardTasksInARow < 5) hardTasksInARow = 0;
    }
    var d = { totalTasks: stats.totalTasks, totalMinutes: stats.totalMinutes, totalDays: stats.totalDays, coinsEarned: coins.earned, overallLevel: overall.level, sphereLevels: sphereLevels, activeSpheres: activeSpheres, totalSpheres: SPHERES.length, totalPurchases: store.purchases ? store.purchases.length : 0, totalWorkouts: gymHistory.length, earlyTask: taskHour >= 4 && taskHour < 9, nightTask: (taskHour >= 0 && taskHour < 4) || taskHour > 23, pomoCount: log.length, finBalance: finData.balance || 0, coinBalance: coins.balance, hardStreak: hardTasksInARow >= 5, lastGymDate: gymHistory.length ? gymHistory[0].date : stats.firstDay };
    var daysSinceGym = d.lastGymDate ? (Date.now() - new Date(d.lastGymDate).getTime()) / (1000*3600*24) : 0;
    var achievements = getAchievements(), newUnlocks = [];
    var checker = {
      first_task: function(d) { return d.totalTasks >= 1; }, altushka: function(d) { return d.totalPurchases >= 1; }, tasks_5: function(d) { return d.totalTasks >= 5; }, tasks_10: function(d) { return d.totalTasks >= 10; }, hours_1: function(d) { return d.totalMinutes >= 60; }, hours_5: function(d) { return d.totalMinutes >= 300; }, days_3: function(d) { return d.totalDays >= 3; }, coins_50: function(d) { return d.coinsEarned >= 50; }, coins_200: function(d) { return d.coinsEarned >= 200; }, level_3: function(d) { return d.overallLevel >= 3; }, level_5: function(d) { return d.overallLevel >= 5; }, gym_1: function(d) { return d.totalWorkouts >= 1; }, gym_3: function(d) { return d.totalWorkouts >= 3; }, finance_1: function(d) { return d.sphereLevels['finance'] >= 1; }, sphere_xp: function(d) { return d.activeSpheres >= 1; }, early_bird: function(d) { return d.earlyTask; }, number_67: function(d) { return d.totalTasks === 67; }, clothing_78: function(d) { return d.totalTasks >= 8; }, tasks_50: function(d) { return d.totalTasks >= 50; }, tasks_75: function(d) { return d.totalTasks >= 75; }, temshik: function(d) { return d.coinsEarned >= 1000; }, surgut: function(d) { return d.totalWorkouts >= 10; }, technik: function(d) { return d.totalPurchases >= 10; }, skuf: function(d) { return daysSinceGym >= 30; }, hours_20: function(d) { return d.totalMinutes >= 1200; }, hours_40: function(d) { return d.totalMinutes >= 2400; }, days_7: function(d) { return d.totalDays >= 7; }, days_14: function(d) { return d.totalDays >= 14; }, level_10: function(d) { return d.overallLevel >= 10; }, level_15: function(d) { return d.overallLevel >= 15; }, gym_10: function(d) { return d.totalWorkouts >= 10; }, gym_streak: function(d) { return d.totalWorkouts >= 3; }, all_spheres: function(d) { return d.activeSpheres >= d.totalSpheres; }, store_5: function(d) { return d.totalPurchases >= 5; }, health_5: function(d) { return d.sphereLevels['health'] >= 5; }, finance_5: function(d) { return d.sphereLevels['finance'] >= 5; }, career_5: function(d) { return d.sphereLevels['career'] >= 5; }, night_owl_3: function(d) { return d.nightTask; }, early_bird_10: function(d) { return d.earlyTask; }, gym_variety: function(d) { return d.totalWorkouts >= 5; }, habit_7: function(d) { return d.totalDays >= 7; }, svo: function(d) { return d.hardStreak; }, borov: function(d) { return d.coinsEarned >= 5000; }, mamont: function(d) { return (d.coinsEarned - d.coinBalance) >= 5000; }, mamkin_investor: function(d) { return d.finBalance >= 10000; }, dedinsight: function(d) { return d.nightTask; }, sigma: function(d) { return d.totalWorkouts >= 50; }, tasks_150: function(d) { return d.totalTasks >= 150; }, tasks_300: function(d) { return d.totalTasks >= 300; }, hours_100: function(d) { return d.totalMinutes >= 6000; }, hours_150: function(d) { return d.totalMinutes >= 9000; }, days_30: function(d) { return d.totalDays >= 30; }, days_60: function(d) { return d.totalDays >= 60; }, level_25: function(d) { return d.overallLevel >= 25; }, level_40: function(d) { return d.overallLevel >= 40; }, gym_30: function(d) { return d.totalWorkouts >= 30; }, gym_50: function(d) { return d.totalWorkouts >= 50; }, finance_master: function(d) { return d.sphereLevels['finance'] >= 15; }, career_master: function(d) { return d.sphereLevels['career'] >= 15; }, growth_master: function(d) { return d.sphereLevels['growth'] >= 15; }, pomo_master: function(d) { return d.pomoCount >= 50; }, night_owl: function(d) { return d.nightTask; }, finance_balance_10000: function(d) { return d.finBalance >= 10000; }, task_spree_20: function(d) { return d.totalTasks >= 20; }, all_spheres_5: function(d) { var m = true; for(var k in d.sphereLevels) if(d.sphereLevels[k] < 10) m = false; return m; }, big_spender: function(d) { return (d.coinsEarned - d.coinBalance) >= 5000; }, saver: function(d) { return d.coinBalance >= 2000; }, river_walker: function(d) { return d.totalMinutes >= 30000; }, gigachad: function(d) { return d.totalWorkouts >= 100; }, moms_friend_son: function(d) { var m = true; for(var k in d.sphereLevels) if(d.sphereLevels[k] < 10) m = false; return m; }, chinazes: function(d) { return d.totalTasks >= 1000; }, tasks_500: function(d) { return d.totalTasks >= 500; }, tasks_1000: function(d) { return d.totalTasks >= 1000; }, hours_500: function(d) { return d.totalMinutes >= 30000; }, days_100: function(d) { return d.totalDays >= 100; }, days_365: function(d) { return d.totalDays >= 365; }, level_75: function(d) { return d.overallLevel >= 75; }, gym_100: function(d) { return d.totalWorkouts >= 100; }, all_max_lvl: function(d) { var m = true; for(var k in d.sphereLevels) if(d.sphereLevels[k] < 10) m = false; return m; }, streak_30: function(d) { return d.totalDays >= 30; }, finance_balance_100000: function(d) { return d.finBalance >= 100000; }, pomo_100: function(d) { return d.pomoCount >= 100; }, capitalist: function(d) { return d.finBalance >= 1000000; }, tasks_5000: function(d) { return d.totalTasks >= 5000; }, hours_2000: function(d) { return d.totalMinutes >= 120000; }, level_100: function(d) { return d.overallLevel >= 100; }, billionaire: function(d) { return d.coinsEarned >= 100000; }, perfectionist: function(d) { var m = true; for(var k in d.sphereLevels) if(d.sphereLevels[k] < 50) m = false; return m; }, pomo_500: function(d) { return d.pomoCount >= 500; }
    };
    var playAchSound = false;
    for (var j = 0; j < ACHIEVEMENT_DEFS.length; j++) {
      var a = ACHIEVEMENT_DEFS[j]; if (achievements.unlocked[a.id]) continue;
      if (checker[a.id] && checker[a.id](d)) { 
        achievements.unlocked[a.id] = new Date().toISOString(); 
        newUnlocks.push(a); 
        if (a.bonus) earnCoins(a.bonus, 'Награда: ' + a.name, true);
        playAchSound = true;
      }
    }
    if (playAchSound) Juice.playAchievement();
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
    esc: escapeHTML,
    Juice: Juice,
    SPHERES: SPHERES, getSphereDefs: getSphereDefs, setSphereDefs: setSphereDefs, renameSphere: renameSphere, addSphere: addSphere, removeSphere: removeSphere,
    MAX_LEVEL: MAX_LEVEL, DIFFICULTY_COIN_MULT: DIFFICULTY_COIN_MULT, DIFFICULTY_LABELS: DIFFICULTY_LABELS, ACHIEVEMENT_DEFS: ACHIEVEMENT_DEFS,
    xpForLevel: xpForLevel, getLevelInfo: getLevelInfo, getOverallLevel: getOverallLevel, getSpheres: getSpheres, addXpToSphere: addXpToSphere,
    getCoins: getCoins, earnCoins: earnCoins, spendCoins: spendCoins, getStore: getStore, purchaseReward: purchaseReward, refundReward: refundReward, addReward: addReward, removeReward: removeReward,
    setCatalogPrice: setCatalogPrice,
    completeTask: completeTask, getTotalStats: getTotalStats, getTimerState: getTimerState, startTimer: startTimer, stopTimer: stopTimer,
    getActivityLog: getActivityLog, getAchievements: getAchievements, checkAchievements: checkAchievements, unlockManualAchievement: unlockManualAchievement,
    getProfile: getProfile, setProfile: setProfile, storeGet: storeGet, storeSet: storeSet,
  };
})();
