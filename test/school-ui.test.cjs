const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const SchoolCore = require('../school-core.js');
const SchoolMutationQueue = require('../school-mutation-queue.js');
const SchoolUi = require('../school.js');

function read(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

function fakeDocument() {
  function node(tagName) {
    return {
      tagName: tagName.toUpperCase(),
      attributes: {},
      children: [],
      className: '',
      style: {},
      textContent: '',
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      }
    };
  }
  return { createElement: node };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function queueLesson(id, time) {
  const start = `2026-08-03T${time}:00+05:00`;
  return {
    id,
    status: 'Запланирован',
    durationMinutes: 45,
    schedule: SchoolCore.scheduleForDestination({ kind: 'timed', start }, 45)
  };
}

function moveCommand(id, time) {
  return {
    operation: 'moveLesson',
    lessonId: id,
    destination: {
      kind: 'timed',
      start: `2026-08-03T${time}:00+05:00`
    },
    order: id === 'a' ? 100 : 200
  };
}

function moveReducer(command) {
  return (lessons) => lessons.map((lesson) => {
    if (lesson.id !== command.lessonId) return lesson;
    const start = command.destination.start;
    return {
      ...lesson,
      schedule: {
        kind: 'timed',
        date: '2026-08-03',
        start,
        end: SchoolCore.scheduleForDestination(
          { kind: 'timed', start },
          lesson.durationMinutes
        ).end
      }
    };
  });
}

function createQueueController({ mutate }) {
  let serverLessons = [queueLesson('a', '09:00'), queueLesson('b', '09:30')];
  return SchoolUi.createController({
    api: {
      async listLessons() {
        return structuredClone(serverLessons);
      },
      async mutate(command) {
        const result = await mutate(command);
        serverLessons = moveReducer(command)(serverLessons);
        return result;
      }
    },
    core: {
      buildReadModel(lessons) {
        return {
          lessons,
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: lessons.length, partial: 0, missed: 0 },
          activeLessons: [],
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    mutationQueue: SchoolMutationQueue,
    document: null
  });
}

function loadingCore() {
  return {
    buildReadModel(lessons) {
      return {
        lessons,
        today: [],
        weekDays: {},
        diary: [],
        progress: { completed: 0, total: lessons.length, partial: 0, missed: 0 },
        activeLessons: [],
        nextLesson: null,
        persistedDecisions: [],
        runtimeIssues: []
      };
    }
  };
}

function interactiveDocument() {
  const listeners = new Map();
  const nodes = new Map();
  let document;

  function node(tagName, id = '') {
    const value = {
      tagName: tagName.toUpperCase(),
      id,
      attributes: {},
      children: [],
      className: '',
      hidden: false,
      inert: false,
      style: {},
      textContent: '',
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        this.children.splice(this.children.indexOf(child), 1);
      },
      get firstChild() {
        return this.children[0] || null;
      },
      setAttribute(name, valueToSet) {
        this.attributes[name] = String(valueToSet);
      },
      getAttribute(name) {
        return this.attributes[name];
      },
      removeAttribute(name) {
        delete this.attributes[name];
      },
      addEventListener() {},
      querySelectorAll() {
        return id === 'schoolLessonDialog' ? [nodes.get('schoolLessonClose')] : [];
      },
      focus() {
        document.activeElement = this;
        this.focusCount = (this.focusCount || 0) + 1;
      }
    };
    value.classList = {
      add(name) {
        const values = new Set(value.className.split(/\s+/).filter(Boolean));
        values.add(name);
        value.className = [...values].join(' ');
      },
      remove(name) {
        value.className = value.className.split(/\s+/).filter((entry) => entry && entry !== name).join(' ');
      },
      contains(name) {
        return value.className.split(/\s+/).includes(name);
      },
      toggle(name, force) {
        if (force === undefined ? !this.contains(name) : force) this.add(name);
        else this.remove(name);
      }
    };
    if (id) nodes.set(id, value);
    return value;
  }

  document = {
    activeElement: null,
    body: node('body', 'body'),
    createElement(tagName) {
      return node(tagName);
    },
    getElementById(id) {
      return nodes.get(id) || null;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      if (listeners.has(type)) listeners.get(type).delete(handler);
    },
    listenerCount(type) {
      return listeners.has(type) ? listeners.get(type).size : 0;
    },
    dispatchKey(key, options = {}) {
      const event = {
        key,
        shiftKey: Boolean(options.shiftKey),
        prevented: false,
        preventDefault() {
          this.prevented = true;
        }
      };
      [...(listeners.get('keydown') || [])].forEach((handler) => handler(event));
      return event;
    }
  };

  [
    ['main', 'schoolApp'],
    ['section', 'schoolState'],
    ['strong', 'schoolStateTitle'],
    ['span', 'schoolStateText'],
    ['div', 'schoolReady'],
    ['section', 'schoolLoadingSkeleton'],
    ['span', 'schoolLoadingText'],
    ['section', 'schoolSyncBanner'],
    ['span', 'schoolSyncMessage'],
    ['button', 'schoolSyncRetry'],
    ['div', 'schoolLessonDialog'],
    ['button', 'schoolLessonClose'],
    ['h2', 'schoolLessonTitle'],
    ['p', 'schoolLessonSubject'],
    ['div', 'schoolLessonMeta'],
    ['div', 'schoolContentState'],
    ['article', 'schoolLessonContent']
  ].forEach(([tagName, id]) => node(tagName, id));
  nodes.get('schoolLessonDialog').hidden = true;
  nodes.get('schoolReady').hidden = true;
  return { document, nodes };
}

function timelineDocument(scrollMetricsForCreation = () => ({ scrollHeight: 1000, clientHeight: 500 })) {
  const nodes = new Map();
  const timelineScrolls = [];
  let timeScrollCount = 0;

  function node(tagName, initialId = '') {
    const style = {
      setProperty(name, value) {
        this[name] = String(value);
      }
    };
    const value = {
      tagName: tagName.toUpperCase(),
      attributes: {},
      children: [],
      className: '',
      hidden: false,
      style,
      textContent: '',
      scrollTop: 0,
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
      },
      get firstChild() {
        return this.children[0] || null;
      },
      setAttribute(name, valueToSet) {
        this.attributes[name] = String(valueToSet);
      },
      getAttribute(name) {
        return this.attributes[name];
      },
      addEventListener() {}
    };
    value.classList = {
      add(name) {
        const names = new Set(value.className.split(/\s+/).filter(Boolean));
        names.add(name);
        value.className = [...names].join(' ');
      },
      remove(name) {
        value.className = value.className.split(/\s+/).filter((entry) => entry && entry !== name).join(' ');
      },
      contains(name) {
        return value.className.split(/\s+/).includes(name);
      },
      toggle(name, force) {
        if (force === undefined ? !this.contains(name) : force) this.add(name);
        else this.remove(name);
      }
    };
    Object.defineProperty(value, 'id', {
      get() {
        return this._id || '';
      },
      set(id) {
        this._id = id;
        if (id) {
          nodes.set(id, value);
          if (id === 'schoolTimeScroll') {
            const metrics = scrollMetricsForCreation(timeScrollCount++) || {};
            value.scrollHeight = metrics.scrollHeight;
            value.clientHeight = metrics.clientHeight;
            timelineScrolls.push(value);
          }
        }
      }
    });
    if (initialId) value.id = initialId;
    return value;
  }

  ['schoolWeek', 'schoolMobileDays'].forEach((id) => node('div', id));
  return {
    document: {
      createElement(tagName) {
        return node(tagName);
      },
      getElementById(id) {
        return nodes.get(id) || null;
      },
      querySelectorAll() {
        return [];
      }
    },
    nodes,
    timelineScrolls
  };
}

function timelineLifecycleDocument() {
  const nodes = new Map();
  let weekPanel;

  function node(tagName, initialId = '') {
    const listeners = new Map();
    const value = {
      tagName: tagName.toUpperCase(),
      attributes: {},
      children: [],
      className: '',
      hidden: false,
      style: {
        setProperty(name, propertyValue) {
          this[name] = String(propertyValue);
        }
      },
      textContent: '',
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index !== -1) this.children.splice(index, 1);
      },
      get firstChild() {
        return this.children[0] || null;
      },
      setAttribute(name, attributeValue) {
        this.attributes[name] = String(attributeValue);
      },
      getAttribute(name) {
        return this.attributes[name];
      },
      addEventListener(type, listener) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(listener);
      },
      dispatch(type) {
        [...(listeners.get(type) || [])].forEach((listener) => listener({ target: value }));
      }
    };
    value.classList = {
      add(name) {
        const names = new Set(value.className.split(/\s+/).filter(Boolean));
        names.add(name);
        value.className = [...names].join(' ');
      },
      remove(name) {
        value.className = value.className.split(/\s+/).filter((entry) => entry && entry !== name).join(' ');
      },
      contains(name) {
        return value.className.split(/\s+/).includes(name);
      },
      toggle(name, force) {
        if (force === undefined ? !this.contains(name) : force) this.add(name);
        else this.remove(name);
      }
    };
    Object.defineProperty(value, 'id', {
      get() {
        return this._id || '';
      },
      set(id) {
        this._id = id;
        if (id) nodes.set(id, value);
        if (id === 'schoolTimeScroll') {
          let storedScrollTop = 0;
          Object.defineProperties(value, {
            clientHeight: {
              get() {
                return weekPanel && weekPanel.hidden ? 0 : 500;
              }
            },
            scrollHeight: {
              get() {
                return weekPanel && weekPanel.hidden ? 0 : 1000;
              }
            },
            scrollTop: {
              get() {
                return weekPanel && weekPanel.hidden ? 0 : storedScrollTop;
              },
              set(next) {
                if (!(weekPanel && weekPanel.hidden)) storedScrollTop = Number(next) || 0;
              }
            }
          });
        }
      }
    });
    if (initialId) value.id = initialId;
    return value;
  }

  const todayPanel = node('section', 'schoolTodayPanel');
  todayPanel.setAttribute('data-school-panel', 'today');
  weekPanel = node('section', 'schoolWeekPanel');
  weekPanel.hidden = true;
  weekPanel.setAttribute('data-school-panel', 'week');
  const diaryPanel = node('section', 'schoolDiaryPanel');
  diaryPanel.hidden = true;
  diaryPanel.setAttribute('data-school-panel', 'diary');
  ['schoolWeek', 'schoolMobileDays'].forEach((id) => node('div', id));

  return {
    document: {
      createElement(tagName) {
        return node(tagName);
      },
      getElementById(id) {
        return nodes.get(id) || null;
      },
      querySelectorAll(selector) {
        return selector === '[data-school-panel]' ? [todayPanel, weekPanel, diaryPanel] : [];
      }
    },
    nodes
  };
}

