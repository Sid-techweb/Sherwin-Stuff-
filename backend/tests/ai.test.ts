import http from 'http';
import { AddressInfo } from 'net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as assistant from '../src/ai/assistant';
import * as hindsight from '../src/ai/hindsight';
import * as memory from '../src/ai/memory';
import { executeTool } from '../src/ai/tools';
import { config } from '../src/config';
import { pool } from '../src/db/pool';
import { seedDemo } from '../src/db/seed';
import { AuthUser } from '../src/types';
import { actors, Actors, bearer, http as api, resetDb } from './helpers';

let a: Actors;
let admin: AuthUser;
let staff: AuthUser;
let auditor: AuthUser;

const user = async (email: string): Promise<AuthUser> => {
  const r = await pool.query('SELECT id,email,name,role,facility_id FROM users WHERE email=$1', [email]);
  const u = r.rows[0];
  return { id: u.id, email: u.email, name: u.name, role: u.role, facilityId: u.facility_id };
};

beforeAll(async () => {
  const ref = await resetDb();
  await seedDemo(pool, ref, 150);
  a = await actors();
  admin = await user('admin@bmw.demo');
  staff = await user('staff.dgh@bmw.demo');
  auditor = await user('auditor@bmw.demo');
});

// ------------------------------------------------------------------ mock servers
interface Mock {
  url: string;
  requests: { path: string; body: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  close: () => Promise<void>;
}
function mockServer(handler: (path: string, body: any, method: string) => { status?: number; json: unknown }): Promise<Mock> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const requests: Mock['requests'] = [];
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : {};
        requests.push({ path: req.url ?? '', body });
        const r = handler(req.url ?? '', body, req.method ?? 'GET');
        res.writeHead(r.status ?? 200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(r.json));
      });
    });
    server.listen(0, '127.0.0.1', () =>
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      }),
    );
  });
}

const resetAi = () => {
  config.ai.provider = 'none';
  config.ai.apiKey = undefined;
  config.ai.hindsightUrl = undefined;
  hindsight.resetBankState();
};
afterAll(resetAi);

