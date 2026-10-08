import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Thin client for the Hindsight memory service (https://github.com/vectorize-io/hindsight).
 * Hindsight is a MEMORY system (retain / recall), NOT the LLM. Every call fails soft: callers
 * receive null on any problem and fall back to the local memory ledger.
 *
 * Endpoints used (Hindsight HTTP API v1):
 *   GET  /v1/default/banks                           health probe
 *   PUT  /v1/default/banks/{bank}                    create/update the memory bank
 *   POST /v1/default/banks/{bank}/memories           retain  { items: [{ content, context, tags, timestamp }] }
 *   POST /v1/default/banks/{bank}/memories/recall    recall  { query, budget, max_tokens }
 */
const TIMEOUT_MS = 8000;

export const hindsightEnabled = () => !!config.ai.hindsightUrl;

async function call<T>(method: string, path: string, body?: unknown): Promise<T | null> {
  if (!config.ai.hindsightUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.ai.hindsightUrl}${path}`, {
      method,
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(config.ai.hindsightApiKey ? { Authorization: `Bearer ${config.ai.hindsightApiKey}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, 'hindsight request failed');
      return null;
    }
    return (await res.json().catch(() => ({}))) as T;
  } catch (err) {
    logger.warn({ err: (err as Error).message, path }, 'hindsight unreachable');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

let bankReady = false;
export const resetBankState = () => {
  bankReady = false;
};

async function ensureBank(): Promise<boolean> {
  if (bankReady) return true;
  const r = await call('PUT', `/v1/default/banks/${encodeURIComponent(config.ai.hindsightBank)}`, {
    reflect_mission:
      'Long-term operational memory for a biomedical waste tracking system: facility history, transport delays, incidents, compliance patterns and user preferences. Never store personal data or credentials.',
  });
  bankReady = r !== null;
  return bankReady;
}

export async function health(): Promise<boolean> {
  if (!hindsightEnabled()) return false;
  return (await call('GET', '/v1/default/banks')) !== null;
}

export async function retain(text: string, category: string, tags: string[] = []): Promise<boolean> {
  if (!(await ensureBank())) return false;
  const r = await call('POST', `/v1/default/banks/${encodeURIComponent(config.ai.hindsightBank)}/memories`, {
    items: [{ content: text, context: category, tags: [category, ...tags], timestamp: new Date().toISOString() }],
    async: true,
  });
  return r !== null;
}

export interface RecalledMemory {
  id: string;
  text: string;
  type?: string;
}

export async function recall(query: string, limit = 5): Promise<RecalledMemory[] | null> {
  if (!(await ensureBank())) return null;
  const r = await call<{ results?: { id: string; text: string; type?: string }[] }>(
    'POST',
    `/v1/default/banks/${encodeURIComponent(config.ai.hindsightBank)}/memories/recall`,
    { query, budget: 'low', max_tokens: 1500 },
  );
  if (!r) return null;
  return (r.results ?? []).slice(0, limit).map((m) => ({ id: m.id, text: m.text, type: m.type }));
}
