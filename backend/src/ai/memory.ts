import crypto from 'crypto';
import { pool } from '../db/pool';
import { AuthUser } from '../types';
import * as hindsight from './hindsight';

/**
 * MEMORY POLICY
 *  - Only distilled, operationally useful statements are retained (aggregate facts, patterns, explicit user preferences).
 *  - Raw conversations are NEVER stored. Credentials are rejected; e-mail addresses, phone numbers and UUIDs are redacted.
 *  - Every retained memory is written to a local ledger (ai_memories) and, if configured, to Hindsight.
 *  - Recall uses Hindsight first; if it is down or returns nothing, the local ledger (PostgreSQL full-text search) is used.
 *  - Recalled memories are context, never ground truth: the assistant labels them MEMORY and prefers live database facts.
 */
export const MEMORY_CATEGORIES = [
  'USER_PREFERENCE',
  'OPERATIONAL_CONTEXT',
  'INCIDENT',
  'COMPLIANCE_PATTERN',
  'FACILITY_HISTORY',
  'TRANSPORT_HISTORY',
  'CONVERSATION_CONTEXT',
] as const;
export type MemoryCategory = (typeof MEMORY_CATEGORIES)[number];

export interface Memory {
  id: string;
  text: string;
  category?: string;
  source: 'hindsight' | 'local';
  createdAt?: string;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const SECRET = /(password|passwd|api[_ -]?key|secret|token)\s*[:=]/i;

/** Returns the cleaned text, or null if it must not be stored. */
export function sanitizeMemory(text: string): string | null {
  if (SECRET.test(text)) return null;
  // Redact only the parts between ISO dates (2026-10-08) so dates are never mistaken for phone numbers.
  const t = text
    .split(/(\d{4}-\d{2}-\d{2})/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(EMAIL, '[email]').replace(UUID, '[id]').replace(PHONE, '[number]')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length < 10 || t.length > 600) return null;
  return t;
}

const hash = (t: string) => crypto.createHash('sha1').update(t.toLowerCase()).digest('hex');

export async function retain(user: AuthUser, text: string, category: MemoryCategory, facilityId?: string | null): Promise<Memory | null> {
  const clean = sanitizeMemory(text);
  if (!clean) return null;
  const h = hash(clean);
  const dup = await pool.query(`SELECT id FROM ai_memories WHERE text_hash = $1 AND created_at > now() - interval '24 hours' LIMIT 1`, [h]);
  if (dup.rowCount) return null; // never store the same fact repeatedly
  const synced = await hindsight.retain(clean, category, facilityId ? [`facility:${facilityId}`] : []);
  const r = await pool.query(
    `INSERT INTO ai_memories (category, text, text_hash, created_by, facility_id, synced_to_hindsight)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
    [category, clean, h, user.id, facilityId ?? null, synced],
  );
  return { id: r.rows[0].id, text: clean, category, source: synced ? 'hindsight' : 'local', createdAt: r.rows[0].created_at };
}

const STOP = new Set(
  'the and for with that this from what which when where have has had was were are who why how did does about into over than then them they their our your you can could would should show tell give list there here been being also just more most some any all not but out off per last first month week today issue'.split(
    ' ',
  ),
);

export function keywords(q: string): string[] {
  return [...new Set((q.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w)))].slice(0, 12);
}

async function recallLocal(query: string, limit: number): Promise<Memory[]> {
  const words = keywords(query);
  if (!words.length) return [];
  const r = await pool.query(
    `SELECT id, text, category, created_at, ts_rank(tsv, to_tsquery('english', $1)) AS rank
     FROM ai_memories WHERE tsv @@ to_tsquery('english', $1)
     ORDER BY rank DESC, created_at DESC LIMIT $2`,
    [words.join(' | '), limit],
  );
  return r.rows.map((m) => ({ id: m.id, text: m.text, category: m.category, source: 'local' as const, createdAt: m.created_at }));
}

export async function recall(query: string, limit = 5): Promise<{ memories: Memory[]; backend: 'hindsight' | 'local' | 'none' }> {
  const remote = await hindsight.recall(query, limit);
  if (remote && remote.length)
    return { memories: remote.map((m) => ({ id: m.id, text: m.text, category: m.type, source: 'hindsight' as const })), backend: 'hindsight' };
  const local = await recallLocal(query, limit);
  return { memories: local, backend: local.length ? 'local' : 'none' };
}

export async function ledger(limit = 50): Promise<Memory[]> {
  const r = await pool.query(`SELECT id, text, category, synced_to_hindsight, created_at FROM ai_memories ORDER BY created_at DESC LIMIT $1`, [limit]);
  return r.rows.map((m) => ({
    id: m.id,
    text: m.text,
    category: m.category,
    source: m.synced_to_hindsight ? ('hindsight' as const) : ('local' as const),
    createdAt: m.created_at,
  }));
}
