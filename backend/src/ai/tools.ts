import { z } from 'zod';
import { pool } from '../db/pool';
import { AuthUser } from '../types';
import * as analytics from '../services/analyticsService';
import * as alertService from '../services/alertService';
import * as transportService from '../services/transportService';
import * as wasteService from '../services/wasteService';
import * as reference from '../services/referenceService';
import { WASTE_STATUSES } from '../services/lifecycle';
import { PERIODS, periodSchema, resolvePeriod } from './period';
import { ToolSpec } from './llm';

/**
 * CONTROLLED TOOLS. The LLM (or the offline router) can only call these functions with validated arguments.
 *  - No tool accepts SQL or table names. All queries are parameterised and live in existing services/repositories.
 *  - Every tool runs as the CURRENT USER, so row-level scoping and role checks still apply
 *    (e.g. hospital staff only ever see their own facility; audit history is ADMIN/AUDITOR only).
 *  - Result sizes are capped.
 */
export interface ToolResult {
  summary: string; // one line shown to the user under "sources"
  data: unknown; // compact JSON handed to the LLM / shown in the UI
  rowCount?: number;
}
interface ToolDef<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  jsonSchema: Record<string, unknown>;
  run: (user: AuthUser, args: z.infer<S>) => Promise<ToolResult>;
}

const period = { type: 'string', enum: PERIODS, description: 'Named time window. Omit for all time.' };
const facility = { type: 'string', description: 'Facility name or code, e.g. "Riverside" or "DRH". Omit for all facilities.' };
const category = { type: 'string', enum: ['YELLOW', 'RED', 'WHITE', 'BLUE'], description: 'Waste colour category.' };
const limit = { type: 'integer', minimum: 1, maximum: 20, description: 'Max rows to return (default 10).' };

const common = {
  period: periodSchema.optional(),
  facility: z.string().max(80).optional(),
  category: z.enum(['YELLOW', 'RED', 'WHITE', 'BLUE']).optional(),
  limit: z.number().int().min(1).max(20).default(10),
};

async function resolveFacility(name?: string): Promise<{ id?: string; error?: string }> {
  if (!name) return {};
  const r = await pool.query(`SELECT id, name FROM facilities WHERE name ILIKE $1 OR code ILIKE $2`, [`%${name}%`, name]);
  if (r.rowCount === 1) return { id: r.rows[0].id };
  const all = (await pool.query('SELECT name FROM facilities ORDER BY name')).rows.map((x) => x.name).join(', ');
  return { error: r.rowCount ? `"${name}" is ambiguous (${r.rows.map((x) => x.name).join(', ')})` : `Unknown facility "${name}". Known facilities: ${all}` };
}
async function resolveCategory(code?: string): Promise<number | undefined> {
  if (!code) return undefined;
  return (await pool.query('SELECT id FROM waste_categories WHERE code = $1', [code])).rows[0]?.id;
}

class ToolError extends Error {}
async function facilityIdOrThrow(name?: string) {
  const f = await resolveFacility(name);
  if (f.error) throw new ToolError(f.error);
  return f.id;
}

const trim = <T extends Record<string, unknown>>(rows: T[], n: number) => rows.slice(0, n);

const wasteStatistics: ToolDef<z.ZodObject<typeof common & { status: z.ZodOptional<z.ZodEnum<[string, ...string[]]>> }>> = {
  name: 'getWasteStatistics',
  description:
    'Aggregate waste statistics from the database: total records and kg, breakdown by status, category, facility, disposal method, daily series. Use for "how much", "which facility generated the most", "compare periods".',
  schema: z.object({ ...common, status: z.enum(WASTE_STATUSES).optional() }),
  jsonSchema: { type: 'object', properties: { period, facility, category, status: { type: 'string', enum: WASTE_STATUSES } } },
  async run(user, a) {
    const range = resolvePeriod(a.period);
    const d = await analytics.dashboard(user, {
      from: range.from,
      to: range.to,
      facilityId: await facilityIdOrThrow(a.facility),
      categoryId: await resolveCategory(a.category),
      status: a.status,
    });
    const v = d.value;
    return {
      summary: `Waste statistics for ${range.label}${a.facility ? `, ${a.facility}` : ''}${a.category ? `, ${a.category}` : ''}: ${v.totals.records} records, ${v.totals.quantityKg} kg`,
      rowCount: v.totals.records,
      data: {
        period: range.label,
        totals: v.totals,
        byStatus: v.byStatus,
        byCategory: v.byCategory.map(({ code, name, records, quantityKg }) => ({ code, name, records, quantityKg })),
        byFacility: v.byFacility.map(({ name, records, quantityKg, disposed, delayedTransports }) => ({ name, records, quantityKg, disposed, delayedTransports })),
        disposalMethods: v.disposalMethods,
      },
    };
  },
};