test('school page loads shared dashboard dependencies before read-only school scripts', () => {
  const html = read('school.html');
  const scripts = [
    'profile-theme.js?v=401',
    'topbar.js?v=403',
    'supabase-sync.js?v=406-sb',
    'school-core.js',
    'school-api.js',
    'school.js'
  ];

  assert.ok(html.includes('<body data-page="school">'));
  scripts.forEach((script) => assert.ok(html.includes(script), script));
  scripts.slice(1).forEach((script, index) => {
    assert.ok(html.indexOf(scripts[index]) < html.indexOf(script), `${scripts[index]} before ${script}`);
  });
});

test('school page cache-busts release candidate assets together', () => {
  const html = read('school.html');
  assert.ok(html.includes('school-core.js?v=6'));
  assert.ok(html.includes('school.css?v=12'));
  assert.ok(html.includes('school.js?v=12'));
});

test('school shell exposes the three approved views and accessible lesson dialog', () => {
  const html = read('school.html');
  const source = read('school.js');

  ['today', 'week', 'diary'].forEach((view) => {
    assert.ok(html.includes(`data-school-view="${view}"`), view);
    assert.ok(html.includes(`data-school-panel="${view}"`), view);
  });
  assert.ok(html.includes('id="schoolLessonDialog"'));
  assert.ok(html.includes('role="dialog"'));
  assert.ok(html.includes('aria-modal="true"'));
  assert.ok(html.includes('aria-labelledby="schoolLessonTitle"'));
  assert.ok(html.includes('Выполнено 0 из 0'));
  assert.ok(source.includes("'Выполнено ' + progress.completed + ' из ' + progress.total"));
});

test('school week exposes accessible timeline zoom controls', () => {
  const html = read('school.html');
  assert.ok(html.includes('id="schoolZoomOut"'));
  assert.ok(html.includes('aria-label="Уменьшить масштаб времени"'));
  assert.ok(html.includes('id="schoolZoomLabel"'));
  assert.ok(html.includes('id="schoolZoomIn"'));
  assert.ok(html.includes('aria-label="Увеличить масштаб времени"'));
});

test('school shell exposes a global retry for failed notion revalidation', () => {
  const html = read('school.html');
  assert.ok(html.includes('id="schoolSyncBanner"'));
  assert.ok(html.includes('id="schoolSyncMessage"'));
  assert.ok(html.includes('id="schoolSyncRetry"'));
  assert.ok(html.includes('Повторить чтение'));
});

test('loads mutation queue before the school controller', () => {
  const html = read('school.html');
  assert.ok(html.includes('school-mutation-queue.js'));
  assert.ok(html.includes('school.js'));
  assert.ok(
    html.indexOf('school-mutation-queue.js') < html.indexOf('school.js'),
    'queue must load before the controller'
  );
});

test('timeline destination uses the active zoom step', () => {
  assert.deepEqual(
    SchoolUi.timelineDestination(
      SchoolCore,
      '2026-08-03',
      130,
      { top: 10 },
      { startHour: 9 },
      { pixelsPerHour: 120, snapMinutes: 5 }
    ),
    { kind: 'timed', start: '2026-08-03T10:00:00+05:00' }
  );
});

test('timeline drag preview snaps geometry and schedule to the active zoom step', () => {
  const preview = SchoolUi.timelineDragPreview(
    SchoolCore,
    { durationMinutes: 45 },
    '2026-08-03',
    137,
    { top: 10 },
    { startHour: 9 },
    { pixelsPerHour: 120, snapMinutes: 5 }
  );

  assert.equal(preview.destination.start, '2026-08-03T10:05:00+05:00');
  assert.equal(preview.schedule.end, '2026-08-03T10:50:00+05:00');
  assert.equal(preview.top, 130);
  assert.equal(preview.height, 90);
});

test('builds a snapped preview card and line from the destination shown to the user', () => {
  const documentRef = fakeDocument();
  const lesson = {
    title: 'technical reading baseline',
    subject: 'english & ielts'
  };
  const nodes = SchoolUi.makeTimelineDragPreviewNodes(documentRef, lesson, {
    top: 130,
    height: 90,
    schedule: {
      start: '2026-08-03T10:05:00+05:00',
      end: '2026-08-03T10:50:00+05:00'
    }
  });

  assert.equal(nodes.previewNode.className, 'school-time-drag-preview');
  assert.equal(nodes.previewNode.style.top, '130px');
  assert.equal(nodes.previewNode.style.height, '90px');
  assert.equal(nodes.previewNode.children[0].textContent, 'english & ielts');
  assert.equal(nodes.previewNode.children[1].textContent, 'technical reading baseline');
  assert.equal(nodes.previewNode.children[2].textContent, '10:05–10:50');
  assert.equal(nodes.lineNode.className, 'school-time-snap-line');
  assert.equal(nodes.lineNode.style.top, '130px');
});

