import { Request, Response } from 'express';
import * as v from '../validators/schemas';
import * as auth from '../services/authService';
import * as waste from '../services/wasteService';
import * as collections from '../services/collectionService';
import * as transport from '../services/transportService';
import * as disposals from '../services/disposalService';
import * as alerts from '../services/alertService';
import * as analytics from '../services/analyticsService';
import * as reference from '../services/referenceService';
import { pool } from '../db/pool';
import { redis } from '../db/redis';
import { created, ok } from '../utils/response';
import { forbidden } from '../utils/errors';
import { paginationSchema } from '../utils/pagination';

const me = (req: Request) => req.user!; // routes guarantee authenticate ran first
const id = (req: Request) => v.idParam.parse(req.params).id;

// ---------- auth ----------
export const login = async (req: Request, res: Response) => {
  const b = v.loginBody.parse(req.body);
  ok(res, await auth.login(b.email, b.password));
};
export const register = async (req: Request, res: Response) => {
  created(res, await auth.register(me(req), v.registerBody.parse(req.body)));
};
export const profile = async (req: Request, res: Response) => ok(res, me(req));

// ---------- waste ----------
export const wasteList = async (req: Request, res: Response) => {
  const { rows, meta } = await waste.list(me(req), v.wasteListQuery.parse(req.query));
  ok(res, rows, meta);
};
export const wasteGet = async (req: Request, res: Response) => ok(res, await waste.getDetail(me(req), id(req)));
export const wasteCreate = async (req: Request, res: Response) =>
  created(res, await waste.create(me(req), v.wasteCreateBody.parse(req.body)));
export const wasteUpdate = async (req: Request, res: Response) =>
  ok(res, await waste.update(me(req), id(req), v.wasteUpdateBody.parse(req.body)));
export const wasteDelete = async (req: Request, res: Response) => {
  await waste.remove(me(req), id(req));
  ok(res, { deleted: true });
};
export const wasteTransition = async (req: Request, res: Response) => {
  const b = v.transitionBody.parse(req.body);
  ok(res, await waste.transition(me(req), id(req), b.status, b.note));
};

// ---------- collections ----------
export const collectionList = async (req: Request, res: Response) => {
  const { rows, meta } = await collections.list(me(req), v.collectionListQuery.parse(req.query));
  ok(res, rows, meta);
};
export const collectionGet = async (req: Request, res: Response) => ok(res, await collections.get(me(req), id(req)));
export const collectionCreate = async (req: Request, res: Response) =>
  created(res, await collections.request(me(req), v.collectionCreateBody.parse(req.body)));
export const collectionPatch = async (req: Request, res: Response) => {
  const b = v.collectionPatchBody.parse(req.body);
  const user = me(req);
  if (b.collectorId) {
    if (!['ADMIN', 'HOSPITAL_STAFF'].includes(user.role)) throw forbidden('Only ADMIN or HOSPITAL_STAFF can assign collectors');
    return ok(res, await collections.assign(user, id(req), b.collectorId));
  }
  if (!['ADMIN', 'WASTE_COLLECTOR'].includes(user.role)) throw forbidden('Only the assigned collector or ADMIN can complete a collection');
  ok(res, await collections.complete(user, id(req), b.collectedQuantity));
};

// ---------- transport ----------
export const transportList = async (req: Request, res: Response) => {
  const { rows, meta } = await transport.list(me(req), v.transportListQuery.parse(req.query));
  ok(res, rows, meta);
};
export const transportGet = async (req: Request, res: Response) => ok(res, await transport.get(me(req), id(req)));
export const transportCreate = async (req: Request, res: Response) =>
  created(res, await transport.plan(me(req), v.transportCreateBody.parse(req.body)));
export const transportPatch = async (req: Request, res: Response) => {
  const b = v.transportPatchBody.parse(req.body);
  ok(res, b.status === 'IN_TRANSIT' ? await transport.depart(me(req), id(req)) : await transport.arrive(me(req), id(req), b.arrivedAt));
};

// ---------- disposals ----------
export const disposalList = async (req: Request, res: Response) => {
  const { rows, meta } = await disposals.list(me(req), paginationSchema.parse(req.query));
  ok(res, rows, meta);
};
export const disposalCreate = async (req: Request, res: Response) =>
  created(res, await disposals.record(me(req), v.disposalCreateBody.parse(req.body)));

// ---------- alerts ----------
export const alertList = async (req: Request, res: Response) => {
  const { rows, meta } = await alerts.listAlerts(me(req), v.alertListQuery.parse(req.query));
  ok(res, rows, meta);
};
export const alertCreate = async (req: Request, res: Response) => {
  await alerts.createManualAlert(me(req), v.alertCreateBody.parse(req.body));
  created(res, { created: true });
};
export const alertPatch = async (req: Request, res: Response) => {
  await alerts.updateAlertStatus(me(req), id(req), v.alertPatchBody.parse(req.body).status);
  ok(res, { updated: true });
};
export const alertScan = async (_req: Request, res: Response) => ok(res, await alerts.scan());
export const alertLastScan = async (_req: Request, res: Response) => ok(res, await alerts.lastScan());

// ---------- analytics / reference / audit ----------
export const dashboard = async (req: Request, res: Response) => {
  const { value, cacheHit } = await analytics.dashboard(me(req), v.dashboardQuery.parse(req.query));
  res.setHeader('X-Cache', cacheHit ? 'HIT' : 'MISS');
  ok(res, value, { cache: cacheHit ? 'HIT' : 'MISS' });
};
export const facilities = async (_req: Request, res: Response) => ok(res, await reference.facilities());
export const treatmentFacilities = async (_req: Request, res: Response) => ok(res, await reference.treatmentFacilities());
export const vehicles = async (_req: Request, res: Response) => ok(res, await reference.vehicles());
export const categories = async (_req: Request, res: Response) => ok(res, await reference.categories());
export const users = async (req: Request, res: Response) =>
  ok(res, await reference.users(me(req), v.usersQuery.parse(req.query).role));
export const auditLogs = async (req: Request, res: Response) => {
  const { rows, meta } = await reference.auditLogs(v.auditQuery.parse(req.query));
  ok(res, rows, meta);
};

// ---------- health ----------
export const health = async (_req: Request, res: Response) => {
  const dbOk = await pool.query('SELECT 1').then(() => true, () => false);
  const redisOk = redis.status === 'ready' && (await redis.ping().then((p) => p === 'PONG', () => false));
  // The API is "ok" if the database works; Redis is an optional accelerator (degraded, not down).
  const status = !dbOk ? 'down' : redisOk ? 'ok' : 'degraded';
  res.status(dbOk ? 200 : 503).json({ success: dbOk, data: { status, database: dbOk, redis: redisOk, time: new Date().toISOString() } });
};
