const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadParser() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'finance.html'), 'utf8');
  const match = html.match(/\/\* --- CSV Parsing --- \*\/([\s\S]*?)\/\* --- Process parsed rows into report data --- \*\//);
  assert.ok(match, 'CSV parser block should be present in finance.html');

  const context = { module: {}, exports: {} };
  vm.createContext(context);
  vm.runInContext(`${match[1]}; module.exports = { parseCSV };`, context);
  return context.module.exports.parseCSV;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('parses ZenMoney export when metadata lines precede the header', () => {
  const parseCSV = loadParser();
  const csv = [
    '\uFEFFzm_dump_2011,1779861883,,,"4,0",',
    '',
    '',
    'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle,createdDate,changedDate',
    '2025-03-31,продукты,Монетка,,основа,"261,59",RUB,,,,"2025-03-31 19:01:41","2025-04-29 15:55:53"',
    '2025-04-01,"кафе и рестики",ROBOKASSA_INTERNET,"Исходящий платеж QR по СБП C2B",основа,"30,00",RUB,,,,"2025-04-01 17:25:22","2025-04-29 16:23:25"',
  ].join('\n');

  const rows = parseCSV(csv);

  assert.equal(rows.length, 2);
  assert.deepEqual(plain(rows[0]), {
    date: '2025-03-31',
    category: 'продукты',
    payee: 'Монетка',
    comment: '',
    outcome: 261.59,
    income: 0,
  });
  assert.equal(rows[1].category, 'кафе и рестики');
});

test('still parses a regular CSV whose first row is the header', () => {
  const parseCSV = loadParser();
  const csv = [
    'date,categoryName,payee,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle',
    '2026-05-27,зарплата,Компания,,,"0",RUB,основа,"1000,50",RUB',
  ].join('\n');

  const rows = parseCSV(csv);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].income, 1000.5);
  assert.equal(rows[0].category, 'зарплата');
});