test('passes a transparent element to the browser drag image contract', () => {
  const dragImageNode = {};
  let received = null;
  const applied = SchoolUi.setTransparentDragImage({
    dataTransfer: {
      setDragImage(node, x, y) {
        received = { node, x, y };
      }
    }
  }, dragImageNode);

  assert.equal(applied, true);
  assert.deepEqual(received, { node: dragImageNode, x: 0, y: 0 });
});

test('drop reuses the snapped destination shown for the same lesson and column', () => {
  const column = {};
  const shownDestination = {
    kind: 'timed',
    start: '2026-08-03T10:05:00+05:00'
  };
  const fallbackDestination = {
    kind: 'timed',
    start: '2026-08-03T10:10:00+05:00'
  };
  const activePreview = {
    node: column,
    lessonId: 'lesson-a',
    destination: shownDestination
  };

  assert.equal(
    SchoolUi.timelineDropDestination(activePreview, column, 'lesson-a', fallbackDestination),
    shownDestination
  );
  assert.equal(
    SchoolUi.timelineDropDestination(activePreview, {}, 'lesson-a', fallbackDestination),
    fallbackDestination
  );
  assert.equal(
    SchoolUi.timelineDropDestination(activePreview, column, 'lesson-b', fallbackDestination),
    fallbackDestination
  );
});

test('short lesson cards keep a compact 44px visual minimum at every zoom level', () => {
  const lesson = {
    id: 'short',
    order: 100,
    schedule: {
      start: '2026-08-03T14:00:00+05:00',
      end: '2026-08-03T14:15:00+05:00'
    }
  };

  [60, 90, 120, 180].forEach((pixelsPerHour) => {
    const layout = SchoolUi.layoutTimedLessons([lesson], pixelsPerHour)[0];
    const visualHeight = (layout.visualEnd - 14 * 60) / 60 * pixelsPerHour;
    assert.ok(visualHeight >= 44, `${pixelsPerHour}px/hour keeps the touch target`);
    assert.ok(visualHeight <= 45, `${pixelsPerHour}px/hour does not inflate the lesson`);
  });
});

test('applies continuous timeline geometry in place without rebuilding the week', () => {
  const shell = {
    attributes: {},
    style: {},
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
  };
  const hourLabel = { style: {} };
  const gridLine = { style: {} };
  const lessonCard = { style: {} };
  const result = SchoolUi.applyTimelineGeometry(SchoolCore, {
    shell,
    startMinute: 9 * 60,
    endMinute: 20 * 60,
    labels: [{ node: hourLabel, minute: 10 * 60 }],
    lines: [{ node: gridLine, minute: 9 * 60 + 30 }],
    cards: [{ node: lessonCard, startMinute: 10 * 60, endMinute: 10 * 60 + 45 }]
  }, 1.4);

  assert.deepEqual(result, {
    pixelsPerHour: 84,
    snapMinutes: 10,
    height: 924
  });
  assert.equal(shell.style['--school-time-height'], '924px');
  assert.equal(shell.attributes['data-school-snap'], '10');
  assert.equal(hourLabel.style.top, '84px');
  assert.equal(gridLine.style.top, '42px');
  assert.equal(lessonCard.style.top, '84px');
  assert.equal(lessonCard.style.height, '63px');
});

test('small wheel deltas accumulate into a smooth cursor-anchored zoom', () => {
  let nextFrame = 0;
  const frames = new Map();
  let windowScrollCalls = 0;
  const viewport = {
    scrollTop: 100,
    getBoundingClientRect() {
      return { top: 10, bottom: 610, height: 600 };
    }
  };
  const shell = {
    classList: { add() {}, remove() {} },
    getBoundingClientRect() {
      const top = 10 - viewport.scrollTop;
      return { top, bottom: top + 660, height: 660 };
    }
  };
  const runtime = {
    requestAnimationFrame(callback) {
      const id = ++nextFrame;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id) {
      frames.delete(id);
    },
    scrollBy() {
      windowScrollCalls += 1;
    }
  };
  const document = {
    getElementById(id) {
      if (id === 'schoolTimeShell') return shell;
      if (id === 'schoolTimeScroll') return viewport;
      return null;
    }
  };
  const controller = SchoolUi.createController({
    api: {},
    core: SchoolCore,
    document,
    runtime
  });
  function runNextFrame(timestamp) {
    const [id, callback] = frames.entries().next().value;
    frames.delete(id);
    callback(timestamp);
  }
  function wheel(deltaY) {
    return {
      clientY: 70,
      ctrlKey: true,
      deltaY,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      }
    };
  }

  const first = wheel(-20);
  const second = wheel(-20);
  const third = wheel(-20);
  controller.handleTimelineWheel(first, shell, { startHour: 9, endHour: 20 });
  controller.handleTimelineWheel(second, shell, { startHour: 9, endHour: 20 });
  assert.equal(frames.size, 0, 'sub-threshold deltas wait for the next wheel event');
  controller.handleTimelineWheel(third, shell, { startHour: 9, endHour: 20 });
  assert.equal(first.prevented, true);
  assert.equal(second.prevented, true);
  assert.equal(third.prevented, true);
  assert.equal(frames.size, 1);
  assert.deepEqual(controller.getTimelineZoomState(), {
    currentScale: 1,
    targetScale: 1.1,
    wheelDelta: 0,
    animating: true
  });

  runNextFrame(0);
  runNextFrame(80);
  assert.ok(controller.getTimelineZoomState().currentScale > 1);
  assert.ok(controller.getTimelineZoomState().currentScale < 1.1);
  runNextFrame(160);
  assert.deepEqual(controller.getTimelineZoomState(), {
    currentScale: 1.1,
    targetScale: 1.1,
    wheelDelta: 0,
    animating: false
  });
  assert.ok(Math.abs(viewport.scrollTop - 116) < 0.001);
  assert.equal(windowScrollCalls, 0);
});

test('timeline button zoom centers the visible part of the internal viewport', () => {
  assert.equal(
    SchoolUi.visibleTimelineClientY(
      { top: -100, bottom: 680, height: 780 },
      { top: 100, bottom: 500, height: 400 }
    ),
    300
  );
  assert.equal(
    SchoolUi.visibleTimelineClientY(
      { top: 700, bottom: 1480, height: 780 },
      { top: 100, bottom: 500, height: 400 }
    ),
    1090
  );
});

test('timeline wheel zoom requires ctrl or meta and keeps modifier input claimed at limits', () => {
  const shell = {
    classList: { add() {}, remove() {} },
    getBoundingClientRect() {
      return { top: 0, bottom: 600, height: 600 };
    }
  };
  const controller = SchoolUi.createController({
    api: {},
    core: SchoolCore,
    document: { getElementById() { return shell; } },
    runtime: {
      matchMedia() {
        return { matches: true };
      },
      requestAnimationFrame() {
        throw new Error('reduced motion must not schedule a frame');
      },
      scrollBy() {}
    }
  });
  function wheel(deltaY, modifiers) {
    return {
      clientY: 70,
      deltaY,
      ...modifiers,
      prevented: false,
      preventDefault() {
        this.prevented = true;
      }
    };
  }

  const atMinimum = wheel(60, { ctrlKey: true });
  controller.handleTimelineWheel(atMinimum, shell, { startHour: 9, endHour: 20 });
  assert.equal(atMinimum.prevented, true);
  assert.equal(controller.getTimelineZoomState().currentScale, 1);

  const ordinaryScroll = wheel(-60, {});
  controller.handleTimelineWheel(ordinaryScroll, shell, { startHour: 9, endHour: 20 });
  assert.equal(ordinaryScroll.prevented, false);
  assert.equal(controller.getTimelineZoomState().currentScale, 1);

  const ctrlZoom = wheel(-60, { ctrlKey: true });
  controller.handleTimelineWheel(ctrlZoom, shell, { startHour: 9, endHour: 20 });
  assert.equal(ctrlZoom.prevented, true);
  assert.equal(controller.getTimelineZoomState().currentScale, 1.1);

  for (let index = 0; index < 19; index += 1) {
    controller.handleTimelineWheel(
      wheel(-60, { metaKey: true }),
      shell,
      { startHour: 9, endHour: 20 }
    );
  }
  assert.equal(controller.getTimelineZoomState().currentScale, 3);

  const atLimit = wheel(-60, { metaKey: true });
  controller.handleTimelineWheel(atLimit, shell, { startHour: 9, endHour: 20 });
  assert.equal(atLimit.prevented, true);
  assert.equal(controller.getTimelineZoomState().currentScale, 3);
});

