(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else {
    root.EyesUI = factory();
    var boot = function () {
      root.EyesUI.create({ window: root, document: root.document }).init();
    };
    if (root.document.readyState === 'loading')
      root.document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  }
})(typeof window === 'object' ? window : globalThis, function () {
  'use strict';
  function create(o) {
    var w = o.window,
      doc = o.document,
      D = o.data || w.EyesData,
      C = o.core || w.EyesCore,
      S = o.session || w.EyesSession,
      G = w.Gamification;
    var uuid =
        o.uuid ||
        function () {
          return w.crypto.randomUUID();
        },
      now = function () {
        return w.performance.now();
      },
      owner =
        o.getOwner ||
        function () {
          var u = w.SupabaseSync && w.SupabaseSync.getUser();
          return u ? u.id : 'local';
        };
    var store =
      o.store ||
      w.EyesStore.create({
        storage: w.localStorage,
        get: G && G.storeGet,
        set: G && G.storeSet,
        events: w,
        getOwner: owner,
        uuid: uuid,
        reducedMotion: w.matchMedia('(prefers-reduced-motion: reduce)').matches,
      });
    var tab;
    try {
      tab = w.sessionStorage.getItem('_eye_break_tab');
      if (!tab) {
        tab = uuid();
        w.sessionStorage.setItem('_eye_break_tab', tab);
      }
    } catch (_) {
      tab = uuid();
    }
    var coord =
      o.coordination ||
      w.EyesCoordination.create({
        locks: w.navigator.locks,
        indexedDB: w.indexedDB,
        storage: w.localStorage,
        now: Date.now,
        uuid: uuid,
        tabId: tab,
        channelFactory:
          typeof w.BroadcastChannel === 'function'
            ? function (n) {
                return new w.BroadcastChannel(n);
              }
            : null,
      });
    var settings = store.settings(),
      state = null,
      saved = null,
      token = null,
      raf = null,
      heartbeat = null,
      pending = false,
      finished = false,
      lastSaved = 0,
      lastCue = '',
      lastStage = '',
      audio = null,
      unsubscribe = null,
      activeSettings = null;
    function el(id) {
      return doc.getElementById(id);
    }
    function on(id, type, fn) {
      el(id).addEventListener(type, fn);
    }
    function notice(text) {
      el('eyeError').textContent = text || '';
      el('eyeError').hidden = !text;
    }
    function plan() {
      return C.buildPlan({
        mode: settings.mode,
        durationSeconds: settings.durationSeconds,
        exerciseIds: settings.exerciseIds,
      });
    }
    function persist() {
      try {
        settings = store.saveSettings(settings);
        notice('');
      } catch (_) {
        notice(
          'Не удалось сохранить настройки. Проверь доступ браузера к локальным данным.',
        );
      }
      render();
    }
    function choose(mode, id) {
      settings.mode = mode;
      if (id) settings.exerciseIds = [id];
      persist();
    }
    function setDuration(seconds) {
      settings.durationSeconds = seconds;
      persist();
    }
    function render() {
      var p = plan(),
        ids = p.ok
          ? p.stages.map(function (s) {
              return s.exerciseId;
            })
          : settings.mode === 'full'
            ? D.IDS
            : settings.exerciseIds;
      doc.querySelectorAll('[data-duration]').forEach(function (b) {
        b.setAttribute(
          'aria-pressed',
          String(Number(b.dataset.duration) === settings.durationSeconds),
        );
      });
      doc.querySelectorAll('[data-exercise]').forEach(function (b) {
        b.checked = ids.indexOf(b.dataset.exercise) >= 0;
      });
      el('speedSelect').value = settings.speed;
      el('dotSize').value = settings.dotSize;
      el('dotColor').value = settings.dotColor;
      [
        'showPath',
        'soundEnabled',
        'vibrationEnabled',
        'fullscreenEnabled',
        'reminderEnabled',
      ].forEach(function (k) {
        el(k).checked = settings[k];
      });
      el('presetShort').setAttribute(
        'aria-pressed',
        String(settings.mode === 'short'),
      );
      el('presetFull').setAttribute(
        'aria-pressed',
        String(settings.mode === 'full'),
      );
      el('startEye').disabled = !p.ok || pending;
      el('planMessage').textContent = p.ok
        ? p.stages.length +
          ' упражн. · ' +
          settings.durationSeconds +
          ' секунд всего'
        : p.error === 'DURATION_TOO_SHORT'
          ? 'Для этого набора нужно не меньше ' + p.requiredSeconds + ' секунд.'
          : 'Выбери хотя бы одно упражнение.';
      el('durationFix').hidden = p.error !== 'DURATION_TOO_SHORT';
      el('durationFix').textContent =
        'Выбрать ' +
        ([30, 60, 120, 180].find(function (n) {
          return n >= p.requiredSeconds;
        }) || 180) +
        ' секунд';
      var summary = store.summary();
      el('statsDays').textContent = String(summary.streakDays);
      el('statsSessions').textContent = String(summary.sessions);
      el('statsMinutes').textContent = new Intl.NumberFormat('ru-RU', {
        maximumFractionDigits: 1,
      }).format(summary.minutes);
      el('resumePanel').hidden = !saved || !!state;
    }
    function unlockAudio() {
      if (!settings.soundEnabled) return;
      try {
        var A = w.AudioContext || w.webkitAudioContext;
        if (A && !audio) audio = new A();
        if (audio && audio.state === 'suspended')
          audio.resume().catch(function () {});
      } catch (_) {
        audio = null;
      }
    }
    function cue(id) {
      if (id === lastCue) return;
      lastCue = id;
      try {
        if (audio && activeSettings.soundEnabled && audio.state === 'running') {
          var osc = audio.createOscillator(),
            gain = audio.createGain();
          osc.type = 'sine';
          osc.frequency.value = id.indexOf(':1') >= 0 ? 560 : 440;
          gain.gain.setValueAtTime(0.045, audio.currentTime);
          gain.gain.exponentialRampToValueAtTime(
            0.001,
            audio.currentTime + 0.16,
          );
          osc.connect(gain);
          gain.connect(audio.destination);
          osc.start();
          osc.stop(audio.currentTime + 0.18);
        }
        if (activeSettings.vibrationEnabled && w.navigator.vibrate)
          w.navigator.vibrate(30);
      } catch (_) {}
    }
    function saveActive() {
      if (!state || ['running', 'paused'].indexOf(state.phase) < 0) return;
      try {
        store.saveActive(
          Object.assign({}, state, { settings: activeSettings }),
        );
        lastSaved = now();
      } catch (_) {
        notice('Таймер работает, но сохранить прогресс не удалось.');
      }
    }
    function stopFrames() {
      if (raf !== null) w.cancelAnimationFrame(raf);
      raf = null;
    }
    function leaveFullscreen() {
      if (doc.fullscreenElement && doc.exitFullscreen)
        try {
          var f = doc.exitFullscreen();
          if (f && f.catch) f.catch(function () {});
        } catch (_) {}
    }
    function ownerChanged() {
      if (!state || state.owner === owner()) return false;
      state = S.cancelSession(state, now());
      back();
      notice(
        'Аккаунт изменился. Предыдущее занятие не будет записано в новый аккаунт.',
      );
      return true;
    }
    function release() {
      if (heartbeat !== null) w.clearInterval(heartbeat);
      heartbeat = null;
      if (token) {
        coord.releaseSession(token).catch(function () {});
        token = null;
      }
    }
    function chart(v) {
      if (lastStage === v.exerciseId) return;
      lastStage = v.exerciseId;
      var points = [];
      for (var i = 0; i <= 120; i++) {
        var p = C.positionAt({
          exerciseId: v.exerciseId,
          elapsedMs: (i * 8000) / 120,
          stageDurationMs:
            state.plan.stages[v.stageIndex].durationSeconds * 1000,
          speed: 'normal',
        });
        points.push(p.x * 100 + ',' + p.y * 100);
      }
      el('pathGuide').setAttribute('points', points.join(' '));
    }
    function paint() {
      if (!state) return;
      var v = S.sessionView(state),
        item = D.CATALOG.find(function (x) {
          return x.id === v.exerciseId;
        });
      el('stageTitle').textContent = item.title;
      el('eyeStage').textContent =
        'Упражнение ' + (v.stageIndex + 1) + ' из ' + state.plan.stages.length;
      var sec = Math.ceil(v.remainingMs / 1000);
      el('eyeTime').textContent =
        Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
      el('eyeProgress').value = v.progress;
      el('pauseEye').textContent =
        state.phase === 'paused' ? 'Продолжить' : 'Пауза';
      var rest = item.kind === 'rest',
        instruction = C.instructionAt({
          exerciseId: item.id,
          elapsedMs: v.stageElapsedMs,
          speed: activeSettings.speed,
        });
      el('eyeDot').hidden = rest;
      el('stagePrompt').hidden = !rest;
      el('stagePrompt').textContent = instruction.text;
      el('pathGuide').hidden =
        rest || !activeSettings.showPath || item.id === 'jumps';
      if (!rest) {
        var size = { small: 18, medium: 26, large: 36 }[activeSettings.dotSize],
          color = {
            amber: '#f2c063',
            mint: '#89d8bd',
            white: '#f5f5f5',
            pink: '#f4a6c1',
          }[activeSettings.dotColor];
        el('eyeDot').style.width = size + 'px';
        el('eyeDot').style.height = size + 'px';
        el('eyeDot').style.background = color;
        var p = C.positionAt({
          exerciseId: item.id,
          elapsedMs: v.stageElapsedMs,
          stageDurationMs:
            state.plan.stages[v.stageIndex].durationSeconds * 1000,
          speed: activeSettings.speed,
        });
        el('eyeDot').style.transform =
          'translate3d(' +
          p.x * el('motionArea').clientWidth +
          'px,' +
          p.y * el('motionArea').clientHeight +
          'px,0) translate(-50%,-50%)';
        chart(v);
      }
      if (state.phase === 'running') cue(instruction.cueId);
    }
    function finish() {
      if (finished || ownerChanged()) return;
      finished = true;
      stopFrames();
      release();
      leaveFullscreen();
      var record = S.completionRecord(state, new Date().toISOString());
      var savedOk = false;
      try {
        if (record) {
          store.recordCompletion(record);
          savedOk = true;
        }
        store.clearActive(state.id);
      } catch (_) {
        notice('Занятие закончено, но сохранить статистику не удалось.');
      }
      if (record && w.EyesReminder) {
        var reset = w.EyesReminder.onExerciseCompleted(record);
        if (reset && reset.catch)
          reset.catch(function () {
            notice('Не удалось обновить срок напоминания.');
          });
      }
      el('eyePlayer').hidden = true;
      el('eyeResult').hidden = false;
      el('resultTitle').textContent = record
        ? 'Готово. Можно возвращаться к делам'
        : 'Занятие с пропусками';
      el('resultText').textContent = record
        ? savedOk
          ? 'Разминка сохранена: ' +
            state.plan.durationSeconds +
            ' секунд практики.'
          : 'Статистика не сохранена — локальное хранилище недоступно.'
        : 'Пропущенные этапы не засчитаны как выполненный комплекс.';
      doc.body.classList.remove('eye-playing');
      render();
    }
    function frame() {
      raf = null;
      if (!state || state.phase !== 'running' || ownerChanged()) return;
      state = S.advanceSession(state, now());
      paint();
      if (state.phase === 'completed') {
        finish();
        return;
      }
      if (now() - lastSaved >= 5000) saveActive();
      raf = w.requestAnimationFrame(frame);
    }
    async function start(candidate) {
      if (pending) return false;
      var p = candidate ? candidate.plan : plan();
      if (!p.ok) {
        render();
        return false;
      }
      if (
        w.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        p.stages.some(function (s) {
          return (
            D.CATALOG.find(function (x) {
              return x.id === s.exerciseId;
            }).kind === 'motion'
          );
        }) &&
        !w.confirm(
          'В этом комплексе есть движущаяся точка. Запустить выбранные упражнения?',
        )
      )
        return false;
      unlockAudio();
      if (
        settings.fullscreenEnabled &&
        doc.documentElement &&
        doc.documentElement.requestFullscreen
      ) {
        try {
          var f = doc.documentElement.requestFullscreen();
          if (f && f.catch) f.catch(function () {});
        } catch (_) {}
      }
      pending = true;
      render();
      var id = candidate ? candidate.id : uuid(),
        requestOwner = owner();
      try {
        var claim = await coord.claimSession({ id: id, owner: requestOwner });
        if (!claim.ok) {
          leaveFullscreen();
          notice(
            'Разминка уже открыта в другой вкладке. Заверши её там или вернись к ней.',
          );
          return false;
        }
        token = claim.token;
        if (requestOwner !== owner()) {
          release();
          leaveFullscreen();
          return false;
        }
        state = candidate
          ? S.resumeSession(candidate, now())
          : S.createSession(p, {
              id: id,
              epoch: store.epoch(),
              owner: requestOwner,
              nowMs: now(),
            });
        activeSettings =
          candidate && candidate.settings
            ? D.normalizeSettings(candidate.settings)
            : Object.assign({}, settings);
        finished = false;
        saved = null;
        lastCue = '';
        lastStage = '';
        el('eyeHome').hidden = true;
        el('eyeResult').hidden = true;
        el('eyePlayer').hidden = false;
        doc.body.classList.add('eye-playing');
        notice('');
        saveActive();
        paint();
        stopFrames();
        raf = w.requestAnimationFrame(frame);
        heartbeat = w.setInterval(function () {
          if (doc.hidden) return;
          coord
            .renewSession(token)
            .then(function (ok) {
              if (!ok) {
                pause();
                notice(
                  'Владение таймером потеряно. Нажми «Продолжить», чтобы проверить другую вкладку.',
                );
              }
            })
            .catch(function () {
              pause();
              notice('Не удалось проверить вкладку. Таймер приостановлен.');
            });
        }, 5000);
        return true;
      } catch (_) {
        release();
        leaveFullscreen();
        notice(
          'Не удалось запустить таймер. Для координации вкладок нужен доступ к данным браузера.',
        );
        return false;
      } finally {
        pending = false;
        render();
      }
    }
    function pause() {
      if (!state || ownerChanged()) return;
      state = S.pauseSession(state, now());
      stopFrames();
      if (state.phase === 'completed') {
        finish();
        return;
      }
      saveActive();
      paint();
    }
    async function togglePause() {
      if (!state || ownerChanged()) return;
      if (state.phase === 'running') {
        pause();
        return;
      }
      if (state.phase === 'paused') {
        try {
          var claim = await coord.claimSession({
            id: state.id,
            owner: owner(),
          });
          if (!claim.ok) {
            notice('Таймер занят в другой вкладке.');
            return;
          }
          token = claim.token;
          unlockAudio();
          state = S.resumeSession(state, now());
          paint();
          raf = w.requestAnimationFrame(frame);
        } catch (_) {
          notice('Не удалось продолжить. Проверь доступ к данным браузера.');
        }
      }
    }
    function back() {
      release();
      stopFrames();
      leaveFullscreen();
      state = null;
      saved = null;
      el('eyePlayer').hidden = true;
      el('eyeResult').hidden = true;
      el('eyeHome').hidden = false;
      doc.body.classList.remove('eye-playing');
      render();
      el('startEye').focus();
    }
    function exit() {
      if (
        state &&
        w.confirm(
          'Завершить разминку? Незаконченный комплекс не попадёт в статистику.',
        )
      ) {
        state = S.cancelSession(state, now());
        try {
          store.clearActive(state.id);
        } catch (_) {}
        back();
      }
    }
    function catalogue() {
      var glyphs = ['↔', '↕', '↘', '↙', '○', '∞', '⠿', '◎', '◉', '◡', '◡'];
      el('exerciseList').replaceChildren();
      D.CATALOG.forEach(function (item, i) {
        var row = doc.createElement('article');
        row.className = 'eye-exercise';
        var icon = doc.createElement('span');
        icon.className = 'eye-exercise-icon';
        icon.textContent = glyphs[i];
        icon.setAttribute('aria-hidden', 'true');
        var label = doc.createElement('label'),
          check = doc.createElement('input');
        check.type = 'checkbox';
        check.dataset.exercise = item.id;
        check.setAttribute('aria-label', 'Включить: ' + item.title);
        var text = doc.createElement('span');
        text.className = 'eye-exercise-text';
        var title = doc.createElement('strong');
        title.textContent = item.title;
        var sub = doc.createElement('small');
        sub.textContent = item.instruction;
        text.append(title, sub);
        label.append(check, text);
        var only = doc.createElement('button');
        only.type = 'button';
        only.className = 'eye-text-button';
        only.textContent = '↗';
        only.setAttribute('aria-label', 'Только ' + item.title);
        only.addEventListener('click', function () {
          choose('single', item.id);
          el('startEye').focus();
        });
        check.addEventListener('change', function () {
          settings.exerciseIds = Array.from(
            doc.querySelectorAll('[data-exercise]'),
          )
            .filter(function (x) {
              return x.checked;
            })
            .map(function (x) {
              return x.dataset.exercise;
            });
          settings.mode = 'custom';
          persist();
        });
        row.append(icon, label, only);
        el('exerciseList').appendChild(row);
      });
    }
    function init() {
      catalogue();
      doc.querySelectorAll('[data-duration]').forEach(function (b) {
        b.addEventListener('click', function () {
          setDuration(Number(b.dataset.duration));
        });
      });
      on('presetShort', 'click', function () {
        choose('short');
        return start();
      });
      on('presetFull', 'click', function () {
        choose('full');
        return start();
      });
      on('presetCustom', 'click', function () {
        choose('custom');
      });
      on('startEye', 'click', function () {
        return start();
      });
      on('durationFix', 'click', function () {
        var p = plan();
        setDuration(
          [30, 60, 120, 180].find(function (n) {
            return n >= p.requiredSeconds;
          }) || 180,
        );
      });
      ['speedSelect', 'dotSize', 'dotColor'].forEach(function (id) {
        on(id, 'change', function () {
          settings[id === 'speedSelect' ? 'speed' : id] = el(id).value;
          persist();
        });
      });
      [
        'showPath',
        'soundEnabled',
        'vibrationEnabled',
        'fullscreenEnabled',
        'reminderEnabled',
      ].forEach(function (id) {
        on(id, 'change', function () {
          settings[id] = el(id).checked;
          persist();
          if (w.EyesReminder) w.EyesReminder.configure();
        });
      });
      on('pauseEye', 'click', togglePause);
      on('nextEye', 'click', function () {
        if (!state) return;
        state = S.skipStage(state, now());
        paint();
        saveActive();
        if (state.phase === 'completed') finish();
      });
      on('exitEye', 'click', exit);
      on('againEye', 'click', function () {
        back();
        return start();
      });
      on('backEye', 'click', back);
      on('resetEyeStats', 'click', function () {
        if (
          w.confirm(
            'Сбросить только статистику разминки? Настройки, привычки и монеты сохранятся.',
          )
        )
          try {
            store.resetStats();
            render();
          } catch (_) {
            notice('Не удалось сбросить статистику.');
          }
      });
      var raw = store.loadActive();
      saved = raw
        ? S.restoreSession(raw, { owner: owner(), nowMs: now() })
        : null;
      if (saved && raw.settings) saved.settings = raw.settings;
      on('resumeEye', 'click', function () {
        return saved ? start(saved) : false;
      });
      on('discardEye', 'click', function () {
        if (w.confirm('Отменить незавершённую разминку?')) {
          try {
            store.clearActive();
          } catch (_) {}
          saved = null;
          render();
        }
      });
      doc.addEventListener('visibilitychange', function () {
        if (doc.hidden) pause();
      });
      w.addEventListener('pagehide', function () {
        pause();
        stopFrames();
        if (heartbeat !== null) w.clearInterval(heartbeat);
      });
      w.addEventListener('resize', paint);
      doc.addEventListener('keydown', function (e) {
        if (
          !state ||
          ['INPUT', 'SELECT', 'TEXTAREA'].indexOf(
            e.target && e.target.tagName,
          ) >= 0 ||
          (e.target && e.target.isContentEditable)
        )
          return;
        if (e.key === ' ') {
          e.preventDefault();
          togglePause();
        } else if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          el('nextEye').click();
        } else if (e.key === 'Escape' && !doc.fullscreenElement) exit();
      });
      w.addEventListener('eyes-reminder-error', function () {
        notice(
          'Напоминание недоступно. Проверь разрешение браузера на локальные данные.',
        );
      });
      unsubscribe = store.subscribe(function () {
        ownerChanged();
        settings = store.settings();
        render();
      });
      render();
    }
    return {
      init: init,
      start: start,
      choose: choose,
      setDuration: setDuration,
      destroy: function () {
        stopFrames();
        release();
        if (unsubscribe) unsubscribe();
        if (audio && audio.close) audio.close().catch(function () {});
        coord.close();
      },
    };
  }
  return { create: create };
});
