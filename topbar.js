(function () {
  'use strict';

  var css = '\
html {\
  scrollbar-gutter: stable;\
}\
.topbar {\
  position: fixed; top: 0; left: 10px; right: 10px; z-index: 100;\
  display: flex; justify-content: flex-end; align-items: center;\
  gap: 10px; height: 60px;\
  padding: 0 16px;\
  background: linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%);\
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);\
  border: 1px solid rgba(255,255,255,0.1); border-top: none;\
  border-bottom-left-radius: 18px; border-bottom-right-radius: 18px;\
  box-shadow: 0 4px 20px rgba(0,0,0,0.2);\
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;\
}\
.topbar-coins {\
  display: inline-flex; align-items: center; gap: 6px;\
  padding: 8px 14px;\
  background: rgba(242,192,99,0.12);\
  border: 1px solid rgba(242,192,99,0.2);\
  border-radius: 14px;\
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
  background: rgba(125,211,252,0.1);\
  border: 1px solid rgba(125,211,252,0.2);\
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
  border: 1px solid rgba(125,211,252,0.2);\
  background: linear-gradient(180deg, rgba(125,211,252,0.35), rgba(110,231,183,0.35));\
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
  position: fixed; bottom: 0; left: 0; right: 0; z-index: 100;\
  display: flex; justify-content: space-around; align-items: stretch;\
  padding: 8px 0 calc(8px + env(safe-area-inset-bottom));\
  background: rgba(20,22,26,0.85);\
  backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);\
  border-top: 1px solid rgba(255,255,255,0.08);\
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;\
}\
.bottombar-tab {\
  flex: 1;\
  display: flex; flex-direction: column; align-items: center; justify-content: center;\
  gap: 3px; padding: 6px 0 4px; text-decoration: none;\
  color: rgba(255,255,255,0.5);\
  font-size: 10px; font-weight: 600; letter-spacing: 0.04em;\
  -webkit-tap-highlight-color: transparent; transition: color 0.15s;\
}\
.bottombar-tab-icon {\
  font-size: 22px; line-height: 1;\
  filter: grayscale(100%) brightness(1.3); opacity: 0.65;\
  transition: opacity 0.15s, filter 0.15s, transform 0.10s;\
}\
.bottombar-tab.active { color: #FAFAFA; }\
.bottombar-tab.active .bottombar-tab-icon {\
  filter: grayscale(0%) brightness(1); opacity: 1;\
}\
.bottombar-tab:active .bottombar-tab-icon { transform: scale(0.92); }\
body.has-bottombar {\
  padding-top: 74px !important;\
  padding-bottom: calc(84px + env(safe-area-inset-bottom)) !important;\
}\
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
';

  var topbarHtml = '\
<header class="topbar" id="topbar" role="navigation" aria-label="Quick actions">\
  <div class="topbar-coins" id="topbarCoins" aria-label="Coins balance">\
    <span class="topbar-coins-icon">🪙</span>\
    <span id="topbarCoinsCount">0</span>\
  </div>\
  <div class="topbar-water-wrap">\
    <a href="health.html#water" class="topbar-water-pill" id="topbarWater" aria-label="Water progress">\
      <span style="width:8px;height:8px;border-radius:50%;background:#7DD3FC"></span>\
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

  function isEmbedded() { try { return window.self !== window.top; } catch (e) { return true; } }
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

  function render() {
    if (window.Gamification) {
      var bal = window.Gamification.getCoins().balance;
      var countEl = document.getElementById('topbarCoinsCount');
      if (countEl) countEl.textContent = bal;
    }
  }

  function boot() {
    injectStyleAndHTML();
    render();
    window.addEventListener('gamification-update', render);
    setInterval(render, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