test('reduced motion applies zoom immediately and drag finalization cancels animation', () => {
  let nextFrame = 0;
  const frames = new Map();
  const viewport = {
    scrollTop: 100,
    getBoundingClientRect() {
      return { top: 10, bottom: 610, height: 600 };
    }
  };
  const shell = {
    classList: { add() {}, remove() {} },
    getBoundingClientRect() {
      return { top: 10, bottom: 610, height: 600 };
    }
  };
  const document = {
    getElementById(id) {
      if (id === 'schoolTimeShell') return shell;
      if (id === 'schoolTimeScroll') return viewport;
      return null;
    }
  };
  const animated = SchoolUi.createController({
    api: {},
    core: SchoolCore,
    document,
    runtime: {
      requestAnimationFrame(callback) {
        const id = ++nextFrame;
        frames.set(id, callback);
        return id;
      },
      cancelAnimationFrame(id) {
        frames.delete(id);
      },
      scrollBy() {
        throw new Error('timeline zoom must not scroll the window');
      }
    }
  });
  const animatedWheel = {
    clientY: 70,
    ctrlKey: true,
    deltaY: -60,
    preventDefault() {}
  };
  animated.handleTimelineWheel(animatedWheel, shell, { startHour: 9, endHour: 20 });
  assert.equal(frames.size, 1);
  animated.finishTimelineZoom();
  assert.equal(frames.size, 0);
  assert.equal(animated.getTimelineZoomState().currentScale, 1.1);

  const reduced = SchoolUi.createController({
    api: {},
    core: SchoolCore,
    document,
    runtime: {
      matchMedia() {
        return { matches: true };
      },
      requestAnimationFrame() {
        throw new Error('reduced motion must not schedule a frame');
      },
      scrollBy() {
        throw new Error('timeline zoom must not scroll the window');
      }
    }
  });
  viewport.scrollTop = 100;
  reduced.handleTimelineWheel({
    clientY: 70,
    ctrlKey: true,
    deltaY: -60,
    preventDefault() {}
  }, shell, { startHour: 9, endHour: 20 });
  assert.equal(reduced.getTimelineZoomState().currentScale, 1.1);
  assert.ok(viewport.scrollTop > 100);
});

test('school styles distinguish quarter ten and five minute lines', () => {
  const css = read('school.css');
  const source = read('school.js');
  assert.ok(css.includes('.school-time-line.is-quarter'));
  assert.ok(css.includes('.school-time-line.is-ten'));
  assert.ok(css.includes('.school-time-line.is-five'));
  assert.ok(css.includes('[data-school-snap="15"]'));
  assert.ok(css.includes('[data-school-snap="10"]'));
  assert.ok(css.includes('[data-school-snap="5"]'));
  assert.ok(css.includes('.school-zoom-controls'));
  assert.match(source, /minute\s*\+=\s*5/);
});

test('school layout keeps mobile targets accessible and document overflow contained', () => {
  const css = read('school.css');

  assert.ok(css.includes('grid-template-columns: repeat(7, minmax(0, 1fr))'));
  assert.ok(css.includes('.school-time-line.is-half'));
  assert.ok(css.includes('@media (max-width: 620px)'));
  assert.ok(css.includes('min-height: 44px'));
  assert.ok(css.includes('overflow-x: hidden'));
  assert.ok(css.includes('.school-mobile-days'));
  assert.ok(css.includes('.school-drawer'));
  assert.match(css, /\.school-time-card\s*\{[^}]*min-height:\s*44px/s);
});

test('school centers the desktop page and scrolls only the timed week grid', () => {
  const css = read('school.css');
  const source = read('school.js');
  const headAppend = source.indexOf('shell.appendChild(head)');
  const allDayAppend = source.indexOf('shell.appendChild(allDayGrid)');
  const scrollCreate = source.indexOf(
    "var timeScroll = element(documentRef, 'div', 'school-time-scroll')"
  );
  const scrollAppend = source.indexOf('timeScroll.appendChild(timeShell)');
  const shellAppend = source.indexOf('shell.appendChild(timeScroll)');

  assert.match(
    css,
    /\.school-page\s*\{[^}]*width:\s*min\(1100px,\s*100%\)/s
  );
  assert.match(
    css,
    /\.school-time-scroll\s*\{[^}]*height:\s*clamp\(520px,\s*68dvh,\s*760px\)[^}]*overflow-y:\s*auto/s
  );
  assert.ok(scrollCreate !== -1);
  assert.ok(headAppend < scrollCreate, 'day headings stay outside the scroll viewport');
  assert.ok(allDayAppend < scrollCreate, 'all-day lessons stay outside the scroll viewport');
  assert.ok(scrollCreate < scrollAppend);
  assert.ok(scrollAppend < shellAppend);
});

test('school timeline returns to document scrolling on mobile', () => {
  const css = read('school.css');
  const mobile = css.slice(css.indexOf('@media (max-width: 620px)'));

  assert.match(
    mobile,
    /\.school-time-scroll\s*\{[^}]*height:\s*auto[^}]*overflow:\s*visible/s
  );
});

test('shared navigation places school between tracker and menu in eight columns', () => {
  const topbar = read('topbar.js');
  const tracker = topbar.indexOf('data-page="tracker"');
  const school = topbar.indexOf('data-page="school"');
  const menu = topbar.indexOf('data-page="menu"');

  assert.ok(topbar.includes('grid-template-columns: repeat(8, minmax(0, 1fr))'));
  assert.ok(tracker !== -1 && school > tracker && menu > school);
  assert.ok(topbar.includes("if (p.indexOf('school') !== -1) return 'school';"));
});

test('controller loads and opens lesson content without mutating before user action', () => {
  const calls = [];
  const controller = SchoolUi.createController({
    api: {
      async listLessons(filter) {
        calls.push(['listLessons', filter]);
        return [];
      },
      async getLessonContent(id) {
        calls.push(['getLessonContent', id]);
        return { lesson: { id }, blocks: [] };
      },
      mutate() {
        throw new Error('mutation requires explicit user action');
      }
    },
    core: {
      buildReadModel() {
        return {
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: 0, partial: 0, missed: 0 },
          activeLessons: [],
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    document: null,
    now: () => new Date('2026-08-03T10:00:00+05:00')
  });

  return controller.load().then(async () => {
    await controller.openLesson('lesson-1');
    assert.deepEqual(calls, [
      ['listLessons', { week: 'W01 · 3–9 августа 2026' }],
      ['getLessonContent', 'lesson-1']
    ]);
  });
});

test('controller rolls back optimistic lessons when mutation fails', async () => {
  const initial = [{ id: 'lesson-1', status: 'Запланирован' }];
  const rendered = [];
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        return initial;
      },
      async mutate() {
        const error = new Error('conflict');
        error.code = 'LESSON_TIME_CONFLICT';
        error.status = 409;
        throw error;
      }
    },
    core: {
      buildReadModel(lessons) {
        rendered.push(lessons.map((lesson) => lesson.status));
        return {
          lessons,
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: 1, partial: 0, missed: 0 },
          activeLessons: [],
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    document: null
  });
  await controller.load();

  await assert.rejects(
    controller.runMutation(
      { operation: 'startLesson', lessonId: 'lesson-1' },
      (lessons) => lessons.map((lesson) => ({ ...lesson, status: 'В процессе' }))
    ),
    (error) => error.code === 'LESSON_TIME_CONFLICT'
  );
  await controller.whenMutationsIdle();

  assert.deepEqual(rendered[0], ['Запланирован']);
  assert.ok(rendered.some((statuses) => statuses[0] === 'В процессе'));
  assert.deepEqual(rendered.at(-1), ['Запланирован']);
  assert.deepEqual(controller.getLessons(), initial);
});

