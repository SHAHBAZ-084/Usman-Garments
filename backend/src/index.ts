import path from 'path';
import dotenv from 'dotenv';
import { createApp } from './app';
import { env } from './config/env';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = createApp();

app.listen(env.port, '127.0.0.1', () => {
  console.log(`Usman Garments API listening on http://127.0.0.1:${env.port}`);
});

export default app;
