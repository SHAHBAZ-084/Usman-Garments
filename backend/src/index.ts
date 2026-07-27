import path from 'path';
import dotenv from 'dotenv';
import { getDatabaseUrl } from './config/paths';
import { createApp } from './app';
import { env } from './config/env';
import { registerShutdownHooks, runStartupTasks } from './startup';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
process.env.DATABASE_URL = getDatabaseUrl();

const app = createApp();

registerShutdownHooks();

runStartupTasks()
  .then(() => {
    app.listen(env.port, '127.0.0.1', () => {
      console.log(`Usman Mall API listening on http://127.0.0.1:${env.port}`);
    });
  })
  .catch((err) => {
    console.error('Startup failed:', err);
    process.exit(1);
  });

export default app;
