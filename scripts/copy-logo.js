const fs = require('fs');
const path = require('path');

const assetsDir = path.join(
  process.env.USERPROFILE,
  '.cursor',
  'projects',
  'c-Users-premier-Desktop-Usman-Garments',
  'assets',
);
const root = path.resolve(__dirname, '..');

const files = fs.readdirSync(assetsDir).filter((n) => n.includes('ChatGPT') && n.includes('8b544957'));
if (!files.length) {
  const all = fs.readdirSync(assetsDir).filter((n) => n.includes('ChatGPT'));
  console.error('candidates', all);
  throw new Error('new logo not found');
}

const src = path.join(assetsDir, files[0]);
const dests = [
  path.join(root, 'frontend', 'public', 'logo.png'),
  path.join(root, 'build', 'icon.png'),
];

for (const dest of dests) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log('copied', dest, fs.statSync(dest).size);
}

// Clean mistaken nested copies from earlier run
const mistaken = path.join(__dirname, 'frontend');
if (fs.existsSync(mistaken)) {
  fs.rmSync(mistaken, { recursive: true, force: true });
}
const mistakenBuild = path.join(__dirname, 'build');
if (fs.existsSync(mistakenBuild)) {
  fs.rmSync(mistakenBuild, { recursive: true, force: true });
}