const wasteRecords: ToolDef<z.ZodObject<typeof common & { status: z.ZodOptional<z.ZodEnum<[string, ...string[]]>>; pendingDisposal: z.ZodOptional<z.ZodBoolean> }>> = {
  name: 'getWasteRecords',
  description:
    'List individual waste records (record code, status, category, facility, quantity). Set pendingDisposal=true for records that arrived at treatment but are not yet disposed.',
  schema: z.object({ ...common, status: z.enum(WASTE_STATUSES).optional(), pendingDisposal: z.boolean().optional() }),
  jsonSchema: {
    type: 'object',
    properties: { period, facility, category, limit, status: { type: 'string', enum: WASTE_STATUSES }, pendingDisposal: { type: 'boolean' } },
  },
  async run(user, a) {
    const range = resolvePeriod(a.period);
    const facilityId = await facilityIdOrThrow(a.facility);
    const categoryId = await resolveCategory(a.category);
    const statuses = a.pendingDisposal ? ['ARRIVED', 'TREATMENT_PENDING', 'TREATED'] : [a.status];
    let rows: Record<string, unknown>[] = [];
    let total = 0;
    for (const s of statuses) {
      const r = await wasteService.list(user, {
        status: s as never, categoryId, facilityId, from: range.from, to: range.to, sortBy: 'generatedAt', sortDir: 'desc', page: 1, pageSize: a.limit,
      });
      rows = rows.concat(r.rows as Record<string, unknown>[]);
      total += r.meta.total;
    }
    const out = trim(rows, a.limit).map((w) => ({
      recordCode: w.recordCode, status: w.status, category: w.categoryCode, facility: w.facilityName, quantity: `${w.quantity} ${w.unit}`, generatedAt: w.generatedAt,
    }));
    return { summary: `${total} matching waste records (showing ${out.length})`, rowCount: total, data: { total, showing: out.length, records: out } };
  },
};

const facilityStatistics: ToolDef<z.ZodObject<{ period: z.ZodOptional<typeof periodSchema> }>> = {
  name: 'getFacilityStatistics',
  description:
    'Per-facility comparison: waste volume, disposed count, delayed transport count and percentage, average collection and transport hours, open alerts. Use to find the best/worst facility.',
  schema: z.object({ period: periodSchema.optional() }),
  jsonSchema: { type: 'object', properties: { period } },
  async run(user, a) {
    const range = resolvePeriod(a.period);
    const [dash, ops] = await Promise.all([
      analytics.dashboard(user, { from: range.from, to: range.to }),
      analytics.operational(user, { from: range.from, to: range.to }),
    ]);
    const alertRows = (
      await pool.query(`SELECT facility_id, count(*)::int AS open FROM alerts WHERE status <> 'RESOLVED' AND facility_id IS NOT NULL GROUP BY 1`)
    ).rows;
    const openById = new Map(alertRows.map((r) => [r.facility_id, r.open]));
    const opsById = new Map(ops.value.byFacility.map((f) => [f.id, f]));
    const facilities = dash.value.byFacility.map((f) => {
      const o = opsById.get(f.id);
      return {
        name: f.name, records: f.records, quantityKg: f.quantityKg, disposed: f.disposed,
        arrivedTransports: o?.arrivedTransports ?? 0, delayedTransports: o?.delayedTransports ?? 0, delayedPct: o?.delayedPct ?? null,
        avgCollectionHours: o?.avgCollectionHours ?? null, avgTransportHours: o?.avgTransportHours ?? null, openAlerts: openById.get(f.id) ?? 0,
      };
    });
    return { summary: `Statistics for ${facilities.length} facilities over ${range.label}`, rowCount: facilities.length, data: { period: range.label, facilities } };
  },
};

