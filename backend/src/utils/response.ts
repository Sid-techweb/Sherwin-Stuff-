import { Response } from 'express';

export const ok = (res: Response, data: unknown, meta?: unknown, status = 200) =>
  res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });

export const created = (res: Response, data: unknown) => ok(res, data, undefined, 201);
