(function () {
  'use strict';

  var css = '\
.topbar {\
  position: fixed; top: 10px; left: 10px; right: 10px; z-index: 100;\
  display: flex; justify-content: flex-end; align-items: center;\
  gap: 10px; height: 58px;\
  padding: 0 16px;\
  background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 100%);\
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);\
  border: 1px solid rgba(255,255,255,0.14);\
  border-radius: 16px;\
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);\
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;\
  transition: transform 0.3s ease;\
}\
.topbar-coins {\
  display: inline-flex; align-items: center; gap: 6px;\
  padding: 8px 14px;\
  background: rgba(242,192,99,0.15);\
  border: 1px solid rgba(242,192,99,0.25);\
  border-radius: 12px;\
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;\
  font-size: 13px; font-weight: 700; color: #F2C063;\
  font-variant-numeric: tabular-nums;\
  text-decoration: none;\
  -webkit-tap-highlight-color: transparent;\
}\
.topbar-coins-icon { font-size: 16px; line-height: 1; }\
.topbar-water-wrap { display: flex; align-items: stretch; }\
.topbar-water-pill {\
  display: inline-flex; align-items: center; gap: 8px;\
  padding: 9px 14px;\
  background: rgba(125,211,252,0.12);\
  border: 1px solid rgba(125,211,252,0.25);\
  border-right: none;\
  border-radius: 12px 0 0 12px;\
  text-decoration: none; color: #FAFAFA;\
  -webkit-tap-highlight-color: transparent;\
}\
.topbar-water-pill .topbar-pill-dot {\
  width: 8px; height: 8px; border-radius: 50%;\
  background: #7DD3FC; flex-shrink: 0;\
}\
.topbar-water-pill.warn .topbar-pill-dot { background: #fbbf24; }\
.topbar-water-pill.miss .topbar-pill-dot {\
  background: #ff8a8a;\
  animation: topbar-miss-pulse 1.6s ease-in-out infinite;\
}\
@keyframes topbar-miss-pulse {\
  0%,100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.5); }\
  50% { box-shadow: 0 0 0 5px rgba(239,68,68,0); }\
}\
.topbar-pill-count {\
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;\
  font-size: 13px; font-weight: 700; color: #FAFAFA;\
  font-variant-numeric: tabular-nums; white-space: nowrap;\
}\
.topbar-water-add {\
  width: 44px;\
  border: 1px solid rgba(125,211,252,0.25);\
  background: linear-gradient(180deg, rgba(125,211,252,0.4), rgba(110,231,183,0.4));\
  color: #FFF; font-family: inherit;\
  font-size: 20px; font-weight: 700; line-height: 1;\
  cursor: pointer; border-radius: 0 12px 12px 0;\
  -webkit-tap-highlight-color: transparent;\
  transition: background 0.15s, transform 0.10s;\
}\
.topbar-water-add:active { transform: scale(0.94); }\
.topbar-water-add.flash {\
  background: linear-gradient(180deg, rgba(125,211,252,0.7), rgba(110,231,183,0.7));\
}\
.bottombar {\
  position: fixed; bottom: 15px; left: 10px; right: 10px; z-index: 100;\
  display: flex; justify-content: space-around; align-items: stretch;\
  height: 66px; padding: 0 8px;\
  background: rgba(28,30,36,0.85);\
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);\
  border: 1px solid rgba(255,255,255,0.12);\
  border-radius: 20px;\
  box-shadow: 0 -4px 32px rgba(0,0,0,0.3);\
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;\
}\
.bottombar-tab {\
  flex: 1;\
  display: flex; flex-direction: column; align-items: center; justify-content: center;\
  gap: 3px; padding: 4px 0; text-decoration: none;\
  color: rgba(255,255,255,0.5);\
  font-size: 10px; font-weight: 600; letter-spacing: 0.02em;\
  -webkit-tap-highlight-color: transparent; transition: color 0.2s, transform 0.2s;\
}\
.bottombar-tab-icon {\
  font-size: 22px; line-height: 1;\
  filter: grayscale(100%) brightness(1.3); opacity: 0.6;\
  transition: opacity 0.2s, filter 0.2s, transform 0.15s;\
}\
.bottombar-tab.active { color: #FAFAFA; }\
.bottombar-tab.active .bottombar-tab-icon {\
  filter: grayscale(0%) brightness(1); opacity: 1; transform: translateY(-2px);\
}\
.bottombar-tab:active .bottombar-tab-icon { transform: scale(0.9); }\
body {\
  padding-top: 84px !important;\
  padding-bottom: calc(100px + env(safe-area-inset-bottom)) !important;\
}\
@media (max-width: 480px) {\
  .topbar { left: 8px; right: 8px; top: 8px; height: 54px; padding: 0 12px; gap: 8px; }\
  .topbar-coins { padding: 6px 10px; font-size: 12px; }\
  .topbar-water-pill { padding: 7px 11px; }\
  .bottombar { bottom: 10px; left: 8px; right: 8px; height: 60px; }\
  .bottombar-tab-icon { font-size: 20px; }\
  .bottombar-tab { font-size: 0; }\
  .bottombar-tab.active { font-size: 8px; }\
}\
';
@media (max-width: 480px) {\
  .topbar { padding-left: 10px; padding-right: 10px; gap: 6px; }\
  .topbar-coins { padding: 7px 10px; font-size: 12px; gap: 5px; }\
  .topbar-water-pill { padding: 8px 11px; gap: 6px; }\
  .topbar-pill-count { font-size: 12px; }\
  .topbar-water-add { width: 40px; font-size: 18px; }\
  .bottombar-tab-icon { font-size: 18px; }\
  .bottombar-tab { font-size: 0; gap: 1px; padding: 6px 0 4px; }\
  .bottombar-tab.active { font-size: 7px; }\
}\
html, body { -webkit-text-size-adjust: 100%; }\
@media (max-width: 768px) {\
  html { touch-action: pan-y; }\
  ::-webkit-scrollbar { width: 0; height: 0; display: none; }\
  html, body { scrollbar-width: none; -ms-overflow-style: none; }\
}\
body.topbar-modal-open { overflow: hidden; touch-action: none; }\
';

  var topbarHtml = '\
<header class="topbar" id="topbar" role="navigation" aria-label="Quick actions">\
  <div class="topbar-coins" id="topbarCoins" aria-label="Coins balance">\
    <span class="topbar-coins-icon">🪙</span>\
    <span id="topbarCoinsCount">0</span>\
  </div>\
  <div class="topbar-water-wrap">\
    <a href="health.html#water" class="topbar-water-pill" id="topbarWater" aria-label="Water progress">\
      <span class="topbar-pill-dot"></span>\
      <span class="topbar-pill-count" id="topbarWaterCount">0/0</span>\
    </a>\
    <button class="topbar-water-add" id="topbarWaterAdd" aria-label="Log one drink" type="button">+</button>\
  </div>\
</header>';

  var bottombarHtml = '\
<nav class="bottombar" id="bottombar" role="navigation" aria-label="Main tabs">\
  <a href="index.html" class="bottombar-tab" data-page="main">\
    <span class="bottombar-tab-icon">🏠</span><span>Главная</span>\
  </a>\
  <a href="tracker.html" class="bottombar-tab" data-page="tracker">\
    <span class="bottombar-tab-icon">✅</span><span>Трекер</span>\
  </a>\
  <a href="health.html" class="bottombar-tab" data-page="health">\
    <span class="bottombar-tab-icon">💧</span><span>Здоровье</span>\
  </a>\
  <a href="gym.html" class="bottombar-tab" data-page="fitness">\
    <span class="bottombar-tab-icon">💪</span><span>Спорт</span>\
  </a>\
  <a href="finance.html" class="bottombar-tab" data-page="finance">\
    <span class="bottombar-tab-icon">💳</span><span>Финансы</span>\
  </a>\
  <a href="goals.html" class="bottombar-tab" data-page="goals">\
    <span class="bottombar-tab-icon">🎯</span><span>Цели</span>\
  </a>\
  <a href="store.html" class="bottombar-tab" data-page="store">\
    <span class="bottombar-tab-icon">🏪</span><span>Магазин</span>\
  </a>\
  <a href="profile.html" class="bottombar-tab" data-page="profile">\
    <span class="bottombar-tab-icon">👤</span><span>Профиль</span>\
  </a>\
</nav>';

  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }
  function shouldShowChrome() { return !isEmbedded(); }
  function currentPageKey() {
    var p = (window.location.pathname || '').toLowerCase();
    if (p.indexOf('tracker.html') !== -1) return 'tracker';
    if (p.indexOf('health.html') !== -1) return 'health';
    if (p.indexOf('gym.html') !== -1) return 'fitness';
    if (p.indexOf('finance.html') !== -1) return 'finance';
    if (p.indexOf('goals.html') !== -1) return 'goals';
    if (p.indexOf('store.html') !== -1) return 'store';
    if (p.indexOf('profile.html') !== -1) return 'profile';
    return 'main';
  }

  function injectStyleAndHTML() {
    if (document.getElementById('topbar') || document.getElementById('bottombar')) return;
    if (!shouldShowChrome()) return;
    var style = document.createElement('style');
    style.id = 'topbar-style';
    style.textContent = css;
    document.head.appendChild(style);
    var topWrap = document.createElement('div');
    topWrap.innerHTML = topbarHtml.trim();
    document.body.insertBefore(topWrap.firstChild, document.body.firstChild);
    var bottomWrap = document.createElement('div');
    bottomWrap.innerHTML = bottombarHtml.trim();
    document.body.appendChild(bottomWrap.firstChild);
    var active = currentPageKey();
    var tabs = document.querySelectorAll('.bottombar-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-page') === active);
    }
    document.body.classList.add('has-bottombar');
  }

  function calendarDateKey() {
    var d = new Date();
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function getWaterProgress() {
    var state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state) return { done: 0, total: 0 };
    var todayKey = calendarDateKey();
    var done = (state.logs || {})[todayKey] || 0;
    var p = state.profile || { weightKg: 75 };
    var wKg = state.weightUnit === 'lb' ? (p.weightKg || 0) / 2.20462 : (p.weightKg || 0);
    var base = wKg * 35;
    var exercise = (p.activityHrsPerWeek || 0) / 7 * 500;
    var caffeine = Math.max(0, (state.caffeineMgPerDay || 0) - 200) * 1.5;
    var subs = (state.substances || []).reduce(function (s, x) {
      var dose = (x && x.dose != null ? x.dose : (x && x.defaultDose)) || 0;
      return s + Math.max(0, dose * ((x && x.mlPerUnit) || 0));
    }, 0);
    var adjust = 0;
    if (p.sex === 'm') adjust += 200;
    if ((p.age || 0) >= 50) adjust += 100;
    var totalMl = base + exercise + caffeine + subs + adjust;
    var unitVol;
    if (state.unit === 'glass') unitVol = state.glassMl || 250;
    else if (state.unit === 'oz') unitVol = 30;
    else if (state.unit === 'ml') unitVol = 1;
    else unitVol = state.bottleMl || 500;
    var total = Math.max(1, Math.ceil(totalMl / unitVol));
    return { done: done, total: total };
  }

  function classifyStatus(done, total) {
    if (total === 0) return 'idle';
    if (done >= total) return 'good';
    if (done >= total * 0.5) return 'warn';
    if (new Date().getHours() >= 18 && done < total * 0.5) return 'miss';
    return 'warn';
  }

  function render() {
    var waterEl = document.getElementById('topbarWater');
    if (waterEl) {
      var w = getWaterProgress();
      var countEl = document.getElementById('topbarWaterCount');
      if (countEl) countEl.textContent = w.total ? w.done + '/' + w.total : '0/0';
      waterEl.classList.remove('good', 'warn', 'miss');
      var st = classifyStatus(w.done, w.total);
      if (st === 'warn' || st === 'miss') waterEl.classList.add(st);
    }
    var coinsEl = document.getElementById('topbarCoinsCount');
    if (coinsEl && window.Gamification) {
      var bal = window.Gamification.getCoins().balance;
      coinsEl.textContent = bal;
      var pill = document.getElementById('topbarCoins');
      if (pill) {
        pill.style.color = bal < 0 ? '#FF6B6B' : '#F2C063';
        pill.style.borderColor = bal < 0 ? 'rgba(255,107,107,0.25)' : 'rgba(242,192,99,0.16)';
        pill.style.background = bal < 0 ? 'rgba(255,107,107,0.08)' : 'rgba(242,192,99,0.08)';
      }
    }
  }

  function defaultWaterState() {
    return {
      unit: 'bottle', bottleMl: 500, glassMl: 250, weightUnit: 'kg',
      profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
      caffeineMgPerDay: 200, substances: [], logs: {}
    };
  }

  function addWater() {
    var state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state || typeof state !== 'object') state = defaultWaterState();
    state.logs = state.logs || {};
    var k = calendarDateKey();
    state.logs[k] = (state.logs[k] || 0) + 1;
    try { localStorage.setItem('po_water_v1', JSON.stringify(state)); } catch (e) {}
    render();
    var btn = document.getElementById('topbarWaterAdd');
    if (btn) { btn.classList.add('flash'); setTimeout(function () { btn.classList.remove('flash'); }, 220); }
  }

  function boot() {
    injectStyleAndHTML();
    var btn = document.getElementById('topbarWaterAdd');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); addWater(); });
    render();
    window.addEventListener('storage', render);
    window.addEventListener('focus', render);
    window.addEventListener('gamification-update', render);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
    setInterval(render, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
