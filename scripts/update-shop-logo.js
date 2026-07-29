const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

async function main() {
  const root = path.resolve(__dirname, '..');
  const source = path.join(root, 'frontend', 'public', 'logo.png');
  if (!fs.existsSync(source)) throw new Error('frontend/public/logo.png missing');

  const uploadsDir = path.join(root, 'backend', 'prisma', 'data', 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const filename = 'logo-default.png';
  const dest = path.join(uploadsDir, filename);
  fs.copyFileSync(source, dest);

  const prisma = new PrismaClient();
  await prisma.businessSettings.update({
    where: { id: 1 },
    data: { logoPath: path.join('uploads', filename) },
  });
  console.log('Updated shop logo at', dest);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
