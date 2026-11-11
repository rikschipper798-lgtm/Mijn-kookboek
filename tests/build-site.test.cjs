'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSite, PUBLIC_FILES } = require('../scripts/build-site.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kookboek-site-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, contents = `inhoud van ${name}`) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), contents);
  };
  for (const file of PUBLIC_FILES) write(file);
  for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) write(`icons/${icon}`);
  write('images/recept.webp');
  return { root, write };
}

test('publiceert alle appbestanden en afbeeldingen zonder ontwikkel- of back-upbestanden', t => {
  const { root, write } = fixture(t);
  for (const file of ['.env', 'supabase/schema.sql', 'tests/test.cjs', 'node_modules/private.js', 'back-up.json']) write(file);
  const output = buildSite(root);
  for (const file of [...PUBLIC_FILES, 'images/recept.webp', 'icons/icon-192.png']) {
    assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(root, file)));
  }
  for (const file of ['.env', 'supabase', 'tests', 'node_modules', 'back-up.json']) {
    assert.equal(fs.existsSync(path.join(output, file)), false, file);
  }
  assert.ok(fs.existsSync(path.join(output, '.nojekyll')));
});

test('verwijdert bestanden uit een ouder websitepakket', t => {
  const { root, write } = fixture(t);
  write('_site/oude-back-up.json');
  assert.equal(fs.existsSync(path.join(buildSite(root), 'oude-back-up.json')), false);
});

test('ontbrekende appbestanden of installatiepictogrammen keuren het pakket af', t => {
  const { root, write } = fixture(t);
  for (const file of ['recipe-scaling.js', 'icons/icon-512.png']) {
    fs.rmSync(path.join(root, file));
    assert.throws(() => buildSite(root));
    write(file);
  }
});

test('symbolische koppelingen mogen geen bestanden buiten de publicatieset meenemen', t => {
  const { root, write } = fixture(t);
  write('geheim.txt', 'niet publiceren');
  fs.symlinkSync(path.join(root, 'geheim.txt'), path.join(root, 'images/extra.webp'));
  assert.throws(() => buildSite(root), /Onverwacht bestand/);
});

test('onverwachte bestanden in de afbeeldingenmap worden afgekeurd', t => {
  const { root, write } = fixture(t);
  write('images/back-up.json');
  assert.throws(() => buildSite(root), /Onverwacht bestand/);
});
