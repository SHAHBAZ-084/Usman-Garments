/**
 * Fresh-clone setup: copy .env if missing/invalid, ensure data dir, migrate, seed.
 * Cross-platform (Windows / macOS / Linux).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const backendDir = path.join(root, 'backend');
const envPath = path.join(backendDir, '.env');
const envExamplePath = path.join(backendDir, '.env.example');
const dataDir = path.join(backendDir, 'prisma', 'data');

function run(command, args, cwd) {
  console.log(`> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function envLooksValid(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // Reject UTF-16 BOM (common accidental Windows write)
    if (
      buf.length >= 2 &&
      ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))
    ) {
      return false;
    }
    const text = buf.toString('utf8');
    return /(?:^|\n|\r)DATABASE_URL\s*=/.test(text);
  } catch {
    return false;
  }
}

if (!fs.existsSync(envExamplePath)) {
  console.error('Missing backend/.env.example');
  process.exit(1);
}

const envExisted = fs.existsSync(envPath);
if (!envExisted || !envLooksValid(envPath)) {
  fs.copyFileSync(envExamplePath, envPath);
  console.log(
    envExisted
      ? 'Replaced invalid backend/.env from backend/.env.example'
      : 'Created backend/.env from backend/.env.example',
  );
} else {
  console.log('backend/.env already exists — leaving it unchanged');
}

fs.mkdirSync(dataDir, { recursive: true });
console.log(`Ensured directory: ${path.relative(root, dataDir)}`);

run('npx', ['prisma', 'migrate', 'deploy'], backendDir);
run('npm', ['run', 'db:seed', '-w', 'backend'], root);

console.log('Setup complete.');