test('week rerenders retain the internal timeline scroll through optimistic success, rollback and revalidation', async () => {
  const ui = timelineDocument((creation) => (
    creation < 6
      ? { scrollHeight: 1000, clientHeight: 500 }
      : { scrollHeight: 680, clientHeight: 500 }
  ));
  let mutationCount = 0;
  const lesson = queueLesson('lesson-1', '14:00');
  const core = Object.assign({}, SchoolCore, {
    buildReadModel(lessons) {
      return {
        lessons,
        today: [],
        weekDays: { '2026-08-03': lessons },
        diary: [],
        progress: { completed: 0, total: lessons.length, partial: 0, missed: 0 },
        activeLessons: [],
        nextLesson: null,
        persistedDecisions: [],
        runtimeIssues: []
      };
    }
  });
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        return [structuredClone(lesson)];
      },
      async mutate() {
        mutationCount += 1;
        if (mutationCount === 2) throw new Error('rollback');
        return { id: lesson.id };
      }
    },
    core,
    mutationQueue: SchoolMutationQueue,
    document: ui.document,
    now: () => new Date('2026-08-03T14:00:00+05:00')
  });

  await controller.load();
  ui.nodes.get('schoolTimeScroll').scrollTop = 420;
  await controller.runMutation(
    { operation: 'moveLesson', lessonId: lesson.id },
    (lessons) => lessons
  );
  await controller.whenMutationsIdle();
  assert.ok(
    ui.timelineScrolls.slice(1).every((viewport) => viewport.scrollTop === 420),
    'optimistic, queue and revalidation rerenders keep the late-hour viewport'
  );

  const rollbackStart = ui.timelineScrolls.length;
  ui.nodes.get('schoolTimeScroll').scrollTop = 420;
  await assert.rejects(
    controller.runMutation(
      { operation: 'moveLesson', lessonId: lesson.id },
      (lessons) => lessons
    ),
    /rollback/
  );
  await controller.whenMutationsIdle();
  assert.ok(
    ui.timelineScrolls.slice(rollbackStart).every((viewport) => viewport.scrollTop === 180),
    'rollback and revalidation clamp the preserved position to the new viewport range'
  );
});

test('hidden week rerenders restore the remembered timeline position after the tab becomes visible', async () => {
  const ui = timelineLifecycleDocument();
  let mutationCount = 0;
  const lesson = queueLesson('lesson-1', '14:00');
  const core = Object.assign({}, SchoolCore, {
    buildReadModel(lessons) {
      return {
        lessons,
        today: [],
        weekDays: { '2026-08-03': lessons },
        diary: [],
        progress: { completed: 0, total: lessons.length, partial: 0, missed: 0 },
        activeLessons: [],
        nextLesson: null,
        persistedDecisions: [],
        runtimeIssues: []
      };
    }
  });
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        return [structuredClone(lesson)];
      },
      async mutate() {
        mutationCount += 1;
        if (mutationCount === 2) throw new Error('rollback');
        return { id: lesson.id };
      }
    },
    core,
    mutationQueue: SchoolMutationQueue,
    document: ui.document,
    now: () => new Date('2026-08-03T14:00:00+05:00')
  });

  await controller.load();
  controller.selectView('week');
  const visibleViewport = ui.nodes.get('schoolTimeScroll');
  visibleViewport.scrollTop = 420;
  visibleViewport.dispatch('scroll');
  controller.selectView('today');
  assert.equal(ui.nodes.get('schoolTimeScroll').scrollTop, 0, 'hidden viewport exposes browser scrolltop zero');

  await controller.runMutation(
    { operation: 'moveLesson', lessonId: lesson.id },
    (lessons) => lessons
  );
  await assert.rejects(
    controller.runMutation(
      { operation: 'moveLesson', lessonId: lesson.id },
      (lessons) => lessons
    ),
    /rollback/
  );
  await controller.whenMutationsIdle();
  assert.equal(ui.nodes.get('schoolTimeScroll').scrollTop, 0, 'hidden setters do not retain scrolltop');

  controller.selectView('week');
  assert.equal(ui.nodes.get('schoolTimeScroll').scrollTop, 420);

  const diaryViewport = ui.nodes.get('schoolTimeScroll');
  diaryViewport.scrollTop = 360;
  diaryViewport.dispatch('scroll');
  controller.selectView('diary');
  await controller.runMutation(
    { operation: 'moveLesson', lessonId: lesson.id },
    (lessons) => lessons
  );
  await controller.whenMutationsIdle();
  assert.equal(ui.nodes.get('schoolTimeScroll').scrollTop, 0, 'diary keeps the week viewport hidden');

  controller.selectView('week');
  assert.equal(ui.nodes.get('schoolTimeScroll').scrollTop, 360);
});

test('successful mutation revalidates from notion and rechecks active lessons', async () => {
  const calls = [];
  const lists = [
    [{ id: 'lesson-1', status: 'Запланирован' }],
    [{ id: 'lesson-1', status: 'В процессе' }]
  ];
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        calls.push('list');
        return lists.shift();
      },
      async mutate(command) {
        calls.push(command.operation);
        return { id: 'lesson-1', status: 'В процессе' };
      }
    },
    core: {
      buildReadModel(lessons) {
        return {
          today: [],
          weekDays: {},
          diary: [],
          progress: { completed: 0, total: 1, partial: 0, missed: 0 },
          activeLessons: lessons.filter((lesson) => lesson.status === 'В процессе'),
          nextLesson: null,
          persistedDecisions: [],
          runtimeIssues: []
        };
      }
    },
    document: null
  });
  await controller.load();
  await controller.runMutation(
    { operation: 'startLesson', lessonId: 'lesson-1' },
    (lessons) => lessons.map((lesson) => ({ ...lesson, status: 'В процессе' }))
  );

  assert.deepEqual(calls, ['list', 'startLesson', 'list']);
  assert.deepEqual(controller.getReadModel().activeLessons.map((lesson) => lesson.id), ['lesson-1']);
});

test('controller keeps a second optimistic drop while the first mutation is pending', async () => {
  const first = deferred();
  const calls = [];
  const controller = createQueueController({
    mutate(command) {
      calls.push(command.lessonId);
      return command.lessonId === 'a' ? first.promise : Promise.resolve({ id: 'b' });
    }
  });

  await controller.load();
  const a = controller.runMutation(moveCommand('a', '10:00'), moveReducer(moveCommand('a', '10:00')));
  const b = controller.runMutation(moveCommand('b', '11:00'), moveReducer(moveCommand('b', '11:00')));
  assert.deepEqual(
    controller.getLessons().map((lesson) => lesson.schedule.start.slice(11, 16)),
    ['10:00', '11:00']
  );
  first.resolve({ id: 'a' });
  await Promise.all([a, b]);
  await controller.whenMutationsIdle();
  assert.deepEqual(calls, ['a', 'b']);
});