const delayedTransports: ToolDef<z.ZodObject<{ period: z.ZodOptional<typeof periodSchema>; facility: z.ZodOptional<z.ZodString>; limit: z.ZodDefault<z.ZodNumber> }>> = {
  name: 'getDelayedTransports',
  description: 'Transports that arrived late or are currently in transit past their expected arrival time, with a count per origin facility.',
  schema: z.object({ period: periodSchema.optional(), facility: common.facility, limit: common.limit }),
  jsonSchema: { type: 'object', properties: { period, facility, limit } },
  async run(user, a) {
    const range = resolvePeriod(a.period);
    const fac = a.facility ? await facilityIdOrThrow(a.facility) : undefined;
    const facName = fac ? (await pool.query('SELECT name FROM facilities WHERE id=$1', [fac])).rows[0]?.name : undefined;
    const r = await transportService.list(user, { delayed: true, page: 1, pageSize: 100 });
    const from = range.from ? new Date(range.from).getTime() : 0;
    const to = range.to ? new Date(range.to).getTime() : Infinity;
    let rows = (r.rows as Record<string, unknown>[]).filter((t) => {
      const when = new Date((t.actualArrivalAt ?? t.expectedArrivalAt) as string).getTime();
      return when >= from && when <= to && (!facName || t.origin === facName);
    });
    const byOrigin: Record<string, number> = {};
    for (const t of rows) byOrigin[t.origin as string] = (byOrigin[t.origin as string] ?? 0) + 1;
    rows = rows.slice(0, a.limit);
    return {
      summary: `${Object.values(byOrigin).reduce((s, n) => s + n, 0)} delayed transports in ${range.label}`,
      rowCount: Object.values(byOrigin).reduce((s, n) => s + n, 0),
      data: {
        period: range.label,
        countByOrigin: byOrigin,
        transports: rows.map((t) => ({
          recordCode: t.recordCode, origin: t.origin, destination: t.destination, vehicle: t.vehicle, status: t.status,
          expectedArrivalAt: t.expectedArrivalAt, actualArrivalAt: t.actualArrivalAt,
        })),
      },
    };
  },
};

const activeAlerts: ToolDef<z.ZodObject<{ severity: z.ZodOptional<z.ZodEnum<['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']>>; type: z.ZodOptional<z.ZodString>; facility: z.ZodOptional<z.ZodString>; includeResolved: z.ZodOptional<z.ZodBoolean>; limit: z.ZodDefault<z.ZodNumber> }>> = {
  name: 'getActiveAlerts',
  description: 'Open compliance/operational alerts with severity, type, message and facility; includes counts by type and by facility.',
  schema: z.object({ severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(), type: z.string().max(40).optional(), facility: common.facility, includeResolved: z.boolean().optional(), limit: common.limit }),
  jsonSchema: {
    type: 'object',
    properties: { severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] }, type: { type: 'string', description: 'e.g. DELAYED_TRANSPORT, MISSING_DISPOSAL' }, facility, includeResolved: { type: 'boolean' }, limit },
  },
  async run(user, a) {
    const fac = await facilityIdOrThrow(a.facility);
    const r = await alertService.listAlerts(user, { status: a.includeResolved ? undefined : 'OPEN', severity: a.severity, type: a.type, facilityId: fac, page: 1, pageSize: 100 });
    const rows = r.rows as Record<string, unknown>[];
    const count = (key: string) => rows.reduce<Record<string, number>>((m, x) => ((m[String(x[key] ?? 'unknown')] = (m[String(x[key] ?? 'unknown')] ?? 0) + 1), m), {});
    return {
      summary: `${r.meta.total} ${a.includeResolved ? '' : 'open '}alerts`,
      rowCount: r.meta.total,
      data: {
        total: r.meta.total,
        countByType: count('type'),
        countBySeverity: count('severity'),
        countByFacility: count('facilityName'),
        alerts: rows.slice(0, a.limit).map((x) => ({ type: x.type, severity: x.severity, status: x.status, message: x.message, facility: x.facilityName, recordCode: x.recordCode, raisedAt: x.createdAt })),
      },
    };
  },
};

