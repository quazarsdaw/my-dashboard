# Nutrition Scroll And Prices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 14-day calendar and cooking timeline readable through contained horizontal scrolling, and add persistent editable grocery prices with immutable expense history.

**Architecture:** Layout changes stay in `menu.html`, with `nutrition.js` setting the cooking timeline's duration-derived minimum width. Price math remains pure in `nutrition-core.js`: the persisted state owns a normalized `ingredientPrices` dictionary, shopping rows are enriched by pure pricing helpers, and cycle snapshots store the calculated two-week cost so historical analytics never depend on today's prices.

**Tech Stack:** vanilla html/css/javascript, commonjs-compatible pure modules, node test runner, playwright browser qa through the local static server.

## Global Constraints

- preserve the existing visual language, color grouping, calendar selection, cooking controls, and mobile stacked calendar.
- horizontal overflow must be contained inside the calendar and timeline; the document itself must not overflow horizontally.
- use a readable calendar day width of `260px` and a cooking scale of `7px` per minute, with a `140px` sticky resource column.
- display prices as rubles per kilogram for grams, rubles per litre for millilitres, and rubles per item for pieces; unsupported units use their native unit.
- persist one non-negative finite price per stable `ingredient id + unit` key and preserve it when a new cycle starts.
- historical cycle totals are immutable snapshots and are not recalculated after later price edits.
- all implementation changes use tests first; all github text is lowercase russian; do not merge the pull request.

---

### Task 1: Contained readable calendar and timeline

**Files:**
- Modify: `menu.html`
- Modify: `nutrition.js`
- Test: `test/ui-polish.test.cjs`
- Test: `test/nutrition-ui.test.cjs`

**Interfaces:**
- Consumes: `plan.estimate.minMinutes` from the existing cooking plan.
- Produces: `--timeline-width` on `#cookingTimeline`, `.cycle-scroll`, and duration-scaled timeline rows.

- [ ] **Step 1: Write failing layout regression tests**

Add assertions that require a calendar scroll wrapper, a seven-day minimum width, an overflow-enabled timeline shell, sticky resource labels, and a controller-set `--timeline-width` based on `TIMELINE_PIXELS_PER_MINUTE`.

```js
assert.ok(html.includes('class="cycle-scroll"'));
assert.ok(html.includes('min-width:1820px'));
assert.ok(html.includes('.timeline-shell{min-width:0;overflow-x:auto'));
assert.ok(html.includes('position:sticky;left:0'));
assert.ok(js.includes('TIMELINE_PIXELS_PER_MINUTE = 7'));
assert.ok(js.includes("setProperty('--timeline-width'"));
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `node --test test/ui-polish.test.cjs test/nutrition-ui.test.cjs`

Expected: failure because the wrapper, minimum widths, sticky labels, and timeline custom property do not exist.

- [ ] **Step 3: Implement contained scrolling**

Wrap the cycle grid without changing its render target:

```html
<div class="cycle-scroll" tabindex="0" aria-label="Календарь питания на неделю">
  <div class="cycle-calendar" id="cycleGrid"></div>
