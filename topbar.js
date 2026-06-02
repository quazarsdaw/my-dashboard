(function () {
  'use strict';

  var css = '\
html {\
  scrollbar-gutter: stable;\
}\
.topbar {\
  position: fixed; top: 12px; left: 12px; right: 12px; z-index: 10000;\
  display: flex; justify-content: flex-end; align-items: center;\
  gap: 10px; height: 58px; padding: 0 16px;\
  background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%);\
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);\
  border: 1px solid rgba(255,255,255,0.12); border-radius: 16px;\
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);\
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;\
  box-sizing: border-box;\
}\
.bottombar {\
  position: fixed; bottom: 12px; left: 12px; right: 12px; z-index: 10000;\
  display: flex; justify-content: space-around; align-items: stretch;\
  height: 64px; padding: 0 8px;\
  background: linear-gradient(135deg, rgba(20,22,26,0.7) 0%, rgba(10,11,13,0.5) 100%);\
  backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);\
  border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;\
  box-shadow: 0 -4px 32px rgba(0,0,0,0.3);\
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;\
  box-sizing: border-box;\
}\
.bottombar-tab {\
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;\
  gap: 3px; padding: 0; text-decoration: none; color: rgba(255,255,255,0.45);\
  font-size: 10px; font-weight: 600; transition: color 0.2s;\
  -webkit-tap-highlight-color: transparent;\
}\
.bottombar-tab-icon {\
  font-size: 20px; line-height: 1; opacity: 0.55; transition: opacity 0.2s, transform 0.15s;\
}\
.bottombar-tab.active { color: #FAFAFA; }\
.bottombar-tab.active .bottombar-tab-icon { opacity: 1; transform: translateY(-2px); }\
.topbar-coins {\
  display: inline-flex; align-items: center; gap: 6px;\
  padding: 8px 14px; background: rgba(242,192,99,0.1); border: 1px solid rgba(242,192,99,0.15); border-radius: 12px;\
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; font-weight: 700; color: #F2C063; text-decoration: none;\
}\
.topbar-water-pill {\
  display: inline-flex; align-items: center; gap: 8px;\
  padding: 9px 14px; background: rgba(125,211,252,0.1); border: 1px solid rgba(125,211,252,0.15); border-right: none; border-radius: 12px 0 0 12px; text-decoration: none; color: #FAFAFA;\
}\
.topbar-water-add {\
  width: 44px; border: 1px solid rgba(125,211,252,0.15); background: rgba(125,211,252,0.2); color: #FFF; font-size: 20px; font-weight: 700; cursor: pointer; border-radius: 0 12px 12px 0;\
}\
body {\
  padding-top: 82px !important;\
  padding-bottom: 96px !important;\
  padding-left: 16px !important;\
  padding-right: 16px !important;\
}\
@media (max-width: 480px) {\
  .topbar { top: 8px; left: 8px; right: 8px; height: 52px; }\
  .bottombar { bottom: 8px; left: 8px; right: 8px; height: 58px; }\
  .bottombar-tab span:not(.bottombar-tab-icon) { display: none; }\
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
  }

  function boot() {
    inject();
    render();
    window.addEventListener('gamification-update', render);
    setInterval(render, 5000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