const wasteLifecycle: ToolDef<z.ZodObject<{ recordCode: z.ZodString }>> = {
  name: 'getWasteLifecycle',
  description: 'Full lifecycle of one waste record by its record code (e.g. BMW-2026-000123): status timeline, collection, transport, disposal.',
  schema: z.object({ recordCode: z.string().regex(/^BMW-\d{4}-\d{6}$/, 'recordCode must look like BMW-2026-000123') }),
  jsonSchema: { type: 'object', properties: { recordCode: { type: 'string', description: 'e.g. BMW-2026-000123' } }, required: ['recordCode'] },
  async run(user, a) {
    const found = await wasteService.list(user, { search: a.recordCode, sortBy: 'generatedAt', sortDir: 'desc', page: 1, pageSize: 1 });
    if (!found.rows.length) throw new ToolError(`No record ${a.recordCode} found (or you do not have access to it)`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = (await wasteService.getDetail(user, (found.rows[0] as { id: string }).id)) as any;
    return {
      summary: `Lifecycle of ${d.recordCode}: currently ${d.status}`,
      rowCount: 1,
      data: {
        recordCode: d.recordCode, status: d.status, category: d.categoryName, facility: d.facilityName, quantity: `${d.quantity} ${d.unit}`, generatedAt: d.generatedAt,
        timeline: d.history.map((h: { toStatus: string; changedAt: string; changedByName: string | null }) => ({ status: h.toStatus, at: h.changedAt, by: h.changedByName })),
        collections: d.collections, transports: d.transports, disposals: d.disposals,
      },
    };
  },
};

const auditHistory: ToolDef<z.ZodObject<{ recordCode: z.ZodOptional<z.ZodString>; action: z.ZodOptional<z.ZodString>; entity: z.ZodOptional<z.ZodString>; limit: z.ZodDefault<z.ZodNumber> }>> = {
  name: 'getAuditHistory',
  description: 'Recent audit-log entries (who did what), optionally for one waste record. Restricted to ADMIN and AUDITOR users.',
  schema: z.object({ recordCode: z.string().max(30).optional(), action: z.string().max(60).optional(), entity: z.string().max(40).optional(), limit: common.limit }),
  jsonSchema: { type: 'object', properties: { recordCode: { type: 'string' }, action: { type: 'string', description: 'e.g. WASTE_STATUS_CHANGED' }, entity: { type: 'string' }, limit } },
  async run(user, a) {
    if (!['ADMIN', 'AUDITOR'].includes(user.role)) throw new ToolError('Audit history is only available to ADMIN and AUDITOR users');
    let entityId: string | undefined;
    if (a.recordCode) {
      const found = await wasteService.list(user, { search: a.recordCode, sortBy: 'generatedAt', sortDir: 'desc', page: 1, pageSize: 1 });
      if (!found.rows.length) throw new ToolError(`No record ${a.recordCode} found`);
      entityId = (found.rows[0] as { id: string }).id;
    }
    const r = await reference.auditLogs({ entity: entityId ? 'waste_record' : a.entity, entityId, action: a.action, page: 1, pageSize: a.limit });
    return {
      summary: `${r.meta.total} audit entries match (showing ${r.rows.length})`,
      rowCount: r.meta.total,
      data: { total: r.meta.total, entries: r.rows.map((x: Record<string, unknown>) => ({ at: x.createdAt, user: x.userName ?? 'System', action: x.action, entity: x.entity, details: JSON.stringify(x.metadata).slice(0, 160) })) },
    };
  },
};

const disposalStatistics: ToolDef<z.ZodObject<{ period: z.ZodOptional<typeof periodSchema>; facility: z.ZodOptional<z.ZodString> }>> = {
  name: 'getDisposalStatistics',
  description: 'Disposal methods used, number disposed, waste still awaiting disposal, and average arrival-to-disposal turnaround hours.',
  schema: z.object({ period: periodSchema.optional(), facility: common.facility }),
  jsonSchema: { type: 'object', properties: { period, facility } },
  async run(user, a) {
    const range = resolvePeriod(a.period);
    const facilityId = await facilityIdOrThrow(a.facility);
    const [d, o] = await Promise.all([
      analytics.dashboard(user, { from: range.from, to: range.to, facilityId }),
      analytics.operational(user, { from: range.from, to: range.to, facilityId }),
    ]);
    return {
      summary: `${d.value.totals.disposed} disposed, ${d.value.totals.awaitingDisposal} awaiting disposal in ${range.label}`,
      rowCount: d.value.totals.disposed,
      data: { period: range.label, disposed: d.value.totals.disposed, awaitingDisposal: d.value.totals.awaitingDisposal, methods: d.value.disposalMethods, avgDisposalTurnaroundHours: o.value.avgDisposalTurnaroundHours, disposalsSampled: o.value.sample.disposals },
    };
  },
};

const operationalMetrics: ToolDef<z.ZodObject<{ period: z.ZodOptional<typeof periodSchema>; facility: z.ZodOptional<z.ZodString> }>> = {
  name: 'getOperationalMetrics',
  description:
    'Average collection time, transport time, disposal turnaround, total lifecycle duration (hours), delayed-transport percentage and collection completion percentage, with sample sizes.',
  schema: z.object({ period: periodSchema.optional(), facility: common.facility }),
  jsonSchema: { type: 'object', properties: { period, facility } },
  async run(user, a) {
    const range = resolvePeriod(a.period);
    const o = await analytics.operational(user, { from: range.from, to: range.to, facilityId: await facilityIdOrThrow(a.facility) });
    const { byFacility, ...rest } = o.value;
    return { summary: `Operational metrics for ${range.label}`, data: { period: range.label, ...rest, byFacility: byFacility.map(({ id: _id, ...f }) => f) } };
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ToolDef<any>[] = [wasteStatistics, wasteRecords, facilityStatistics, delayedTransports, activeAlerts, wasteLifecycle, auditHistory, disposalStatistics, operationalMetrics];

export const TOOL_SPECS: ToolSpec[] = TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.jsonSchema }));