test('failed queued mutation removes only its optimistic layer', async () => {
  const controller = createQueueController({
    mutate(command) {
      return command.lessonId === 'a'
        ? Promise.reject(new Error('failed a'))
        : Promise.resolve({ id: 'b' });
    }
  });

  await controller.load();
  const commandA = moveCommand('a', '10:00');
  const commandB = moveCommand('b', '11:00');
  const a = controller.runMutation(commandA, moveReducer(commandA));
  const b = controller.runMutation(commandB, moveReducer(commandB));
  await assert.rejects(a, /failed a/);
  await b;
  await controller.whenMutationsIdle();
  assert.equal(
    controller.getLessons().find((lesson) => lesson.id === 'a').schedule.start.slice(11, 16),
    '09:00'
  );
  assert.equal(
    controller.getLessons().find((lesson) => lesson.id === 'b').schedule.start.slice(11, 16),
    '11:00'
  );
});

test('drop transition matrix blocks finalized cards and requires explicit status commands', () => {
  const timed = {
    kind: 'timed',
    start: '2026-08-04T14:15:00+05:00'
  };

  assert.deepEqual(
    SchoolUi.commandForDrop({
      id: 'planned',
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, timed, 150),
    {
      kind: 'command',
      command: {
        operation: 'moveLesson',
        lessonId: 'planned',
        destination: timed,
        order: 150
      }
    }
  );
  assert.equal(
    SchoolUi.commandForDrop({
      id: 'active',
      status: 'В процессе',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, timed, 150).kind,
    'pause-confirm'
  );
  assert.equal(
    SchoolUi.commandForDrop({
      id: 'missed',
      status: 'Пропущен',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, timed, 150).kind,
    'restore-confirm'
  );
  ['Выполнен', 'Частично выполнен', 'Отменён'].forEach((status) => {
    assert.equal(
      SchoolUi.commandForDrop({
        id: status,
        status,
        schedule: { kind: 'date-only', date: '2026-08-03' }
      }, timed, 150).kind,
      'blocked'
    );
    assert.equal(SchoolUi.isLessonDraggable({ status }), false);
  });
  assert.equal(SchoolUi.isLessonDraggable({ status: 'Пропущен' }), true);
});

test('all-day drop computes a sparse order before or after the hovered lesson', () => {
  const lessons = [
    {
      id: 'first',
      order: 100,
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    },
    {
      id: 'second',
      order: 200,
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    },
    {
      id: 'third',
      order: 300,
      status: 'Запланирован',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }
  ];

  assert.equal(
    SchoolUi.allDayDropPlacement({ top: 100, height: 60 }, 129),
    'before'
  );
  assert.equal(
    SchoolUi.allDayDropPlacement({ top: 100, height: 60 }, 130),
    'after'
  );
  assert.equal(
    SchoolUi.allDayDropOrder(
      SchoolCore,
      lessons,
      '2026-08-03',
      'third',
      'second',
      'before'
    ),
    150
  );
  assert.equal(
    SchoolUi.allDayDropOrder(
      SchoolCore,
      lessons,
      '2026-08-03',
      'first',
      'second',
      'after'
    ),
    250
  );
});

test('all-day drop reorders in place but keeps cross-day and missed transitions explicit', () => {
  const planned = {
    id: 'planned',
    status: 'Запланирован',
    schedule: { kind: 'date-only', date: '2026-08-03' }
  };
  assert.deepEqual(
    SchoolUi.commandForAllDayDrop(planned, '2026-08-03', 150),
    {
      kind: 'command',
      command: {
        operation: 'reorderLesson',
        lessonId: 'planned',
        order: 150
      }
    }
  );
  assert.deepEqual(
    SchoolUi.commandForAllDayDrop(planned, '2026-08-04', 150),
    SchoolUi.commandForDrop(
      planned,
      { kind: 'date-only', date: '2026-08-04' },
      150
    )
  );
  assert.equal(
    SchoolUi.commandForAllDayDrop({
      id: 'missed',
      status: 'Пропущен',
      schedule: { kind: 'date-only', date: '2026-08-03' }
    }, '2026-08-03', 150).kind,
    'restore-confirm'
  );
});

test('overlap choices retry only with an explicit command change', () => {
  const command = {
    operation: 'moveLesson',
    lessonId: 'lesson-1',
    destination: {
      kind: 'timed',
      start: '2026-08-03T14:00:00+05:00'
    },
    order: 100
  };
  const error = {
    code: 'LESSON_TIME_CONFLICT',
    details: {
      conflicts: [{
        end: '2026-08-03T15:15:00+05:00'
      }]
    }
  };

  assert.deepEqual(
    SchoolUi.commandAfterOverlapChoice(command, error, 'allow'),
    { ...command, allowOverlap: true }
  );
  assert.deepEqual(
    SchoolUi.commandAfterOverlapChoice(command, error, 'after'),
    {
      ...command,
      destination: {
        kind: 'timed',
        start: '2026-08-03T15:15:00+05:00'
      }
    }
  );
  assert.equal(
    SchoolUi.commandAfterOverlapChoice(command, error, 'change'),
    null
  );
});

test('content renderer creates text nodes and keeps unsafe links inert', () => {
  const document = fakeDocument();
  const root = document.createElement('div');

  SchoolUi.renderContentBlocks(root, [
    {
      type: 'paragraph',
      spans: [{
        text: '<img src=x onerror=alert(1)>',
        link: 'javascript:alert(1)',
        annotations: { bold: false, italic: false, underline: false, strikethrough: false, code: false }
      }],
      children: []
    },
    {
      type: 'bookmark',
      label: 'официальный материал',
      url: 'https://example.com/lesson',
      caption: [],
      children: []
    }
  ], document);

  assert.equal(root.children[0].children[0].textContent, '<img src=x onerror=alert(1)>');
  assert.equal(root.children[0].children[0].attributes.href, undefined);
  assert.equal(root.children[1].attributes.href, 'https://example.com/lesson');
  assert.equal(root.children[1].attributes.rel, 'noopener noreferrer');
});

test('content renderer groups consecutive list items and gives toggles a summary', () => {
  const document = fakeDocument();
  const root = document.createElement('div');

  SchoolUi.renderContentBlocks(root, [
    { type: 'numbered_list_item', spans: [{ text: 'первый', annotations: {} }], children: [] },
    { type: 'numbered_list_item', spans: [{ text: 'второй', annotations: {} }], children: [] },
    { type: 'bulleted_list_item', spans: [{ text: 'маркер', annotations: {} }], children: [] },
    {
      type: 'toggle',
      spans: [{ text: 'подробнее', annotations: {} }],
      children: [{ type: 'paragraph', spans: [{ text: 'ответ', annotations: {} }], children: [] }]
    },
    { type: 'constructor', label: 'prototype lookup must not select a tag' }
  ], document);

  assert.equal(root.children[0].tagName, 'OL');
  assert.equal(root.children[0].children.length, 2);
  assert.equal(root.children[1].tagName, 'UL');
  assert.equal(root.children[1].children.length, 1);
  assert.equal(root.children[2].tagName, 'DETAILS');
  assert.equal(root.children[2].children[0].tagName, 'SUMMARY');
  assert.equal(root.children[2].children[1].className, 'school-content-children');
  assert.equal(root.children[3].className, 'school-content-unsupported');
});

test('today focus is the sole active lesson or the computed next lesson', () => {
  const active = { id: 'active' };
  const completed = { id: 'completed', status: 'Выполнен' };
  const next = { id: 'next' };

  assert.equal(SchoolUi.selectTodayFocus({
    activeLessons: [active],
    today: [completed],
    nextLesson: next
  }), active);
  assert.equal(SchoolUi.selectTodayFocus({
    activeLessons: [],
    today: [completed],
    nextLesson: next
  }), next);
  assert.equal(SchoolUi.selectTodayFocus({
    activeLessons: [{ id: 'a' }, { id: 'b' }],
    today: [completed],
    nextLesson: next
  }), null);
});

test('diary groups rows by planned date and keeps missed reason instead of an empty result', () => {
  const groups = SchoolUi.groupDiaryLessons([
    {
      id: 'missed',
      status: 'Пропущен',
      result: null,
      missedReason: 'Низкая энергия',
      order: 100,
      schedule: { date: '2026-08-03' }
    },
    {
      id: 'done',
      status: 'Выполнен',
      result: 'Зачёт',
      missedReason: null,
      order: 200,
      schedule: { date: '2026-08-04' }
    },
    {
      id: 'canceled',
      status: 'Отменён',
      result: 'Зачёт',
      order: 300,
      schedule: { date: '2026-08-04' }
    }
  ]);

  assert.deepEqual(groups.map((group) => [group.date, group.lessons.map((lesson) => lesson.id)]), [
    ['2026-08-04', ['done']],
    ['2026-08-03', ['missed']]
  ]);
  assert.equal(SchoolUi.diaryResult(groups[1].lessons[0]), 'Пропущен · Низкая энергия');
  const missedModel = SchoolCore.buildReadModel([{
    id: 'missed-with-stale-assessment',
    title: 'пропущенный урок',
    subject: 'Software Engineering',
    schedule: { kind: 'date-only', date: '2026-08-03' },
    status: 'Пропущен',
    priority: 'Must',
    week: 'W01',
    autonomy: 'A3',
    understanding: 3,
    durationMinutes: 45,
    order: 100
  }], {
    now: '2026-08-04T12:00:00+05:00',
    timeZone: 'Asia/Yekaterinburg',
    activeWeek: 'W01'
  });
  assert.deepEqual(
    missedModel.runtimeIssues.filter((issue) => issue.code === 'missed-with-assessment'),
    [{ code: 'missed-with-assessment', lessonId: 'missed-with-stale-assessment' }]
  );
  assert.deepEqual(SchoolUi.diaryScores(missedModel.diary[0]), { autonomy: '', understanding: '' });
  assert.deepEqual(SchoolUi.diaryScores({
    status: 'Выполнен',
    autonomy: 'A2',
    understanding: 2
  }), { autonomy: 'A2', understanding: '2/3' });
});

test('week time bounds expand to actual lessons and overlapping lessons receive stable lanes', () => {
  const lessons = [
    {
      id: 'early',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T07:20:00+05:00',
        end: '2026-08-03T08:05:00+05:00'
      }
    },
    {
      id: 'overlap-a',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T15:00:00+05:00'
      }
    },
    {
      id: 'overlap-b',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:30:00+05:00',
        end: '2026-08-03T15:15:00+05:00'
      }
    },
    {
      id: 'late',
      schedule: {
        kind: 'timed',
        start: '2026-08-03T21:20:00+05:00',
        end: '2026-08-03T22:10:00+05:00'
      }
    }
  ];

  assert.deepEqual(SchoolUi.getWeekTimeBounds(lessons), {
    startHour: 7,
    endHour: 23,
    height: 960
  });
  assert.deepEqual(
    SchoolUi.layoutTimedLessons(lessons).map((item) => [item.lesson.id, item.lane, item.laneCount]),
    [
      ['early', 0, 1],
      ['overlap-a', 0, 2],
      ['overlap-b', 1, 2],
      ['late', 0, 1]
    ]
  );
});

