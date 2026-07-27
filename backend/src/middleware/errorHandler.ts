import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/helpers';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ error: err.message, code: err.code ?? undefined });
    return;
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