export interface ExecutedTool {
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  summary: string;
  data: unknown;
}

/** Validates arguments with zod and runs the tool as `user`. Never throws: errors become tool results the LLM can read. */
export async function executeTool(user: AuthUser, name: string, rawArgs: Record<string, unknown>): Promise<ExecutedTool> {
  const def = TOOLS.find((t) => t.name === name);
  if (!def) return { tool: name, args: rawArgs, ok: false, summary: `Unknown tool "${name}"`, data: { error: `Unknown tool "${name}". Available: ${TOOLS.map((t) => t.name).join(', ')}` } };
  const parsed = def.schema.safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i: z.ZodIssue) => `${i.path.join('.') || 'args'}: ${i.message}`).join('; ');
    return { tool: name, args: rawArgs, ok: false, summary: `Invalid arguments: ${msg}`, data: { error: `Invalid arguments: ${msg}` } };
  }
  try {
    const r = await def.run(user, parsed.data);
    // round-trip through JSON so dates/numerics are plain values everywhere (LLM, UI, formatters)
    return { tool: name, args: parsed.data, ok: true, summary: r.summary, data: JSON.parse(JSON.stringify(r.data)) };
  } catch (e) {
    const msg = e instanceof ToolError ? e.message : 'The data could not be retrieved';
    return { tool: name, args: parsed.data, ok: false, summary: msg, data: { error: msg } };
  }
}
