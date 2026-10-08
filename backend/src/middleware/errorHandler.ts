import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(404, 'NOT_FOUND', `Route ${req.method} ${req.path} not found`));
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res
      .status(err.status)
      .json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid request data', details: err.flatten() },
    });
  }
  // body-parser errors (malformed JSON, too large)
  const e = err as { status?: number; type?: string };
  if (e.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: { code: 'BAD_JSON', message: 'Malformed JSON body' } });
  }
  // Postgres: invalid text representation (e.g. malformed UUID in a path)
  const pg = err as { code?: string };
  if (pg.code === '22P02') {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Malformed identifier' } });
  }
  if (pg.code === '23503') {
    return res.status(400).json({ success: false, error: { code: 'BAD_REFERENCE', message: 'Referenced record does not exist' } });
  }
  if (pg.code === '23505') {
    return res.status(409).json({ success: false, error: { code: 'CONFLICT', message: 'Record already exists' } });
  }
  // Unknown: log full detail server-side, return a generic message (no stack/SQL leak).
  if (process.env.DEBUG_ERRORS) console.error(err);
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