</div>
```

Use a fixed content geometry on desktop and restore the stacked layout below `820px`:

```css
.cycle-scroll{min-width:0;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-gutter:stable}
.cycle-calendar{min-width:1820px;grid-template-columns:repeat(7,260px)}
.timeline-shell{min-width:0;overflow-x:auto;overscroll-behavior-inline:contain;scrollbar-gutter:stable}
.timeline-ruler,.timeline-lane{width:var(--timeline-width,2870px);grid-template-columns:140px minmax(0,1fr)}
.timeline-ruler-label,.timeline-lane-name{position:sticky;left:0;z-index:2;background:#1C1E24}
@media(max-width:820px){.cycle-scroll{overflow:visible}.cycle-calendar{min-width:0}}
```

Set the timeline width before rows are rendered:

```js
var TIMELINE_PIXELS_PER_MINUTE = 7;
var TIMELINE_RESOURCE_WIDTH = 140;
var timelineWidth = TIMELINE_RESOURCE_WIDTH + Math.ceil(duration * TIMELINE_PIXELS_PER_MINUTE);
container.style.setProperty('--timeline-width', timelineWidth + 'px');
```

- [ ] **Step 4: Run focused and full tests**

Run: `node --test test/ui-polish.test.cjs test/nutrition-ui.test.cjs`

Expected: pass.

Run: `node --test`

Expected: all tests pass.

- [ ] **Step 5: Commit the layout block**

```bash
git add menu.html nutrition.js test/ui-polish.test.cjs test/nutrition-ui.test.cjs
git commit -m "разгрузить календарь и таймлайн прокруткой"
```

### Task 2: Persistent price book and immutable expense snapshots

**Files:**
- Modify: `nutrition-core.js`
- Modify: `nutrition-data.js`
- Test: `test/nutrition-core.test.cjs`
- Test: `test/nutrition-data.test.cjs`

**Interfaces:**
- Consumes: aggregated items from `buildShoppingList(template, state, catalog, weekNumber)`.
- Produces: `priceKey(item)`, `priceBasis(unit)`, `priceShoppingItems(items, priceBook, defaults)`, `calculateShoppingTotal(items)`, normalized `state.ingredientPrices`, and `snapshot.shoppingCostRub`.

- [ ] **Step 1: Write failing pure-logic tests**

Cover these exact behaviours:

```js
const priced = NutritionCore.priceShoppingItems([
  ingredient('chicken', 'курица', 300, 'г', 'protein'),
  ingredient('eggs', 'яйца', 4, 'шт', 'protein')
], { 'chicken::г': 500, 'eggs::шт': 12 }, {});
assert.equal(priced[0].lineCostRub, 150);
assert.equal(priced[0].priceLabel, '₽/кг');
assert.equal(priced[1].lineCostRub, 48);
assert.equal(NutritionCore.calculateShoppingTotal(priced), 198);
```

Also assert that normalization drops `NaN`, negative, and non-numeric values; `startNextCycle` preserves the price book; and a snapshot created with a catalog and default prices keeps its `shoppingCostRub` after the source price book is edited.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `node --test test/nutrition-core.test.cjs test/nutrition-data.test.cjs`

Expected: failure because price helpers and default prices do not exist.

- [ ] **Step 3: Implement price normalization and math**

Use stable item keys and explicit basis conversion:

```js
function priceKey(item) { return item.id + '::' + item.unit; }
function priceBasis(unit) {
  if (unit === 'г') return { amount: 1000, label: '₽/кг' };
  if (unit === 'мл') return { amount: 1000, label: '₽/л' };
  return { amount: 1, label: '₽/' + unit };
}
```

`priceShoppingItems` selects the saved price first, falls back to `NutritionData.ingredientPrices`, and returns a cloned item with `unitPriceRub`, `priceLabel`, `lineCostRub`, and `hasPrice`. `calculateShoppingTotal` sums finite line costs and rounds to whole rubles.

Add `ingredientPrices` to default state, normalized state, and the state returned by `startNextCycle`. Extend `createCycleSnapshot(state, template, catalog, defaultPrices)` to build both weeks, price them, and store a whole-cycle `shoppingCostRub`.

- [ ] **Step 4: Add realistic editable defaults**

Add one default price per built-in ingredient key in `nutrition-data.js`; values represent rubles per kilogram, litre, item, or native unit according to `priceBasis`. Exclude outside meals from grocery defaults because they are excluded from shopping.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test test/nutrition-core.test.cjs test/nutrition-data.test.cjs`

Expected: pass.

Run: `node --test`

Expected: all tests pass.

- [ ] **Step 6: Commit the data block**

```bash
git add nutrition-core.js nutrition-data.js test/nutrition-core.test.cjs test/nutrition-data.test.cjs
git commit -m "добавить справочник цен и снимки расходов"
```

### Task 3: Editable shopping rows and expense analytics

**Files:**
- Modify: `menu.html`
- Modify: `nutrition.js`
- Test: `test/nutrition-ui.test.cjs`
- Test: `test/ui-polish.test.cjs`

**Interfaces:**
- Consumes: `NutritionCore.priceShoppingItems`, `NutritionCore.calculateShoppingTotal`, `state.ingredientPrices`, and historical `shoppingCostRub`.
- Produces: editable `.shopping-price-input`, `.shopping-line-cost`, dynamic `#shoppingBudgetMeta`, and `#historySummary`.

- [ ] **Step 1: Write failing ui contract tests**

Require the dynamic shopping total, number input, independent checkbox row, save-on-change, history summary, and snapshot call with prices:

```js
assert.ok(html.includes('id="shoppingBudgetMeta"'));
assert.ok(html.includes('id="historySummary"'));
assert.ok(html.includes('.shopping-price-input'));
assert.ok(js.includes("priceInput.type = 'number'"));
assert.ok(js.includes('state.ingredientPrices[priceKey]'));
assert.ok(js.includes('NutritionCore.calculateShoppingTotal'));
assert.ok(js.includes('NutritionData.ingredientPrices'));
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `node --test test/nutrition-ui.test.cjs test/ui-polish.test.cjs`

Expected: failure because editable prices and analytics elements do not exist.

- [ ] **Step 3: Build the shopping interface**

Change the shopping row from a wrapping `label` to a grid `div`, keeping the checkbox separately labelled. Render columns for product, required amount, editable unit price, and calculated line total. Save a finite non-negative value on `change`, remove an invalid/empty override, call `saveState()`, and rerender shopping so totals update immediately.

Set `#shoppingBudgetMeta` to `неделя N · ≈X ₽` when every visible item has a price, otherwise show the priced subtotal plus the count without a price.

- [ ] **Step 4: Build immutable history analytics**

Pass `catalog` and `NutritionData.ingredientPrices` into `createCycleSnapshot`. Render `shoppingCostRub` on each historical row. Populate `#historySummary` with completed-cycle count, latest cycle spend, and average spend across snapshots that contain a finite cost. Legacy history without cost remains readable and displays `расход не зафиксирован`.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test test/nutrition-ui.test.cjs test/ui-polish.test.cjs`

Expected: pass.

Run: `node --test`

Expected: all tests pass.

- [ ] **Step 6: Visual and interaction verification**

Run a local static server and verify at `1920x1080`, `1440x900`, `820x1180`, and `390x844`:

- the document has no horizontal overflow;
- desktop calendar and timeline have `scrollWidth > clientWidth` and can reach the last day/step;
- resource labels remain visible after timeline scroll;
- mobile calendar remains stacked;
- price input does not toggle the checkbox;
- editing a price updates line and week totals and survives reload;
- history remains legible with and without recorded cost.

- [ ] **Step 7: Commit the integration block**

```bash
git add menu.html nutrition.js test/nutrition-ui.test.cjs test/ui-polish.test.cjs
git commit -m "добавить цены закупки и аналитику расходов"
```

### Task 4: Final verification and publication

**Files:**
- Verify: all branch changes

**Interfaces:**
- Consumes: commits from tasks 1–3.
- Produces: reviewed branch and a non-draft pull request closing issues `#34` and `#35`.

- [ ] **Step 1: Run final verification**

Run: `node --test`

Expected: all tests pass with zero failures.

- [ ] **Step 2: Review the complete branch diff**

Run a full code review against `origin/main`; fix all correctness, persistence, accessibility, layout, and regression findings, then rerun the relevant tests.

- [ ] **Step 3: Push and open the pull request**

Push `feature/nutrition-scroll-prices` and open a non-draft pull request with a detailed lowercase russian description covering the cause, implementation, persistence migration, expense history semantics, visual impact, tests, and `closes #34` / `closes #35`.
