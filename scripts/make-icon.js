/**
 * Build a multi-resolution Windows .ico from the Usman Mall logo.
 * Requires Pillow:  pip install pillow
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'frontend', 'public', 'logo.png');
const outIco = path.join(root, 'build', 'icon.ico');
const outPng = path.join(root, 'build', 'icon.png');

if (!fs.existsSync(src)) {
  console.error('Missing logo:', src);
  process.exit(1);
}

fs.mkdirSync(path.dirname(outIco), { recursive: true });

const py = `
from PIL import Image
from pathlib import Path

img = Image.open(r'''${src.replace(/\\/g, '\\\\')}''').convert('RGBA')
w, h = img.size
side = max(w, h)
canvas = Image.new('RGBA', (side, side), (255, 255, 255, 255))
canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
master = canvas.resize((256, 256), Image.Resampling.LANCZOS)
master.save(r'''${outPng.replace(/\\/g, '\\\\')}''', format='PNG')
sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
master.save(r'''${outIco.replace(/\\/g, '\\\\')}''', format='ICO', sizes=sizes)
print('ok', Path(r'''${outIco.replace(/\\/g, '\\\\')}''').stat().st_size)
`;

execFileSync('python', ['-c', py], { stdio: 'inherit' });
console.log('wrote', outIco);
console.log('wrote', outPng);
