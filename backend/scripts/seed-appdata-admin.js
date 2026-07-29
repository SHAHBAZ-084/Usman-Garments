const path = require('path');
const bcrypt = require('bcryptjs');

process.env.USMAN_USER_DATA = path.join(process.env.APPDATA, 'usman-garments');
process.env.NODE_ENV = 'production';

(async () => {
  const { configureSqlite, prisma } = require('../dist/lib/prisma');
  await configureSqlite();
  const users = await prisma.user.findMany({ select: { id: true, username: true } });
  console.log('users before', users);
  if (users.length === 0) {
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: { username: 'admin', passwordHash, displayName: 'Shop Owner' },
    });
    try {
      await prisma.$executeRawUnsafe(`UPDATE User SET role = 'Owner' WHERE username = 'admin'`);
    } catch (e) {
      console.log('role skip', e.message);
    }
    console.log('created admin / admin123');
  } else {
    console.log('users already exist — not overwriting passwords');
  }
  console.log('users after', await prisma.user.findMany({ select: { id: true, username: true } }));
  await prisma.$disconnect();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
