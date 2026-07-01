(function () {
  'use strict';

  var DEFAULT_PROFILE_GRADIENT_ID = 'grad-aurora';
  var PROFILE_THEME_GRADIENTS = [
    { id: 'grad-aurora', name: 'аврора', background: 'linear-gradient(135deg, rgba(192,132,252,0.15) 0%, rgba(125,211,252,0.10) 100%)', border: 'rgba(192,132,252,0.18)', softGlowPrimary: 'rgba(192,132,252,0.095)', softGlowSecondary: 'rgba(125,211,252,0.045)', chromeBorder: 'rgba(192,132,252,0.13)', navActive: 'linear-gradient(135deg, rgba(192,132,252,0.08), rgba(125,211,252,0.04))' },
    { id: 'grad-forest', name: 'лес', background: 'linear-gradient(135deg, rgba(74,222,128,0.14) 0%, rgba(45,212,191,0.08) 100%)', border: 'rgba(74,222,128,0.18)', softGlowPrimary: 'rgba(74,222,128,0.085)', softGlowSecondary: 'rgba(45,212,191,0.04)', chromeBorder: 'rgba(74,222,128,0.12)', navActive: 'linear-gradient(135deg, rgba(74,222,128,0.075), rgba(45,212,191,0.035))' },
    { id: 'grad-sunset', name: 'закат', background: 'linear-gradient(135deg, rgba(251,113,133,0.15) 0%, rgba(251,191,36,0.10) 100%)', border: 'rgba(251,146,60,0.18)', softGlowPrimary: 'rgba(251,113,133,0.09)', softGlowSecondary: 'rgba(251,191,36,0.045)', chromeBorder: 'rgba(251,146,60,0.13)', navActive: 'linear-gradient(135deg, rgba(251,113,133,0.08), rgba(251,191,36,0.04))' },
    { id: 'grad-lagoon', name: 'лагуна', background: 'linear-gradient(135deg, rgba(56,189,248,0.14) 0%, rgba(34,197,94,0.08) 100%)', border: 'rgba(56,189,248,0.18)', softGlowPrimary: 'rgba(56,189,248,0.085)', softGlowSecondary: 'rgba(34,197,94,0.04)', chromeBorder: 'rgba(56,189,248,0.12)', navActive: 'linear-gradient(135deg, rgba(56,189,248,0.075), rgba(34,197,94,0.035))' },
    { id: 'grad-ember', name: 'уголь', background: 'linear-gradient(135deg, rgba(248,113,113,0.13) 0%, rgba(148,163,184,0.09) 100%)', border: 'rgba(248,113,113,0.18)', softGlowPrimary: 'rgba(248,113,113,0.085)', softGlowSecondary: 'rgba(148,163,184,0.035)', chromeBorder: 'rgba(248,113,113,0.12)', navActive: 'linear-gradient(135deg, rgba(248,113,113,0.07), rgba(148,163,184,0.035))' },
    { id: 'grad-citrus', name: 'цитрус', background: 'linear-gradient(135deg, rgba(250,204,21,0.14) 0%, rgba(52,211,153,0.09) 100%)', border: 'rgba(250,204,21,0.18)', softGlowPrimary: 'rgba(250,204,21,0.08)', softGlowSecondary: 'rgba(52,211,153,0.04)', chromeBorder: 'rgba(250,204,21,0.12)', navActive: 'linear-gradient(135deg, rgba(250,204,21,0.065), rgba(52,211,153,0.035))' },
    { id: 'grad-berry', name: 'ягода', background: 'linear-gradient(135deg, rgba(244,114,182,0.15) 0%, rgba(129,140,248,0.10) 100%)', border: 'rgba(244,114,182,0.18)', softGlowPrimary: 'rgba(244,114,182,0.09)', softGlowSecondary: 'rgba(129,140,248,0.045)', chromeBorder: 'rgba(244,114,182,0.13)', navActive: 'linear-gradient(135deg, rgba(244,114,182,0.08), rgba(129,140,248,0.04))' },
    { id: 'grad-steel', name: 'сталь', background: 'linear-gradient(135deg, rgba(148,163,184,0.13) 0%, rgba(96,165,250,0.08) 100%)', border: 'rgba(148,163,184,0.18)', softGlowPrimary: 'rgba(148,163,184,0.07)', softGlowSecondary: 'rgba(96,165,250,0.035)', chromeBorder: 'rgba(148,163,184,0.115)', navActive: 'linear-gradient(135deg, rgba(148,163,184,0.06), rgba(96,165,250,0.035))' },
    { id: 'grad-mint', name: 'мята', background: 'linear-gradient(135deg, rgba(110,231,183,0.13) 0%, rgba(240,253,250,0.06) 100%)', border: 'rgba(110,231,183,0.18)', softGlowPrimary: 'rgba(110,231,183,0.075)', softGlowSecondary: 'rgba(240,253,250,0.03)', chromeBorder: 'rgba(110,231,183,0.115)', navActive: 'linear-gradient(135deg, rgba(110,231,183,0.065), rgba(240,253,250,0.025))' },
    { id: 'grad-orchid', name: 'орхидея', background: 'linear-gradient(135deg, rgba(216,180,254,0.15) 0%, rgba(251,207,232,0.08) 100%)', border: 'rgba(216,180,254,0.18)', softGlowPrimary: 'rgba(216,180,254,0.09)', softGlowSecondary: 'rgba(251,207,232,0.04)', chromeBorder: 'rgba(216,180,254,0.13)', navActive: 'linear-gradient(135deg, rgba(216,180,254,0.08), rgba(251,207,232,0.035))' },
    { id: 'grad-ocean', name: 'океан', background: 'linear-gradient(135deg, rgba(14,165,233,0.14) 0%, rgba(99,102,241,0.10) 100%)', border: 'rgba(14,165,233,0.18)', softGlowPrimary: 'rgba(14,165,233,0.085)', softGlowSecondary: 'rgba(99,102,241,0.045)', chromeBorder: 'rgba(14,165,233,0.12)', navActive: 'linear-gradient(135deg, rgba(14,165,233,0.075), rgba(99,102,241,0.04))' },
    { id: 'grad-magma', name: 'магма', background: 'linear-gradient(135deg, rgba(239,68,68,0.13) 0%, rgba(217,119,6,0.10) 100%)', border: 'rgba(239,68,68,0.18)', softGlowPrimary: 'rgba(239,68,68,0.08)', softGlowSecondary: 'rgba(217,119,6,0.045)', chromeBorder: 'rgba(239,68,68,0.12)', navActive: 'linear-gradient(135deg, rgba(239,68,68,0.07), rgba(217,119,6,0.04))' },
    { id: 'grad-ice', name: 'лёд', background: 'linear-gradient(135deg, rgba(186,230,253,0.12) 0%, rgba(196,181,253,0.09) 100%)', border: 'rgba(186,230,253,0.18)', softGlowPrimary: 'rgba(186,230,253,0.07)', softGlowSecondary: 'rgba(196,181,253,0.04)', chromeBorder: 'rgba(186,230,253,0.11)', navActive: 'linear-gradient(135deg, rgba(186,230,253,0.06), rgba(196,181,253,0.035))' },
    { id: 'grad-neon', name: 'неон', background: 'linear-gradient(135deg, rgba(34,211,238,0.13) 0%, rgba(244,114,182,0.10) 100%)', border: 'rgba(34,211,238,0.18)', softGlowPrimary: 'rgba(34,211,238,0.08)', softGlowSecondary: 'rgba(244,114,182,0.045)', chromeBorder: 'rgba(34,211,238,0.12)', navActive: 'linear-gradient(135deg, rgba(34,211,238,0.07), rgba(244,114,182,0.04))' },
    { id: 'grad-olive', name: 'олива', background: 'linear-gradient(135deg, rgba(132,204,22,0.13) 0%, rgba(234,179,8,0.08) 100%)', border: 'rgba(132,204,22,0.18)', softGlowPrimary: 'rgba(132,204,22,0.075)', softGlowSecondary: 'rgba(234,179,8,0.04)', chromeBorder: 'rgba(132,204,22,0.115)', navActive: 'linear-gradient(135deg, rgba(132,204,22,0.065), rgba(234,179,8,0.035))' },
    { id: 'grad-cosmic', name: 'космос', background: 'linear-gradient(135deg, rgba(167,139,250,0.14) 0%, rgba(45,212,191,0.08) 100%)', border: 'rgba(167,139,250,0.18)', softGlowPrimary: 'rgba(167,139,250,0.085)', softGlowSecondary: 'rgba(45,212,191,0.04)', chromeBorder: 'rgba(167,139,250,0.12)', navActive: 'linear-gradient(135deg, rgba(167,139,250,0.075), rgba(45,212,191,0.035))' },
    { id: 'grad-rose', name: 'роза', background: 'linear-gradient(135deg, rgba(251,113,133,0.14) 0%, rgba(253,186,116,0.08) 100%)', border: 'rgba(251,113,133,0.18)', softGlowPrimary: 'rgba(251,113,133,0.09)', softGlowSecondary: 'rgba(253,186,116,0.045)', chromeBorder: 'rgba(251,113,133,0.13)', navActive: 'linear-gradient(135deg, rgba(251,113,133,0.08), rgba(253,186,116,0.035))' },
    { id: 'grad-night', name: 'ночь', background: 'linear-gradient(135deg, rgba(59,130,246,0.12) 0%, rgba(168,85,247,0.10) 100%)', border: 'rgba(59,130,246,0.18)', softGlowPrimary: 'rgba(59,130,246,0.075)', softGlowSecondary: 'rgba(168,85,247,0.045)', chromeBorder: 'rgba(59,130,246,0.115)', navActive: 'linear-gradient(135deg, rgba(59,130,246,0.065), rgba(168,85,247,0.04))' }
  ];

  function getProfileTheme(id) {
    return PROFILE_THEME_GRADIENTS.find(function (gradient) {
      return gradient.id === id;
    }) || PROFILE_THEME_GRADIENTS[0];
  }

  function applyProfileTheme(id) {
    var gradient = getProfileTheme(id || DEFAULT_PROFILE_GRADIENT_ID);
    var root = document.documentElement;
    root.style.setProperty('--app-theme-glow-primary', gradient.softGlowPrimary);
    root.style.setProperty('--app-theme-glow-secondary', gradient.softGlowSecondary);
    root.style.setProperty('--app-theme-chrome-border', gradient.chromeBorder);
    root.style.setProperty('--app-theme-nav-active', gradient.navActive);
    return gradient;
  }

  function applyProfileHero(hero, id) {
    if (!hero) return getProfileTheme(id);
    var gradient = getProfileTheme(id || DEFAULT_PROFILE_GRADIENT_ID);
    hero.style.setProperty('--profile-hero-bg', gradient.background);
    hero.style.setProperty('--profile-hero-border', gradient.border);
    return gradient;
  }

  function getStoredGradientId() {
    var profile = null;
    try { profile = JSON.parse(localStorage.getItem('profile_v1') || 'null'); } catch (e) {}
    return profile && profile.gradientId ? profile.gradientId : DEFAULT_PROFILE_GRADIENT_ID;
  }

  function applyStoredProfileTheme() {
    return applyProfileTheme(getStoredGradientId());
  }

  window.ProfileTheme = {
    defaultId: DEFAULT_PROFILE_GRADIENT_ID,
    list: PROFILE_THEME_GRADIENTS,
    get: getProfileTheme,
    apply: applyProfileTheme,
    applyProfileHero: applyProfileHero,
    applyStored: applyStoredProfileTheme
  };

  applyStoredProfileTheme();
}());