// ------------------------------------------------------------------ offline (data-only) mode
describe('assistant: offline data-only mode answers from PostgreSQL', () => {
  it('names the facility with the most waste, matching direct SQL, and cites its sources', async () => {
    resetAi();
    const r = await assistant.ask(admin, 'Which facility generated the most waste?');
    expect(r.mode).toBe('offline');
    const top = (await pool.query(`SELECT f.name, sum(w.quantity) kg FROM waste_records w JOIN facilities f ON f.id=w.facility_id GROUP BY f.name ORDER BY kg DESC LIMIT 1`)).rows[0];
    expect(r.answer).toContain(top.name);
    expect(r.answer).toContain('**Database fact:**');
    expect(r.sources.map((s) => s.tool)).toContain('getFacilityStatistics');
    expect(r.sources[0].ok).toBe(true);
  });

  it('red-category waste this month: figures equal direct SQL', async () => {
    const r = await assistant.ask(admin, 'How much red-category waste was generated this month?');
    const src = r.sources.find((s) => s.tool === 'getWasteStatistics')!;
    expect(src.args).toMatchObject({ category: 'RED', period: 'this_month' });
    const sql = await pool.query(
      `SELECT count(*)::int n, coalesce(round(sum(w.quantity),2),0)::float kg FROM waste_records w JOIN waste_categories c ON c.id=w.category_id
       WHERE c.code='RED' AND w.generated_at >= date_trunc('month', now())`,
    );
    expect((src.data as any).totals.records).toBe(sql.rows[0].n); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect((src.data as any).totals.quantityKg).toBeCloseTo(sql.rows[0].kg, 1); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('lists pending disposals, delayed transports and compares months', async () => {
    const pending = await assistant.ask(admin, 'Which waste records are still pending disposal?');
    expect(pending.sources[0].tool).toBe('getWasteRecords');
    expect(pending.sources[0].args).toMatchObject({ pendingDisposal: true });
    const delayed = await assistant.ask(admin, 'Show me delayed transports');
    expect(delayed.sources[0].tool).toBe('getDelayedTransports');
    const cmp = await assistant.ask(admin, 'Compare this month with last month');
    expect(cmp.sources).toHaveLength(2);
    expect(cmp.answer).toMatch(/This month:.*Last month:/);
    const weekly = await assistant.ask(admin, "Summarize this week's operational problems");
    expect(weekly.sources.length).toBeGreaterThanOrEqual(3);
  });

  it('looks up a record lifecycle by code', async () => {
    const code = (await pool.query(`SELECT record_code FROM waste_records WHERE status='CLOSED' LIMIT 1`)).rows[0].record_code;
    const r = await assistant.ask(admin, `Show the lifecycle of ${code}`);
    expect(r.sources[0].tool).toBe('getWasteLifecycle');
    expect(r.answer).toContain(code);
    expect(r.answer).toContain('CLOSED');
  });

  it('does not invent answers: unknown topics and unknown records are reported as unavailable', async () => {
    const vague = await assistant.ask(admin, 'Tell me a joke about penguins');
    expect(vague.sources).toHaveLength(0);
    expect(vague.answer).toContain('**Uncertainty:**');
    expect(vague.answer).not.toMatch(/\d+(\.\d+)? kg/);
    const missing = await assistant.ask(admin, 'Show lifecycle of BMW-2026-999999');
    expect(missing.sources[0].ok).toBe(false);
    expect(missing.answer).toContain('**Uncertainty:**');
    expect(missing.answer).toContain('No record BMW-2026-999999');
  });
});

// ------------------------------------------------------------------ tools: safety
describe('controlled tools: no arbitrary SQL, validated input, role-scoped', () => {
  it('rejects unknown tools and invalid arguments without touching the database', async () => {
    const unknown = await executeTool(admin, 'runSql', { query: 'DROP TABLE users' });
    expect(unknown.ok).toBe(false);
    const bad = await executeTool(admin, 'getWasteStatistics', { period: 'forever; DROP TABLE users', category: 'PURPLE' });
    expect(bad.ok).toBe(false);
    const inj = await executeTool(admin, 'getWasteStatistics', { facility: "x'; DROP TABLE users; --" });
    expect(inj.ok).toBe(false); // treated as an unknown facility name, never as SQL
    expect((await pool.query('SELECT count(*) FROM users')).rows[0].count).not.toBe('0');
    const code = await executeTool(admin, 'getWasteLifecycle', { recordCode: "BMW-1'; --" });
    expect(code.ok).toBe(false);
  });

  it('hospital staff only ever see their own facility through the assistant', async () => {
    const r = await executeTool(staff, 'getFacilityStatistics', {});
    expect(r.ok).toBe(true);
    const names = (r.data as any).facilities.map((f: any) => f.name); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(names).toEqual(['Demo General Hospital']);
    const records = await executeTool(staff, 'getWasteRecords', { limit: 20 });
    expect((records.data as any).records.every((x: any) => x.facility === 'Demo General Hospital')).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('audit history is limited to ADMIN/AUDITOR', async () => {
    expect((await executeTool(staff, 'getAuditHistory', {})).ok).toBe(false);
    const ok = await executeTool(auditor, 'getAuditHistory', { action: 'WASTE_CREATED', limit: 3 });
    expect(ok.ok).toBe(true);
    expect((ok.data as any).entries).toHaveLength(3); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
});

// ------------------------------------------------------------------ memory policy + local ledger
describe('memory: policy, local ledger recall', () => {
  it('redacts personal data and refuses credentials', async () => {
    expect(memory.sanitizeMemory('Contact jane.doe@hospital.org or +91 98765 43210 about delays')).toBe('Contact [email] or [number] about delays');
    expect(memory.sanitizeMemory('On 2026-10-08, Riverside had 26 late transports')).toBe('On 2026-10-08, Riverside had 26 late transports');
    expect(memory.sanitizeMemory('my password: hunter2 is used for login')).toBeNull();
    expect(memory.sanitizeMemory('short')).toBeNull();
    expect(memory.sanitizeMemory('x'.repeat(700))).toBeNull();
  });

  it('"remember ..." stores a user preference once (deduplicated) and it can be recalled', async () => {
    resetAi();
    const r1 = await assistant.ask(admin, 'Remember that I prefer weekly reports grouped by facility');
    expect(r1.memoriesRetained).toHaveLength(1);
    expect(r1.memoriesRetained[0].category).toBe('USER_PREFERENCE');
    const r2 = await assistant.ask(admin, 'Remember that I prefer weekly reports grouped by facility');
    expect(r2.memoriesRetained).toHaveLength(0);
    const rec = await memory.recall('how should weekly reports be grouped');
    expect(rec.backend).toBe('local');
    expect(rec.memories[0].text).toContain('grouped by facility');
    const secret = await assistant.ask(admin, 'Remember that the admin password: Hunter2! for the portal');
    expect(secret.memoriesRetained).toHaveLength(0);
  });

  it('retains aggregate findings and uses them for a later follow-up ("that facility")', async () => {
    resetAi();
    const first = await assistant.ask(admin, 'Which facility has the most delayed transports?');
    // the same finding may already have been stored earlier today (deduplicated), so check the ledger
    const stored = await pool.query(`SELECT 1 FROM ai_memories WHERE category = 'TRANSPORT_HISTORY'`);
    expect(stored.rowCount).toBeGreaterThan(0);
    expect(first.memoriesRetained.every((m) => !/@|password/i.test(m.text))).toBe(true);
    const follow = await assistant.ask(
      admin,
      'What was the issue we saw with that facility earlier?',
      [{ role: 'user', text: 'Which facility has the most delayed transports? Riverside' }, { role: 'assistant', text: first.answer }],
    );
    expect(follow.memoriesUsed.length).toBeGreaterThan(0);
    expect(follow.answer).toContain('**Memory:**');
    expect(follow.answer).toMatch(/Riverside/);
    const ledger = await memory.ledger();
    expect(ledger.length).toBeGreaterThanOrEqual(2);
  });
});

// ------------------------------------------------------------------ Hindsight (mock server speaking its HTTP API)
describe('Hindsight integration', () => {
  it('retains to and recalls from Hindsight; falls back to the local ledger when it goes down', async () => {
    const stored: any[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    const mock = await mockServer((path, body, method) => {
      if (method === 'GET' && path === '/v1/default/banks') return { json: { banks: [], total: 0 } };
      if (method === 'PUT') return { json: { bank_id: 'bmw-operations' } };
      if (path.endsWith('/memories/recall')) return { json: { results: stored.map((s, i) => ({ id: `h${i}`, text: s.content, type: 'world' })) } };
      if (path.endsWith('/memories')) {
        stored.push(...body.items);
        return { json: { success: true, items_count: body.items.length } };
      }
      return { status: 404, json: {} };
    });
    config.ai.hindsightUrl = mock.url;
    hindsight.resetBankState();
    expect(await hindsight.health()).toBe(true);

    const saved = await memory.retain(admin, 'Demo Lakeside Medical Centre reported repeated sharps in the red stream', 'COMPLIANCE_PATTERN');
    expect(saved?.source).toBe('hindsight');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ context: 'COMPLIANCE_PATTERN' });
    expect(stored[0].tags).toContain('COMPLIANCE_PATTERN');
    expect(mock.requests.some((r) => r.path === '/v1/default/banks/bmw-operations')).toBe(true);

    const rec = await memory.recall('sharps in red stream at Lakeside');
    expect(rec.backend).toBe('hindsight');
    expect(rec.memories[0].text).toContain('Lakeside');

    const viaAssistant = await assistant.ask(admin, 'What was the problem we saw earlier at Lakeside?');
    expect(viaAssistant.memoryBackend).toBe('hindsight');

    await mock.close(); // outage
    hindsight.resetBankState();
    const down = await memory.recall('sharps in red stream at Lakeside');
    expect(down.backend).toBe('local'); // ledger still has it
    const stillWorks = await assistant.ask(admin, 'Show me delayed transports');
    expect(stillWorks.sources[0].ok).toBe(true);
    resetAi();
  });
});

// ------------------------------------------------------------------ LLM mode (mock providers)
describe('LLM mode: provider-agnostic tool calling', () => {
  it('OpenAI-compatible: model calls a tool, receives DB data, returns the labelled answer', async () => {
    const mock = await mockServer((_path, body) => {
      const sawToolResult = body.messages.some((m: any) => m.role === 'tool'); // eslint-disable-line @typescript-eslint/no-explicit-any
      if (!sawToolResult)
        return { json: { choices: [{ message: { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'getWasteStatistics', arguments: JSON.stringify({ period: 'all_time' }) } }] } }] } };
      const tool = body.messages.find((m: any) => m.role === 'tool'); // eslint-disable-line @typescript-eslint/no-explicit-any
      const total = JSON.parse(tool.content).totals.records;
      return { json: { choices: [{ message: { content: `**Database fact:** ${total} records exist in total.` } }] } };
    });
    config.ai.provider = 'openai';
    config.ai.apiKey = 'test-key';
    config.ai.model = 'mock-model';
    config.ai.baseUrl = `${mock.url}/v1`;
    const r = await assistant.ask(admin, 'How many waste records are there?');
    const n = (await pool.query('SELECT count(*)::int n FROM waste_records')).rows[0].n;
    expect(r.mode).toBe('llm');
    expect(r.model).toBe('openai:mock-model');
    expect(r.answer).toContain(`${n} records`);
    expect(r.sources[0].tool).toBe('getWasteStatistics');
    const first = mock.requests[0].body;
    expect(first.model).toBe('mock-model');
    expect(first.tools.map((t: any) => t.function.name)).toContain('getFacilityStatistics'); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(first.messages[0].role).toBe('system');
    expect(first.messages[0].content).toContain('NEVER invent');
    expect(JSON.stringify(first.tools)).not.toMatch(/sql/i);
    await mock.close();
    resetAi();
  });

  it('Anthropic format works through the same abstraction', async () => {
    const mock = await mockServer((_path, body) => {
      const last = body.messages[body.messages.length - 1];
      const isResult = Array.isArray(last.content) && last.content[0]?.type === 'tool_result';
      if (!isResult) return { json: { content: [{ type: 'tool_use', id: 'tu_1', name: 'getActiveAlerts', input: { limit: 3 } }] } };
      return { json: { content: [{ type: 'text', text: '**Database fact:** alerts reviewed.' }] } };
    });
    config.ai.provider = 'anthropic';
    config.ai.apiKey = 'test-key';
    config.ai.model = 'mock-claude';
    config.ai.baseUrl = mock.url;
    const r = await assistant.ask(admin, 'Any open alerts?');
    expect(r.mode).toBe('llm');
    expect(r.sources[0].tool).toBe('getActiveAlerts');
    expect(mock.requests[0].path).toBe('/v1/messages');
    expect(mock.requests[0].body.tools[0]).toHaveProperty('input_schema');
    await mock.close();
    resetAi();
  });

  it('flags an answer that contains numbers but used no tool', async () => {
    const mock = await mockServer(() => ({ json: { choices: [{ message: { content: 'There were 500 kg of waste.' } }] } }));
    config.ai.provider = 'openai';
    config.ai.apiKey = 'k';
    config.ai.model = 'm';
    config.ai.baseUrl = `${mock.url}/v1`;
    const r = await assistant.ask(admin, 'How much waste was there?');
    expect(r.mode).toBe('llm');
    expect(r.warnings.join(' ')).toContain('without querying the database');
    await mock.close();
    resetAi();
  });

  it('when the provider is down the assistant degrades to a data-only answer with a warning', async () => {
    const mock = await mockServer(() => ({ status: 500, json: { error: { message: 'boom' } } }));
    config.ai.provider = 'openai';
    config.ai.apiKey = 'k';
    config.ai.model = 'm';
    config.ai.baseUrl = `${mock.url}/v1`;
    const r = await assistant.ask(admin, 'Show me delayed transports');
    expect(r.mode).toBe('offline');
    expect(r.warnings.join(' ')).toMatch(/language model is unavailable/);
    expect(r.sources[0].tool).toBe('getDelayedTransports');
    await mock.close();
    resetAi();
  });
});

// ------------------------------------------------------------------ HTTP layer
describe('AI HTTP API', () => {
  it('enforces roles, validates input and exposes status', async () => {
    resetAi();
    expect((await api().post('/api/ai/chat').send({ message: 'hi there' })).status).toBe(401);
    expect((await api().post('/api/ai/chat').set(bearer(a.collector)).send({ message: 'hello there' })).status).toBe(403);
    expect((await api().post('/api/ai/chat').set(bearer(a.admin)).send({ message: '' })).status).toBe(400);
    const ok = await api().post('/api/ai/chat').set(bearer(a.admin)).send({ message: 'Show me delayed transports' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.mode).toBe('offline');
    const st = await api().get('/api/ai/status').set(bearer(a.auditor));
    expect(st.body.data).toMatchObject({ mode: 'offline', llm: { configured: false }, hindsight: { configured: false } });
    expect(st.body.data.tools).toContain('getAuditHistory');
    expect((await api().get('/api/ai/memories').set(bearer(a.staff))).status).toBe(403);
    expect((await api().get('/api/ai/memories').set(bearer(a.admin))).status).toBe(200);
  });
});
