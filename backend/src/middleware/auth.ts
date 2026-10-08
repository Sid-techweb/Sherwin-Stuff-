import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db/pool';
import { AuthUser, Role } from '../types';
import { forbidden, unauthorized } from '../utils/errors';
import { asyncHandler } from '../utils/asyncHandler';

interface TokenPayload {
  sub: string;
}

/**
 * Verifies the Bearer token, then re-loads the user from PostgreSQL so that
 * deactivated users or role changes take effect immediately (not after token expiry).
 */
export const authenticate = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();
  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret, { algorithms: ['HS256'] }) as unknown as TokenPayload;
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const { rows } = await query<{ id: string; email: string; name: string; role: Role; facility_id: string | null }>(
    'SELECT id, email, name, role, facility_id FROM users WHERE id = $1 AND is_active = TRUE',
    [payload.sub],
  );
  if (!rows[0]) throw unauthorized('User no longer active');
  const u = rows[0];
  req.user = { id: u.id, email: u.email, name: u.name, role: u.role, facilityId: u.facility_id } as AuthUser;
  next();
});

/** Server-side RBAC: allow only the listed roles. */
export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
