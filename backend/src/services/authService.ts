import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { pool, query } from '../db/pool';
import { AuthUser, Role } from '../types';
import { badRequest, conflict, unauthorized } from '../utils/errors';
import { audit } from './auditService';

const BCRYPT_ROUNDS = 10;
// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

interface UserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  facility_id: string | null;
  password_hash: string;
  is_active: boolean;
}

const toAuthUser = (u: UserRow): AuthUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, facilityId: u.facility_id });

export async function login(email: string, password: string) {
  const { rows } = await query<UserRow>(
    'SELECT id, email, name, role, facility_id, password_hash, is_active FROM users WHERE lower(email) = lower($1)',
    [email],
  );
  const u = rows[0];
  const valid = await bcrypt.compare(password, u?.password_hash ?? DUMMY_HASH);
  if (!u || !valid || !u.is_active) {
    await audit(pool, u?.id ?? null, 'LOGIN_FAILED', 'user', u?.id ?? null, { email });
    throw unauthorized('Invalid email or password');
  }
  const token = jwt.sign({ sub: u.id, role: u.role }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
  await audit(pool, u.id, 'LOGIN', 'user', u.id);
  return { token, user: toAuthUser(u) };
}

export async function register(
  actor: AuthUser,
  input: { email: string; name: string; password: string; role: Role; facilityId?: string },
) {
  if (input.role === 'HOSPITAL_STAFF' && !input.facilityId) throw badRequest('facilityId is required for HOSPITAL_STAFF');
  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    const { rows } = await query<UserRow>(
      `INSERT INTO users (email, name, password_hash, role, facility_id) VALUES (lower($1),$2,$3,$4::user_role,$5)
       RETURNING id, email, name, role, facility_id, password_hash, is_active`,
      [input.email, input.name, hash, input.role, input.facilityId ?? null],
    );
    await audit(pool, actor.id, 'USER_CREATED', 'user', rows[0].id, { email: rows[0].email, role: input.role });
    return toAuthUser(rows[0]);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === '23505') throw conflict('A user with this email already exists');
    throw err;
  }
}