test('same-start timed lessons sort by numeric order and stable id before duration', () => {
  const lessons = [
    {
      id: 'later-order',
      order: 300,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T14:15:00+05:00'
      }
    },
    {
      id: 'z-stable',
      order: 100,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T15:00:00+05:00'
      }
    },
    {
      id: 'a-stable',
      order: 100,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T15:30:00+05:00'
      }
    }
  ];

  assert.deepEqual(
    SchoolUi.layoutTimedLessons(lessons).map((item) => item.lesson.id),
    ['a-stable', 'z-stable', 'later-order']
  );
});

test('adjacent short lessons use separate visual lanes without becoming an actual conflict', () => {
  const lessons = [
    {
      id: 'first',
      order: 100,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:00:00+05:00',
        end: '2026-08-03T14:15:00+05:00'
      }
    },
    {
      id: 'second',
      order: 200,
      schedule: {
        kind: 'timed',
        start: '2026-08-03T14:15:00+05:00',
        end: '2026-08-03T14:30:00+05:00'
      }
    }
  ];

  assert.deepEqual(
    SchoolUi.layoutTimedLessons(lessons).map((item) => ({
      id: item.lesson.id,
      lane: item.lane,
      laneCount: item.laneCount,
      visualEnd: item.visualEnd
    })),
    [
      { id: 'first', lane: 0, laneCount: 2, visualEnd: 14 * 60 + 44 },
      { id: 'second', lane: 1, laneCount: 2, visualEnd: 14 * 60 + 15 + 44 }
    ]
  );

  const issues = SchoolCore.computeRuntimeIssues(
    lessons.map((entry) => ({
      ...entry,
      title: entry.id,
      subject: 'Software Engineering',
      status: 'Запланирован',
      priority: 'Must',
      week: 'W01',
      durationMinutes: 15,
      warnings: []
    })),
    '2026-08-03T10:00:00+05:00',
    'Asia/Yekaterinburg'
  );
  assert.equal(issues.some((issue) => issue.code === 'overlap'), false);
});

test('card signals and decision partitions preserve the approved priority', () => {
  assert.deepEqual(SchoolUi.lessonSignalLabels({
    id: 'active',
    status: 'В процессе',
    decisionRequest: 'Перенос между неделями',
    moveCount: 2,
    warnings: [{ code: 'duration-mismatch' }]
  }, true), [
    'Текущий урок',
    'Запрошен перенос в другую неделю',
    'переносился 2 раза',
    'Время окончания не совпадает с продолжительностью',
    'Конфликт времени'
  ]);
  assert.equal(SchoolUi.lessonSignalLabels({
    status: 'Запланирован',
    decisionRequest: null,
    moveCount: 1,
    warnings: []
  }, false).some((label) => label.includes('перенос')), false);
  assert.deepEqual(
    SchoolUi.lessonSignalLabels({
      status: 'Запланирован',
      decisionRequest: null,
      moveCount: 0,
      warnings: []
    }, false, true),
    ['Между уроками нет запланированного перерыва']
  );

  const persisted = [{ id: 'request' }];
  const groups = SchoolUi.partitionDecisionItems({
    persistedDecisions: persisted,
    runtimeIssues: [
      { code: 'overdue-planned' },
      { code: 'multiple-active' },
      { code: 'duration-mismatch' },
      { code: 'overlap' },
      { code: 'short-break', lessonIds: ['first', 'next'], gapMinutes: 4 }
    ]
  });
  assert.deepEqual(groups, {
    importantIssues: [{ code: 'multiple-active' }, { code: 'duration-mismatch' }],
    persisted,
    remainingIssues: [
      { code: 'overdue-planned' },
      { code: 'overlap' },
      { code: 'short-break', lessonIds: ['first', 'next'], gapMinutes: 4 }
    ]
  });
});

test('decision queue commands only clear persisted requests or resolve an explicit active lesson', () => {
  assert.deepEqual(SchoolUi.decisionQueueCommand(
    { id: 'requested', decisionRequest: 'Перенос между неделями' },
    true,
    'clear'
  ), {
    operation: 'clearDecisionRequest',
    lessonId: 'requested'
  });
  assert.deepEqual(SchoolUi.decisionQueueCommand(
    { code: 'multiple-active', lessonIds: ['active-a', 'active-b'] },
    false,
    'active-b'
  ), {
    operation: 'resolveActiveLessons',
    keepLessonId: 'active-b'
  });
  assert.equal(SchoolUi.decisionQueueCommand(
    { code: 'multiple-active', lessonIds: ['active-a', 'active-b'] },
    false,
    'unknown'
  ), null);
  assert.equal(SchoolUi.decisionQueueCommand(
    { code: 'overdue-planned', lessonId: 'late' },
    false,
    'clear'
  ), null);
});

