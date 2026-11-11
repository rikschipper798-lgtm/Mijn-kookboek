'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Alleen de bestanden die de browser nodig heeft worden gepubliceerd.
const PUBLIC_FILES = [
  'index.html', 'voeding.html', 'privacy.html', 'instellen-vaste-maaltijden.html',
  'backup-sleutel.html', 'recepten.json', 'manifest.webmanifest', 'sw.js',
  'recipe-scaling.js', 'pantry.js', 'personal-cloud.js', 'voeding-cloud.js',
  'voeding-backup.js', 'cloud-config.js'
];
const IMAGE_EXTENSION = /\.(?:avif|webp|png|jpe?g|svg|gif|ico)$/i;

function buildSite(root = path.resolve(__dirname, '..')) {
  const output = path.join(root, '_site');
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  const copy = relative => {
    const source = path.join(root, relative);
    const stat = fs.lstatSync(source);
    if (!stat.isFile()) throw new Error(`Geen regulier publiek bestand: ${relative}`);
    const destination = path.join(output, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
  };
  const copyImages = relative => {
    if (!fs.lstatSync(path.join(root, relative)).isDirectory()) {
      throw new Error(`Geen reguliere afbeeldingenmap: ${relative}`);
    }
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) copyImages(child);
      else if (entry.isFile() && IMAGE_EXTENSION.test(entry.name)) copy(child);
      else throw new Error(`Onverwacht bestand in publieke afbeeldingenmap: ${child}`);
    }
  };
  for (const file of PUBLIC_FILES) copy(file);
  for (const directory of ['icons', 'images']) copyImages(directory);
  // De installatie van de serviceworker vereist deze drie pictogrammen.
  for (const icon of ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png']) {
    if (!fs.existsSync(path.join(output, 'icons', icon))) throw new Error(`Pictogram ontbreekt: ${icon}`);
  }
  fs.writeFileSync(path.join(output, '.nojekyll'), '');
  return output;
}

if (require.main === module) {
  try { console.log('Websitepakket gemaakt:', buildSite()); }
  catch (error) { console.error('Websitepakket afgekeurd:', error.message); process.exitCode = 1; }
}

module.exports = { buildSite, PUBLIC_FILES };
