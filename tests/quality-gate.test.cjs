'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkQualityGate } = require('../scripts/check-quality-gate.cjs');

const successful = () => ({
  validate: { result: 'success' },
  browser: { result: 'success' },
  site: { result: 'success' }
});

test('alle vereiste controles moeten werkelijk geslaagd zijn', () => {
  assert.doesNotThrow(() => checkQualityGate(successful()));
});

for (const job of ['validate', 'browser', 'site']) {
  for (const result of ['failure', 'cancelled', 'skipped', 'neutral']) {
    test(`${job} met resultaat ${result} blokkeert publicatie`, () => {
      const needs = successful();
      needs[job].result = result;
      assert.throws(() => checkQualityGate(needs), new RegExp(`${job}: ${result}`));
    });
  }
  test(`ontbrekende controle ${job} blokkeert publicatie`, () => {
    const needs = successful();
    delete needs[job];
    assert.throws(() => checkQualityGate(needs), new RegExp(`${job}: ontbreekt`));
  });
}

test('ongeldige resultaten blokkeren ook via het echte commandoregelprogramma', () => {
  const script = path.join(__dirname, '../scripts/check-quality-gate.cjs');
  for (const value of ['', 'null', '[]', '{}', 'ongeldige json']) {
    const run = spawnSync(process.execPath, [script], {
      env: { ...process.env, NEEDS_JSON: value }, encoding: 'utf8'
    });
    assert.equal(run.status, 1, value);
    assert.match(run.stderr, /PUBLICATIE GEBLOKKEERD/);
  }
});
