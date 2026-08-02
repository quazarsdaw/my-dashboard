const assert = require('node:assert/strict');
const test = require('node:test');
const SchoolCabinetSettings = require('../school-cabinet-settings.js');

test('normalizes exactly six subject cabinet urls', () => {
  const result = SchoolCabinetSettings.validateDraft({
    'chatgpt-software': 'https://chatgpt.com/g/software',
    'chatgpt-director': 'https://chat.openai.com/g/director',
    'codex-main': 'https://chatgpt.com/g/ignored'
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.settings, {
    version: 1,
    cabinets: {
      'chatgpt-software': 'https://chatgpt.com/g/software',
      'chatgpt-director': 'https://chat.openai.com/g/director'
    }
  });
});

test('rejects unsafe urls without truncating them', () => {
  const cases = [
    'http://chatgpt.com/g/x',
    'https://user:pass@chatgpt.com/g/x',
    'https://chatgpt.com.attacker.example/g/x',
    'javascript:alert(1)',
    `https://chatgpt.com/${'a'.repeat(2049)}`
  ];

  cases.forEach((url) => {
    const result = SchoolCabinetSettings.validateDraft({
      'chatgpt-software': url
    });
    assert.equal(result.valid, false, url.slice(0, 80));
    assert.equal(result.settings.cabinets['chatgpt-software'], undefined);
  });
});

test('validates the canonical unicode url and round-trips it safely', () => {
  const accepted = 'https://chatgpt.com/g/математика?тема=интегралы#урок';
  const acceptedResult = SchoolCabinetSettings.validateDraft({
    'chatgpt-software': accepted,
    'chatgpt-devops': '   '
  });
  const rawWithinLimit = `https://chatgpt.com/${'😀'.repeat(2028)}`;

  assert.equal(acceptedResult.valid, true);
  assert.equal(
    SchoolCabinetSettings.parseStoredValue(
      SchoolCabinetSettings.serialize(acceptedResult.settings)
    ).settings.cabinets['chatgpt-software'],
    new URL(accepted).href
  );
  assert.equal(Array.from(rawWithinLimit).length, 2048);
  assert.equal(SchoolCabinetSettings.validateDraft({
    'chatgpt-software': rawWithinLimit
  }).valid, false);
});

test('damaged json and unknown versions fail closed with a warning', () => {
  const damaged = SchoolCabinetSettings.parseStoredValue('{bad json');
  const future = SchoolCabinetSettings.parseStoredValue(JSON.stringify({
    version: 2,
    cabinets: { 'chatgpt-software': 'https://chatgpt.com/g/future' }
  }));

  assert.deepEqual(damaged.settings, { version: 1, cabinets: {} });
  assert.equal(damaged.warning.code, 'DAMAGED_SETTINGS');
  assert.deepEqual(future.settings, { version: 1, cabinets: {} });
  assert.equal(future.warning.code, 'UNSUPPORTED_VERSION');
});

test('stored values ignore unknown ids but fail closed on invalid urls', () => {
  const unknown = SchoolCabinetSettings.parseStoredValue(JSON.stringify({
    version: 1,
    cabinets: {
      'chatgpt-software': 'https://chatgpt.com/g/software',
      'codex-main': 'https://chatgpt.com/g/codex'
    }
  }));
  const unsafe = SchoolCabinetSettings.parseStoredValue({
    version: 1,
    cabinets: {
      'chatgpt-software': 'https://example.com/not-chatgpt'
    }
  });

  assert.deepEqual(unknown.settings, {
    version: 1,
    cabinets: {
      'chatgpt-software': 'https://chatgpt.com/g/software'
    }
  });
  assert.equal(unknown.warning, null);
  assert.deepEqual(unsafe.settings, { version: 1, cabinets: {} });
  assert.equal(unsafe.warning.code, 'INVALID_STORED_URL');
});

test('serializes normalized settings and scopes cache keys to a user', () => {
  assert.equal(
    SchoolCabinetSettings.serialize({
      version: 1,
      cabinets: {
        'chatgpt-software': ' https://chatgpt.com/g/software ',
        'codex-main': 'https://chatgpt.com/g/ignored'
      }
    }),
    JSON.stringify({
      version: 1,
      cabinets: {
        'chatgpt-software': 'https://chatgpt.com/g/software'
      }
    })
  );
  assert.equal(
    SchoolCabinetSettings.cacheKeyForUser(' user-1 '),
    'school_cabinet_urls_cache_v1:user-1'
  );
  assert.throws(
    () => SchoolCabinetSettings.cacheKeyForUser(''),
    /user id is required/
  );
});

test('applies valid overrides without mutating frozen config', () => {
  const base = Object.freeze({
    cabinets: Object.freeze({
      'chatgpt-software': Object.freeze({
        label: 'software',
        platform: 'ChatGPT',
        kind: 'permanent',
        url: ''
      }),
      'codex-main': Object.freeze({
        label: 'codex',
        platform: 'Codex',
        kind: 'permanent',
        url: ''
      })
    }),
    marker: 'base'
  });

  const next = SchoolCabinetSettings.applyToConfig(base, {
    version: 1,
    cabinets: {
      'chatgpt-software': 'https://chatgpt.com/g/software',
      'codex-main': 'https://chatgpt.com/g/ignored'
    }
  });

  assert.notEqual(next, base);
  assert.equal(base.cabinets['chatgpt-software'].url, '');
  assert.equal(
    next.cabinets['chatgpt-software'].url,
    'https://chatgpt.com/g/software'
  );
  assert.equal(next.cabinets['codex-main'].url, '');
  assert.equal(next.marker, 'base');
});
