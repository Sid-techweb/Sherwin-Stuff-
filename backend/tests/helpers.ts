import request from 'supertest';
import { createApp } from '../src/app';
import { pool } from '../src/db/pool';
import { redis } from '../src/db/redis';
import { DEMO_PASSWORD, seedReference, truncateAll } from '../src/db/seed';

export const app = createApp();
export const http = () => request(app);

export async function resetDb() {
  await truncateAll(pool);
  const ref = await seedReference(pool);
  if (redis.status === 'ready') await redis.flushdb();
  return ref;
}

export async function tokenFor(email: string): Promise<string> {
  const r = await http().post('/api/auth/login').send({ email, password: DEMO_PASSWORD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return r.body.data.token;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

export interface Actors {
  admin: string;
  staff: string; // DGH staff
  staffOther: string; // DCC staff
  collector: string;
  transporter: string;
  operator: string;
  auditor: string;
}

export async function actors(): Promise<Actors> {
  return {
    admin: await tokenFor('admin@bmw.demo'),
    staff: await tokenFor('staff.dgh@bmw.demo'),
    staffOther: await tokenFor('staff.dcc@bmw.demo'),
    collector: await tokenFor('collector1@bmw.demo'),
    transporter: await tokenFor('transporter1@bmw.demo'),
    operator: await tokenFor('operator@bmw.demo'),
    auditor: await tokenFor('auditor@bmw.demo'),
  };
}

export async function ids() {
  const q = async (sql: string) => (await pool.query(sql)).rows;
  return {
    yellow: (await q(`SELECT id FROM waste_categories WHERE code='YELLOW'`))[0].id as number,
    dgh: (await q(`SELECT id FROM facilities WHERE code='DGH'`))[0].id as string,
    incin: (await q(`SELECT id FROM treatment_facilities WHERE code='DIP'`))[0].id as string,
    vehicle: (await q(`SELECT id FROM vehicles WHERE registration='DM-01-BMW-1001'`))[0].id as string,
    vehicle2: (await q(`SELECT id FROM vehicles WHERE registration='DM-01-BMW-1002'`))[0].id as string,
    collector: (await q(`SELECT id FROM users WHERE email='collector1@bmw.demo'`))[0].id as string,
    staffUser: (await q(`SELECT id FROM users WHERE email='staff.dgh@bmw.demo'`))[0].id as string,
  };
}

export const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
