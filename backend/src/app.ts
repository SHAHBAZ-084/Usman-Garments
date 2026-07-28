import path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import session from 'express-session';
import { env } from './config/env';
import { errorHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { accountingRouter } from './modules/accounting/accounting.routes';
import { settingsRouter } from './modules/settings/settings.routes';
import { productsRouter } from './modules/products/products.routes';
import { suppliersRouter } from './modules/suppliers/suppliers.routes';
import { purchasesRouter } from './modules/purchases/purchases.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { salesRouter } from './modules/sales/sales.routes';
import { financeRouter } from './modules/finance/finance.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { backupRouter } from './modules/backup/backup.routes';
import { healthRouter } from './modules/health/health.routes';
import { getUploadsDir } from './config/paths';

declare module 'express-session' {
  interface SessionData {
    userId?: number;
    identityEditExpiresAt?: number;
  }
}

export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: env.isProduction
        ? [`http://127.0.0.1:${env.port}`, `http://localhost:${env.port}`]
        : ['http://localhost:5173', 'http://127.0.0.1:5173', `http://127.0.0.1:${env.port}`],
      credentials: true,
    }),
  );

  app.use(express.json());
  app.use(cookieParser());
  app.use(
    session({
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        maxAge: 1000 * 60 * 60 * 12,
      },
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'usman-mall' });
  });

  app.use('/uploads', express.static(getUploadsDir()));
  app.use('/api/auth', authRouter);
  app.use('/api/accounting', accountingRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/suppliers', suppliersRouter);
  app.use('/api/purchases', purchasesRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/sales', salesRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/backup', backupRouter);
  app.use('/api/system', healthRouter);

  if (env.isProduction) {
    const frontendDist = path.resolve(__dirname, '../../frontend/dist');
    app.use(express.static(frontendDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'));
    });
  }

  app.use(errorHandler);

  return app;
}