test('failed batch revalidation is visible globally and can be retried', async () => {
  const ui = interactiveDocument();
  let listCalls = 0;
  let failRevalidation = true;
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        listCalls += 1;
        if (listCalls > 1 && failRevalidation) throw new Error('notion unavailable');
        return [{ id: 'lesson-1', status: 'Запланирован' }];
      },
      async mutate() {
        return { id: 'lesson-1', status: 'Запланирован' };
      }
    },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: ui.document
  });

  await controller.load();
  await controller.runMutation(
    { operation: 'moveLesson', lessonId: 'lesson-1' },
    (lessons) => lessons
  );
  await assert.rejects(controller.whenMutationsIdle(), /notion unavailable/);
  assert.equal(ui.nodes.get('schoolLessonDialog').hidden, true);
  assert.equal(ui.nodes.get('schoolSyncBanner').hidden, false);
  assert.match(ui.nodes.get('schoolSyncMessage').textContent, /контрольное чтение/i);

  failRevalidation = false;
  await controller.retryRevalidation();
  assert.equal(ui.nodes.get('schoolSyncBanner').hidden, true);
  assert.equal(listCalls, 3);
});

test('a stale manual retry cannot overwrite a newer mutation revalidation', async () => {
  const olderRetry = deferred();
  const newerRevalidation = deferred();
  const newerStarted = deferred();
  let listCalls = 0;
  const controller = SchoolUi.createController({
    api: {
      async listLessons() {
        listCalls += 1;
        if (listCalls === 1) return [{ id: 'lesson-1', status: 'Запланирован', version: 0 }];
        if (listCalls === 2) return olderRetry.promise;
        newerStarted.resolve();
        return newerRevalidation.promise;
      },
      async mutate() {
        return { id: 'lesson-1' };
      }
    },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: null
  });

  await controller.load();
  const retry = controller.retryRevalidation();
  await controller.runMutation(
    { operation: 'moveLesson', lessonId: 'lesson-1' },
    (lessons) => lessons
  );
  await newerStarted.promise;
  newerRevalidation.resolve([{ id: 'lesson-1', status: 'Запланирован', version: 1 }]);
  await controller.whenMutationsIdle();
  olderRetry.resolve([{ id: 'lesson-1', status: 'Запланирован', version: 0 }]);
  await retry;

  assert.equal(controller.getLessons()[0].version, 1);
});

test('opening lessons is generation guarded and installs one dialog key handler', async () => {
  const first = deferred();
  const second = deferred();
  const requests = { a: first, b: second };
  const { document, nodes } = interactiveDocument();
  const originalFocus = document.createElement('button');
  document.activeElement = originalFocus;
  const controller = SchoolUi.createController({
    api: {
      getLessonContent(id) {
        return requests[id].promise;
      }
    },
    core: {},
    document
  });

  const openA = controller.openLesson('a');
  const openB = controller.openLesson('b');
  assert.equal(document.listenerCount('keydown'), 1);

  second.resolve({
    lesson: { id: 'b' },
    blocks: [{ type: 'paragraph', spans: [{ text: 'content b', annotations: {} }], children: [] }]
  });
  await openB;
  assert.equal(nodes.get('schoolLessonContent').children[0].children[0].textContent, 'content b');

  first.resolve({
    lesson: { id: 'a' },
    blocks: [{ type: 'paragraph', spans: [{ text: 'stale a', annotations: {} }], children: [] }]
  });
  await openA;
  assert.equal(nodes.get('schoolLessonContent').children.length, 1);
  assert.equal(nodes.get('schoolLessonContent').children[0].children[0].textContent, 'content b');

  const escapeEvent = document.dispatchKey('Escape');
  assert.equal(escapeEvent.prevented, true);
  assert.equal(document.listenerCount('keydown'), 0);
  assert.equal(nodes.get('schoolLessonContent').children.length, 0);
  assert.equal(nodes.get('schoolApp').attributes['aria-hidden'], undefined);
  assert.equal(nodes.get('schoolApp').inert, false);
  assert.equal(originalFocus.focusCount, 1);
});

test('read-only controller normalizes loading and auth error states', async () => {
  for (const scenario of [
    { status: 401, expected: 'unauthenticated' },
    { status: 403, expected: 'forbidden' },
    { status: 503, expected: 'unavailable' }
  ]) {
    const states = [];
    const controller = SchoolUi.createController({
      api: {
        async listLessons() {
          const error = new Error('safe');
          error.status = scenario.status;
          throw error;
        }
      },
      core: {},
      document: null,
      onState(state) {
        states.push(state);
      }
    });

    await controller.load();
    assert.deepEqual(states, ['loading', scenario.expected]);
  }
});

test('shows the school shell before the initial notion read resolves', async () => {
  const pending = deferred();
  const ui = interactiveDocument();
  const html = read('school.html');
  const css = read('school.css');
  assert.ok(html.includes('id="schoolLoadingSkeleton"'));
  assert.ok(html.includes('id="schoolLoadingText"'));
  assert.ok(css.includes('@keyframes school-skeleton-pulse'));
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.school-skeleton-card \{ animation: none; \}/);
  const controller = SchoolUi.createController({
    api: { listLessons: () => pending.promise },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: ui.document
  });

  const loading = controller.load();
  assert.equal(ui.nodes.get('schoolReady').hidden, false);
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, false);
  assert.equal(ui.nodes.get('schoolApp').attributes['aria-busy'], 'true');
  pending.resolve([queueLesson('lesson-1', '09:00')]);
  await loading;
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, true);
  assert.equal(ui.nodes.get('schoolApp').attributes['aria-busy'], 'false');
});

test('replaces the loading shell with a normalized auth error', async () => {
  const ui = interactiveDocument();
  const controller = SchoolUi.createController({
    api: {
      listLessons: () => Promise.reject(Object.assign(new Error('safe'), { status: 401 }))
    },
    core: loadingCore(),
    mutationQueue: SchoolMutationQueue,
    document: ui.document
  });

  await controller.load();
  assert.equal(ui.nodes.get('schoolLoadingSkeleton').hidden, true);
  assert.equal(ui.nodes.get('schoolReady').hidden, true);
  assert.equal(ui.nodes.get('schoolStateTitle').textContent, 'Нужно войти');
});

test('school controller contains focus trap, escape close and restore behavior', () => {
  const source = read('school.js');

  assert.ok(source.includes("event.key === 'Escape'"));
  assert.ok(source.includes("event.key !== 'Tab'"));
  assert.ok(source.includes('previousFocus'));
  assert.ok(source.includes('previousFocus.focus()'));
  assert.ok(source.includes('aria-hidden'));
});

test('school source installs drag, touch-safe fallback and isolated optimistic queue behavior', () => {
  const source = read('school.js');
  const html = read('school.html');
  const css = read('school.css');

  assert.ok(source.includes('.listLessons('));
  assert.ok(source.includes('.getLessonContent('));
  assert.ok(source.includes('.mutate('));
  assert.ok(source.includes("addEventListener('dragstart"));
  assert.ok(source.includes("addEventListener('drop"));
  assert.ok(source.includes('school-all-day-drop-before'));
  assert.ok(source.includes('school-all-day-drop-after'));
  assert.ok(source.includes('Разрешить состояние'));
  assert.ok(source.includes('Оставить в W01'));
  assert.ok(source.includes("operation: 'resolveActiveLessons'"));
  assert.ok(source.includes('optimisticReducer'));
  assert.ok(source.includes('optimisticMutations'));
  assert.ok(source.includes('pendingLessonIds'));
  assert.ok(source.includes('whenMutationsIdle'));
  assert.ok(!css.includes('.school-page[data-mutation-pending="true"]'));
  assert.ok(html.includes('id="schoolActionDialog"'));
  assert.ok(html.includes('id="schoolScheduleControls"'));
  assert.ok(!source.includes('.innerHTML'));
});
