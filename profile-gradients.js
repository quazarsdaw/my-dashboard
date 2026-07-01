(function () {
  'use strict';

  var DEFAULT_PROFILE_GRADIENT_ID = 'grad-aurora';
  var PROFILE_GRADIENTS = [
    { id: 'grad-aurora', name: 'аврора', background: 'linear-gradient(135deg, rgba(192,132,252,0.15) 0%, rgba(125,211,252,0.10) 100%)', border: 'rgba(192,132,252,0.18)', glowA: 'rgba(192,132,252,0.24)', glowB: 'rgba(125,211,252,0.13)' },
    { id: 'grad-forest', name: 'лес', background: 'linear-gradient(135deg, rgba(74,222,128,0.14) 0%, rgba(45,212,191,0.08) 100%)', border: 'rgba(74,222,128,0.18)', glowA: 'rgba(74,222,128,0.22)', glowB: 'rgba(45,212,191,0.12)' },
    { id: 'grad-sunset', name: 'закат', background: 'linear-gradient(135deg, rgba(251,113,133,0.15) 0%, rgba(251,191,36,0.10) 100%)', border: 'rgba(251,146,60,0.18)', glowA: 'rgba(251,113,133,0.22)', glowB: 'rgba(251,191,36,0.12)' },
    { id: 'grad-lagoon', name: 'лагуна', background: 'linear-gradient(135deg, rgba(56,189,248,0.14) 0%, rgba(34,197,94,0.08) 100%)', border: 'rgba(56,189,248,0.18)', glowA: 'rgba(56,189,248,0.22)', glowB: 'rgba(34,197,94,0.12)' },
    { id: 'grad-ember', name: 'уголь', background: 'linear-gradient(135deg, rgba(248,113,113,0.13) 0%, rgba(148,163,184,0.09) 100%)', border: 'rgba(248,113,113,0.18)', glowA: 'rgba(248,113,113,0.22)', glowB: 'rgba(148,163,184,0.10)' },
    { id: 'grad-citrus', name: 'цитрус', background: 'linear-gradient(135deg, rgba(250,204,21,0.14) 0%, rgba(52,211,153,0.09) 100%)', border: 'rgba(250,204,21,0.18)', glowA: 'rgba(250,204,21,0.20)', glowB: 'rgba(52,211,153,0.12)' },
    { id: 'grad-berry', name: 'ягода', background: 'linear-gradient(135deg, rgba(244,114,182,0.15) 0%, rgba(129,140,248,0.10) 100%)', border: 'rgba(244,114,182,0.18)', glowA: 'rgba(244,114,182,0.22)', glowB: 'rgba(129,140,248,0.12)' },
    { id: 'grad-steel', name: 'сталь', background: 'linear-gradient(135deg, rgba(148,163,184,0.13) 0%, rgba(96,165,250,0.08) 100%)', border: 'rgba(148,163,184,0.18)', glowA: 'rgba(148,163,184,0.18)', glowB: 'rgba(96,165,250,0.11)' },
    { id: 'grad-mint', name: 'мята', background: 'linear-gradient(135deg, rgba(110,231,183,0.13) 0%, rgba(240,253,250,0.06) 100%)', border: 'rgba(110,231,183,0.18)', glowA: 'rgba(110,231,183,0.20)', glowB: 'rgba(240,253,250,0.08)' },
    { id: 'grad-orchid', name: 'орхидея', background: 'linear-gradient(135deg, rgba(216,180,254,0.15) 0%, rgba(251,207,232,0.08) 100%)', border: 'rgba(216,180,254,0.18)', glowA: 'rgba(216,180,254,0.22)', glowB: 'rgba(251,207,232,0.10)' },
    { id: 'grad-ocean', name: 'океан', background: 'linear-gradient(135deg, rgba(14,165,233,0.14) 0%, rgba(99,102,241,0.10) 100%)', border: 'rgba(14,165,233,0.18)', glowA: 'rgba(14,165,233,0.22)', glowB: 'rgba(99,102,241,0.12)' },
    { id: 'grad-magma', name: 'магма', background: 'linear-gradient(135deg, rgba(239,68,68,0.13) 0%, rgba(217,119,6,0.10) 100%)', border: 'rgba(239,68,68,0.18)', glowA: 'rgba(239,68,68,0.20)', glowB: 'rgba(217,119,6,0.12)' },
    { id: 'grad-ice', name: 'лёд', background: 'linear-gradient(135deg, rgba(186,230,253,0.12) 0%, rgba(196,181,253,0.09) 100%)', border: 'rgba(186,230,253,0.18)', glowA: 'rgba(186,230,253,0.18)', glowB: 'rgba(196,181,253,0.11)' },
    { id: 'grad-neon', name: 'неон', background: 'linear-gradient(135deg, rgba(34,211,238,0.13) 0%, rgba(244,114,182,0.10) 100%)', border: 'rgba(34,211,238,0.18)', glowA: 'rgba(34,211,238,0.21)', glowB: 'rgba(244,114,182,0.12)' },
    { id: 'grad-olive', name: 'олива', background: 'linear-gradient(135deg, rgba(132,204,22,0.13) 0%, rgba(234,179,8,0.08) 100%)', border: 'rgba(132,204,22,0.18)', glowA: 'rgba(132,204,22,0.20)', glowB: 'rgba(234,179,8,0.10)' },
    { id: 'grad-cosmic', name: 'космос', background: 'linear-gradient(135deg, rgba(167,139,250,0.14) 0%, rgba(45,212,191,0.08) 100%)', border: 'rgba(167,139,250,0.18)', glowA: 'rgba(167,139,250,0.22)', glowB: 'rgba(45,212,191,0.12)' },
    { id: 'grad-rose', name: 'роза', background: 'linear-gradient(135deg, rgba(251,113,133,0.14) 0%, rgba(253,186,116,0.08) 100%)', border: 'rgba(251,113,133,0.18)', glowA: 'rgba(251,113,133,0.21)', glowB: 'rgba(253,186,116,0.10)' },
    { id: 'grad-night', name: 'ночь', background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(168,85,247,0.10) 100%)', border: 'rgba(59,130,246,0.18)', glowA: 'rgba(59,130,246,0.18)', glowB: 'rgba(168,85,247,0.12)' }
  ];

  function getProfileGradient(id) {
    return PROFILE_GRADIENTS.find(function (gradient) {
      return gradient.id === id;
    }) || PROFILE_GRADIENTS[0];
  }

  function buildPageGlow(gradient) {
    return [
      'radial-gradient(ellipse 50% 50% at 82% 14%, ' + gradient.glowA + ', transparent)',
      'radial-gradient(ellipse 50% 50% at 18% 90%, ' + gradient.glowB + ', transparent)',
      'radial-gradient(ellipse 42% 42% at 50% 105%, rgba(255,255,255,0.035), transparent)'
    ].join(', ');
  }

  function applyProfileGradientTheme(id) {
    var gradient = getProfileGradient(id || DEFAULT_PROFILE_GRADIENT_ID);
    var root = document.documentElement;

    root.style.setProperty('--profile-hero-bg', gradient.background);
    root.style.setProperty('--profile-hero-border', gradient.border);
    root.style.setProperty('--app-page-glow', buildPageGlow(gradient));
    root.style.setProperty('--app-chrome-border', gradient.border);
    root.style.setProperty('--app-active-tab-bg', gradient.background);
    root.style.setProperty('--app-accent-glow', gradient.glowA);

    return gradient;
  }

  function getStoredProfileGradientId() {
    var profile = null;
    try { profile = JSON.parse(localStorage.getItem('profile_v1') || 'null'); } catch (e) {}
    return profile && profile.gradientId ? profile.gradientId : DEFAULT_PROFILE_GRADIENT_ID;
  }

  function applyStoredProfileGradientTheme() {
    return applyProfileGradientTheme(getStoredProfileGradientId());
  }

  window.AppProfileGradients = {
    defaultId: DEFAULT_PROFILE_GRADIENT_ID,
    list: PROFILE_GRADIENTS,
    get: getProfileGradient,
    apply: applyProfileGradientTheme,
    applyStored: applyStoredProfileGradientTheme
  };

  applyStoredProfileGradientTheme();
}());
