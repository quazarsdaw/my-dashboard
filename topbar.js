(function () {
  'use strict';

  var css = '\
.topbar {\
  position: fixed; top: 12px; left: 12px; right: 12px; z-index: 10000;\
  display: flex; justify-content: flex-end; align-items: center;\
  gap: 10px; height: 60px !important; min-height: 60px !important;\
  padding: 0 16px; box-sizing: border-box;\
  background: linear-gradient(135deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.05) 100%);\
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);\
  border: 1px solid rgba(255,255,255,0.14); border-radius: 18px;\
  box-shadow: 0 8px 32px rgba(0,0,0,0.25);\
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;\
}\
.topbar-coins {\
  display: inline-flex; align-items: center; gap: 6px;\
  padding: 8px 14px; background: rgba(242,192,99,0.15);\
  border: 1px solid rgba(242,192,99,0.25); border-radius: 12px;\
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;\
  font-size: 13px; font-weight: 700; color: #F2C063;\
  font-variant-numeric: tabular-nums; text-decoration: none;\
}\
.topbar-water-pill {\
  display: inline-flex; align-items: center; gap: 8px;\
  padding: 9px 14px; background: rgba(125,211,252,0.12);\
  border: 1px solid rgba(125,211,252,0.25); border-right: none;\
  border-radius: 12px 0 0 12px; text-decoration: none; color: #FAFAFA;\
}\
.topbar-water-add {\
  width: 44px; height: 38px; border: 1px solid rgba(125,211,252,0.25);\
  background: linear-gradient(180deg, rgba(125,211,252,0.4), rgba(110,231,183,0.4));\
  color: #FFF; font-size: 20px; font-weight: 700; cursor: pointer; border-radius: 0 12px 12px 0;\
}\
.bottombar {\
  position: fixed; bottom: 15px; left: 12px; right: 12px; z-index: 10000 !important;\
  display: flex !important; justify-content: space-around !important; align-items: stretch !important;\
  height: 66px !important; min-height: 66px !important; padding: 0 8px !important;\
  background: rgba(28,30,36,0.92) !important;\
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);\
  border: 1px solid rgba(255,255,255,0.14) !important; border-radius: 22px !important;\
  box-shadow: 0 -4px 32px rgba(0,0,0,0.35) !important; box-sizing: border-box !important;\
}\
.bottombar-tab {\
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;\
  gap: 3px; padding: 0 !important; margin: 0 !important; text-decoration: none !important;\
  color: rgba(255,255,255,0.5); font-size: 10px; font-weight: 600;\
  -webkit-tap-highlight-color: transparent; transition: color 0.2s;\
}\
.bottombar-tab-icon {\
  font-size: 22px; line-height: 1; opacity: 0.6; transition: transform 0.15s, opacity 0.2s;\
}\
.bottombar-tab.active { color: #FAFAFA !important; }\
.bottombar-tab.active .bottombar-tab-icon { opacity: 1; transform: translateY(-2px); }\
body {\
  padding-top: 84px !important;\
  padding-bottom: 100px !important;\
  padding-left: 16px !important;\
  padding-right: 16px !important;\
}\
@media (max-width: 480px) {\
  .topbar { height: 54px !important; min-height: 54px !important; top: 10px; left: 10px; right: 10px; }\
  .bottombar { height: 64px !important; min-height: 64px !important; bottom: 12px; left: 10px; right: 10px; }\
  .bottombar-tab span:not(.bottombar-tab-icon) { display: none; }\
  .bottombar-tab.active span:not(.bottombar-tab-icon) { display: block; font-size: 8px; }\
}\
';

  var topbarHtml = '\
<header class="topbar" id="topbar">\
  <div class="topbar-coins" id="topbarCoins">\
    <span class="topbar-coins-icon">🪙</span>\
    <span id="topbarCoinsCount">0</span>\
  </div>\
  <div class="topbar-water-wrap">\
    <a href="health.html#water" class="topbar-water-pill" id="topbarWater">\
      <span style="width:8px;height:8px;border-radius:50%;background:#7DD3FC"></span>\
      <span id="topbarWaterCount">0/0</span>\
    </a>\
    <button class="topbar-water-add" id="topbarWaterAdd" type="button">+</button>\
  </div>\
</header>';

  var bottombarHtml = '\
<nav class="bottombar" id="bottombar">\
  <a href="index.html" class="bottombar-tab" data-page="main"><span class="bottombar-tab-icon">🏠</span><span>Главная</span></a>\
  <a href="tracker.html" class="bottombar-tab" data-page="tracker"><span class="bottombar-tab-icon">✅</span><span>Трекер</span></a>\
  <a href="health.html" class="bottombar-tab" data-page="health"><span class="bottombar-tab-icon">💧</span><span>Здоровье</span></a>\
  <a href="gym.html" class="bottombar-tab" data-page="fitness"><span class="bottombar-tab-icon">💪</span><span>Спорт</span></a>\
  <a href="finance.html" class="bottombar-tab" data-page="finance"><span class="bottombar-tab-icon">💳</span><span>Финансы</span></a>\
  <a href="goals.html" class="bottombar-tab" data-page="goals"><span class="bottombar-tab-icon">🎯</span><span>Цели</span></a>\
  <a href="store.html" class="bottombar-tab" data-page="store"><span class="bottombar-tab-icon">🏪</span><span>Магазин</span></a>\
  <a href="profile.html" class="bottombar-tab" data-page="profile"><span class="bottombar-tab-icon">👤</span><span>Профиль</span></a>\
</nav>';

  function isEmbedded() { try { return window.self !== window.top; } catch (e) { return true; } }
  function currentPageKey() {
    var p = window.location.pathname.toLowerCase();
    if (p.indexOf('tracker') !== -1) return 'tracker';
    if (p.indexOf('health') !== -1) return 'health';
    if (p.indexOf('gym') !== -1) return 'fitness';
    if (p.indexOf('finance') !== -1) return 'finance';
    if (p.indexOf('goals') !== -1) return 'goals';
    if (p.indexOf('store') !== -1) return 'store';
    if (p.indexOf('profile') !== -1) return 'profile';
    return 'main';
  }

  function inject() {
    if (document.getElementById('topbar') || isEmbedded()) return;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.insertAdjacentHTML('afterbegin', topbarHtml);
    document.body.insertAdjacentHTML('beforeend', bottombarHtml);
    var active = currentPageKey();
    document.querySelectorAll('.bottombar-tab').forEach(function(t) {
      if(t.getAttribute('data-page') === active) t.classList.add('active');
    });
    document.body.classList.add('has-bottombar');
  }

  function render() {
    if (window.Gamification) {
      var bal = window.Gamification.getCoins().balance;
      var count = document.getElementById('topbarCoinsCount');
      if (count) count.textContent = bal;
    }
    // Water logic
    try {
        var water = JSON.parse(localStorage.getItem('po_water_v1'));
        if (water) {
            var today = new Date().toISOString().slice(0, 10);
            var done = (water.logs || {})[today] || 0;
            var el = document.getElementById('topbarWaterCount');
            if (el) el.textContent = done + '/8'; // Simplified
        }
    } catch(e) {}
  }

  function boot() {
    inject();
    render();
    window.addEventListener('gamification-update', render);
    setInterval(render, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
