(function () {
  'use strict';
  var P = window.IdentityPath,
    G = window.Gamification;
  var store = window.IdentityPathStore.create({
    storage: localStorage,
    events: window,
    write: function (k, v) {
      G.storeSet(k, v);
    },
  });
  var $ = function (id) {
    return document.getElementById(id);
  };
  var selectedId = null,
    path = null,
    views = [],
    scene = null,
    sceneLoading = false,
    editorId = null,
    editorRevision = null,
    avatarRevision = null;
  var errorMessages = {
    STALE_REVISION:
      'Путь изменился в другой вкладке или после синхронизации. Черновик сохранён в форме. Закрой редактор, проверь изменения и открой его снова.',
    UNSUPPORTED_VERSION:
      'Версия сохранённого пути не поддерживается. Обнови приложение. Данные не изменены.',
    INVALID_DATA:
      'Проверь название, даты и условия. Если ошибка появляется при загрузке — сохранённые данные повреждены; они не перезаписаны.',
    STAGE_ACCEPTED:
      'Эта ступень уже принята. История сохраняется без изменений.',
    PREVIOUS_STAGE_REQUIRED: 'Сначала прими предыдущую ступень.',
    CRITERIA_NOT_MET: 'Не все обязательные условия выполнены.',
    STAGE_LIMIT: 'В одном пути можно создать до 24 ступеней.',
    PATH_EXISTS: 'Путь уже создан. Обнови страницу.',
    PATH_MISSING: 'Сначала создай свой путь.',
    DESTINATION_LAST: 'Ориентир «Я» остаётся последней ступенью.',
    DESTINATION_EXISTS:
      'Ориентир «Я» уже есть. Отредактируй его или сними отметку в его редакторе.',
    PATH_COMPLETE: 'Финальная версия уже принята. Этот путь завершён.',
  };
  function message(e) {
    return (
      errorMessages[e.code] ||
      'Не удалось сохранить изменения. Проверь доступное место в браузере и попробуй ещё раз.'
    );
  }
  function notify(text, error) {
    $('notice').textContent = text;
    $('notice').className = 'notice' + (error ? ' error' : '');
    $('notice').hidden = false;
  }
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function button(text, action, className) {
    var b = el('button', className || 'text-button', text);
    b.type = 'button';
    b.addEventListener('click', action);
    return b;
  }
  function dateLabel(iso) {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Asia/Yekaterinburg',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(iso.length === 10 ? iso + 'T12:00:00Z' : iso));
  }
  function stateLabel(v) {
    return v.state === 'completed'
      ? 'Принята'
      : v.state === 'ready'
        ? v.isNext
          ? 'Готова к принятию'
          : 'Готова заранее'
        : v.state === 'active'
          ? 'Следующая версия'
          : 'Впереди';
  }
  function stageLabel(v) {
    return v.destination ? 'Я' : P.label(v.index);
  }
  function save(revision, operation, success) {
    try {
      path = store.update(revision, operation);
      render();
      if (success) notify(success);
      return true;
    } catch (e) {
      notify(message(e), true);
      return false;
    }
  }
  function confirmAction(title, text, action) {
    var dialog = $('confirmDialog');
    $('confirmTitle').textContent = title;
    $('confirmText').textContent = text;
    $('confirmAction').textContent = action;
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(function (resolve) {
      dialog.addEventListener(
        'close',
        function () {
          resolve(dialog.returnValue === 'confirm');
        },
        { once: true },
      );
    });
  }
  function ensureScene() {
    if (scene || sceneLoading) return;
    sceneLoading = true;
    import('./path-scene.js?v=1')
      .then(function (mod) {
        scene = mod.createScene($('scene'), function (id) {
          selectedId = id;
          render();
        });
        $('sceneFallback').hidden = true;
        scene.setStages(views, selectedId);
      })
      .catch(function () {
        $('sceneFallback').textContent =
          '3D недоступен в этом браузере. Все ступени и условия доступны ниже.';
        $('sceneHint').textContent = 'Выбирай ступени в траектории';
        $('resetCamera').disabled = true;
      });
  }
  function render() {
    try {
      path = store.read();
    } catch (e) {
      notify(message(e), true);
      $('emptyState').hidden = true;
      $('pathContent').hidden = true;
      $('addStage').hidden = true;
      return;
    }
    $('emptyState').hidden = !!path;
    $('pathContent').hidden = !path;
    $('addStage').hidden = !path;
    if (!path) return;
    views = P.evaluate(path, store.sources());
    $('addStage').hidden = !!views.find(function (v) {
      return v.destination && v.acceptedAt;
    });
    if (
      !views.some(function (v) {
        return v.id === selectedId;
      })
    )
      selectedId = (
        views.find(function (v) {
          return v.isNext;
        }) || views[views.length - 1]
      ).id;
    var v = views.find(function (v) {
      return v.id === selectedId;
    });
    $('sceneTitle').textContent = 'Точка ' + stageLabel(v) + ' · ' + v.title;
    $('compare').disabled = v.index === 0;
    $('compare').value = 100;
    $('compareFrom').textContent = v.index
      ? views[v.index - 1].title
      : 'Исходная точка';
    $('compareTo').textContent = v.title;
    renderDetail(v);
    renderNav();
    ensureScene();
    if (scene) scene.setStages(views, selectedId);
  }
  function renderNav() {
    var nav = $('stageNav');
    nav.replaceChildren();
    views.forEach(function (v) {
      var b = button(
        '',
        function () {
          selectedId = v.id;
          render();
        },
        'stage-stop',
      );
      b.dataset.state = v.state;
      if (v.id === selectedId) b.setAttribute('aria-current', 'step');
      b.append(
        el('span', 'stop-letter', stageLabel(v)),
        el('span', 'stop-title', v.title),
        el('span', 'stop-status', stateLabel(v)),
      );
      nav.append(b);
    });
    var count = views.filter(function (v) {
      return v.acceptedAt && v.index > 0;
    }).length;
    $('routeSummary').textContent =
      count + ' из ' + (views.length - 1) + ' ступеней принято';
  }
  function renderDetail(v) {
    var d = $('stageDetail');
    d.replaceChildren();
    var marker = el('div', 'stage-marker');
    marker.append(
      el('span', 'stage-letter', stageLabel(v)),
      el(
        'span',
        'state-label' + (v.ready ? ' ready' : ''),
        v.index === 0 ? 'Исходная точка' : stateLabel(v),
      ),
    );
    d.append(marker, el('h2', '', v.title));
    if (v.description) d.append(el('p', 'stage-description', v.description));
    if (v.targetDate)
      d.append(el('p', 'stage-date', 'Ориентир: ' + dateLabel(v.targetDate)));
    if (v.acceptedAt) {
      d.append(
        el(
          'p',
          'history-label',
          v.index === 0
            ? 'Отправная точка · ' + dateLabel(v.acceptedAt)
            : 'Принята ' + dateLabel(v.acceptedAt) + ' · снимок сохранён',
        ),
      );
    } else {
      var bar = el('div', 'stage-progress');
      var fill = el('span');
      fill.style.width = v.progress + '%';
      bar.append(fill);
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'Готовность обязательных условий');
      bar.setAttribute('aria-valuenow', v.progress);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      var copy = el('div', 'progress-copy');
      var required = v.criteria.filter(function (c) {
        return c.required;
      });
      copy.append(
        el(
          'span',
          '',
          required.filter(function (c) {
            return c.done;
          }).length +
            ' из ' +
            required.length +
            ' обязательных',
        ),
        el('span', '', v.progress + '%'),
      );
      d.append(bar, copy);
    }
    var list = el('ul', 'criteria-list');
    v.criteria.forEach(function (c) {
      var row = el('li', 'criterion');
      if (c.type === 'manual' && !v.acceptedAt) {
        var checkbox = el('input');
        checkbox.type = 'checkbox';
        checkbox.checked = c.done;
        checkbox.setAttribute('aria-label', c.title);
        checkbox.addEventListener('change', function () {
          save(path.revision, function (p) {
            return P.setManualCriterion(p, v.id, c.id, checkbox.checked);
          });
        });
        row.append(checkbox);
      } else
        row.append(
          el(
            'span',
            c.done ? 'criterion-check' : 'criterion-pending',
            c.done ? '✓' : '○',
          ),
        );
      var body = el('div', 'criterion-body');
      body.append(el('div', 'criterion-title', c.title));
      var meta =
        c.type === 'manual'
          ? 'Подтверждаю самостоятельно'
          : c.type === 'goal'
            ? 'Из целей · ' + c.progress + '%'
            : 'Из трекера · ' + c.current + ' / ' + c.target + ' полных дней';
      body.append(
        el(
          'p',
          'criterion-meta',
          meta + (c.required ? '' : ' · дополнительно'),
        ),
      );
      if (c.warning)
        body.append(
          el(
            'p',
            'criterion-warning',
            'Источник удалён или недоступен. Выбери другой в редакторе.',
          ),
        );
      row.append(body);
      list.append(row);
    });
    d.append(list);
    if (!v.acceptedAt) {
      if (!v.criteria.length)
        d.append(
          el(
            'p',
            'empty-criteria',
            'Добавь обязательные условия, чтобы определить готовность этой версии.',
          ),
        );
      var accept = button(
        'Принять эту версию себя',
        async function () {
          var revision = path.revision;
          var ok = await confirmAction(
            'Принять «' + v.title + '»?',
            v.criteria
              .filter(function (c) {
                return c.required;
              })
              .map(function (c) {
                return '✓ ' + c.title;
              })
              .join('\n') +
              '\n\nСохраним эту ступень и выполненные условия в истории.',
            'Принять версию',
          );
          if (ok)
            save(
              revision,
              function (p) {
                return P.acceptStage(p, v.id, store.sources());
              },
              'Версия принята. Следующая ступень открыта.',
            );
        },
        'button primary accept-button',
      );
      accept.disabled = !v.ready || !v.isNext;
      d.append(accept);
      if (v.ready && !v.isNext)
        d.append(
          el(
            'p',
            'quiet detail-help',
            'Условия уже выполнены. Сначала прими предыдущую ступень — прогресс этой сохранится.',
          ),
        );
      else if (!v.ready)
        d.append(
          el(
            'p',
            'quiet detail-help',
            'Выполни обязательные условия. Затем прими ступень вручную.',
          ),
        );
      var actions = el('div', 'detail-actions');
      actions.append(
        button('Редактировать', function () {
          openEditor(v.id);
        }),
      );
      if (!v.destination && v.index > 1 && !views[v.index - 1].acceptedAt)
        actions.append(
          button('← Раньше', function () {
            save(path.revision, function (p) {
              return P.moveStage(p, v.id, -1);
            });
          }),
        );
      if (
        !v.destination &&
        v.index < views.length - 1 &&
        !views[v.index + 1].destination
      )
        actions.append(
          button('Позже →', function () {
            save(path.revision, function (p) {
              return P.moveStage(p, v.id, 1);
            });
          }),
        );
      actions.append(
        button(
          'Удалить',
          async function () {
            var revision = path.revision;
            if (
              await confirmAction(
                'Удалить будущую ступень?',
                v.title + '\n\nСвязанные цели и отметки трекера сохранятся.',
                'Удалить ступень',
              )
            )
              save(revision, function (p) {
                return P.removeStage(p, v.id);
              });
          },
          'text-button danger-button',
        ),
      );
      d.append(actions);
    } else if (v.index === 0 && views.length === 1) {
      d.append(
        el(
          'p',
          'quiet detail-help',
          'Добавь следующую ступень: опиши желаемую версию себя и выбери условия её достижения.',
        ),
        button(
          '+ Первая ступень',
          function () {
            openEditor();
          },
          'button primary',
        ),
      );
    }
  }
  function labeled(title, input) {
    var label = el('label', '', title);
    label.append(input);
    return label;
  }
  function input(type, value) {
    var n = el('input');
    n.type = type;
    n.value = value || '';
    return n;
  }
  function option(value, title) {
    var n = el('option', '', title);
    n.value = value;
    return n;
  }
  function criterionEditor(c) {
    var row = el('div', 'criterion-editor');
    var head = el('div', 'criterion-editor-head');
    var type = el('select');
    type.setAttribute('aria-label', 'Тип условия');
    type.append(
      option('manual', 'Ручное подтверждение'),
      option('goal', 'Цель из дашборда'),
      option('habit', 'Привычка из трекера'),
    );
    type.value = c.type;
    head.append(
      type,
      button(
        '×',
        function () {
          row.remove();
        },
        'icon-button',
      ),
    );
    head.lastChild.setAttribute('aria-label', 'Удалить условие');
    row.append(head);
    var fields = el('div', 'criterion-fields');
    row.append(fields);
    var required = input('checkbox');
    required.checked = c.required !== false;
    var req = labeled('Обязательное условие', required);
    req.prepend(required);
    req.className = 'required-label';
    row.append(req);
    var readFields;
    function draw() {
      fields.replaceChildren();
      if (type.value === 'manual') {
        var title = input('text', c.type === 'manual' ? c.title : '');
        title.maxLength = 160;
        title.required = true;
        title.placeholder = 'Например, защитил диплом';
        fields.append(labeled('Что подтверждаю', title));
        readFields = function () {
          return {
            title: title.value,
            done: c.type === 'manual' && c.done === true,
          };
        };
      } else if (type.value === 'goal') {
        var select = el('select');
        select.required = true;
        var goals = store.sources().goals;
        select.append(option('', 'Выбери цель'));
        goals.forEach(function (g) {
          select.append(option(g.id, g.title || 'Без названия'));
        });
        if (
          c.type === 'goal' &&
          !goals.some(function (g) {
            return g.id === c.goalId;
          })
        )
          select.append(option(c.goalId, c.title + ' · источник недоступен'));
        select.value = c.type === 'goal' ? c.goalId : '';
        fields.append(labeled('Существующая цель', select));
        fields.append(
          el(
            'p',
            'editor-help',
            goals.length
              ? 'Прогресс обновляется из цели, независимо от её периода.'
              : 'Сначала добавь цель на странице «Цели».',
          ),
        );
        readFields = function () {
          return {
            goalId: select.value,
            title: select.selectedOptions[0]?.textContent || '',
          };
        };
      } else {
        var habits = store.sources().tracker.good || [];
        var habit = el('select');
        habit.required = true;
        habit.append(option('', 'Выбери привычку'));
        habits.forEach(function (h) {
          habit.append(option(h.id, h.name));
        });
        if (
          c.type === 'habit' &&
          !habits.some(function (h) {
            return h.id === c.habitId;
          })
        )
          habit.append(option(c.habitId, c.title + ' · источник недоступен'));
        habit.value = c.type === 'habit' ? c.habitId : '';
        var since = input('date', c.since || P.dayKey());
        since.required = true;
        var target = input('number', c.target || 30);
        target.min = 1;
        target.max = 3650;
        target.step = 1;
        target.required = true;
        fields.append(labeled('Положительная привычка', habit));
        var pair = el('div', 'form-row');
        pair.append(
          labeled('Считать с даты', since),
          labeled('Полных дней', target),
        );
        fields.append(
          pair,
          el(
            'p',
            'editor-help',
            'Считаем только полные отметки до сегодняшнего дня по времени Екатеринбурга.',
          ),
        );
        readFields = function () {
          return {
            habitId: habit.value,
            title: habit.selectedOptions[0]?.textContent || '',
            since: since.value,
            target: Number(target.value),
          };
        };
      }
    }
    type.addEventListener('change', draw);
    draw();
    row.read = function () {
      return Object.assign(
        { id: c.id, type: type.value, required: required.checked },
        readFields(),
      );
    };
    $('criteriaEditor').append(row);
  }
  function openEditor(id) {
    path = store.read();
    editorRevision = path.revision;
    editorId = id || crypto.randomUUID();
    var s = path.stages.find(function (s) {
      return s.id === id;
    });
    if (s?.acceptedAt) return;
    $('stageForm').reset();
    $('editorTitle').textContent = s
      ? 'Редактировать ступень'
      : 'Новая ступень';
    $('editorError').hidden = true;
    $('stageTitle').value = s?.title || '';
    $('stageDescription').value = s?.description || '';
    $('stageDate').value = s?.targetDate || '';
    $('stageDestination').checked = s?.destination === true;
    $('stageEnergy').value = s?.visual.energy ?? 70;
    $('energyOutput').value = $('stageEnergy').value;
    $('stageOutfit').value = s?.visual.outfit || 'casual';
    $('stageScene').value = s?.visual.scene || 'calm';
    $('criteriaEditor').replaceChildren();
    (s?.criteria || []).forEach(criterionEditor);
    $('stageDialog').showModal();
    $('stageTitle').focus();
  }
  $('createPath').addEventListener('click', function () {
    try {
      path = store.initialize();
      selectedId = 'origin';
      render();
    } catch (e) {
      notify(message(e), true);
    }
  });
  $('addStage').addEventListener('click', function () {
    openEditor();
  });
  $('addCriterion').addEventListener('click', function () {
    if ($('criteriaEditor').children.length >= 20) return;
    criterionEditor({
      id: crypto.randomUUID(),
      type: 'manual',
      title: '',
      required: true,
    });
  });
  $('stageEnergy').addEventListener('input', function () {
    $('energyOutput').value = this.value;
  });
  ['closeEditor', 'cancelEditor'].forEach(function (id) {
    $(id).addEventListener('click', function () {
      $('stageDialog').close();
    });
  });
  $('stageForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var draft = {
      id: editorId,
      title: $('stageTitle').value,
      description: $('stageDescription').value,
      targetDate: $('stageDate').value,
      destination: $('stageDestination').checked,
      visual: {
        energy: Number($('stageEnergy').value),
        outfit: $('stageOutfit').value,
        scene: $('stageScene').value,
      },
      criteria: Array.from($('criteriaEditor').children).map(function (row) {
        return row.read();
      }),
    };
    try {
      path = store.update(editorRevision, function (p) {
        return P.upsertStage(p, draft);
      });
      selectedId = editorId;
      $('stageDialog').close();
      render();
      notify('Ступень сохранена.');
    } catch (err) {
      $('editorError').textContent = message(err);
      $('editorError').hidden = false;
    }
  });
  $('editAvatar').addEventListener('click', function () {
    avatarRevision = path.revision;
    $('avatarSkin').value = path.avatar.skin;
    $('avatarHair').value = path.avatar.hair;
    $('avatarError').hidden = true;
    $('avatarDialog').showModal();
  });
  $('cancelAvatar').addEventListener('click', function () {
    $('avatarDialog').close();
  });
  $('avatarForm').addEventListener('submit', function (e) {
    e.preventDefault();
    try {
      path = store.update(avatarRevision, function (p) {
        return P.updateAvatar(p, {
          skin: $('avatarSkin').value,
          hair: $('avatarHair').value,
        });
      });
      $('avatarDialog').close();
      render();
    } catch (err) {
      $('avatarError').textContent = message(err);
      $('avatarError').hidden = false;
    }
  });
  $('compare').addEventListener('input', function () {
    if (scene) scene.compare(Number(this.value) / 100);
  });
  $('resetCamera').addEventListener('click', function () {
    if (scene) scene.resetCamera();
  });
  $('scene').addEventListener('scene-unavailable', function () {
    $('sceneFallback').hidden = false;
    $('sceneFallback').textContent =
      '3D остановлен браузером. Ступени и условия доступны ниже.';
  });
  var queued = false;
  store.subscribe(function () {
    if (!queued) {
      queued = true;
      queueMicrotask(function () {
        queued = false;
        render();
      });
    }
  });
  var refresh = setInterval(function () {
    if (!document.hidden) render();
  }, 60000);
  window.addEventListener('pagehide', function (e) {
    if (!e.persisted) {
      clearInterval(refresh);
      if (scene) scene.dispose();
    }
  });
  render();
})();
