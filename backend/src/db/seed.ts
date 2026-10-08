/**
 * SYNTHETIC DEMO DATA. Every name, registration number and quantity below is invented.
 * Deterministic (seeded PRNG) so demos are repeatable. Never run against production.
 */
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Db, pool } from './pool';
import { scan } from '../services/alertService';

export const DEMO_PASSWORD = 'Demo@1234';
const H = 3_600_000;

export async function truncateAll(db: Db) {
  await db.query(`TRUNCATE notifications, alerts, disposal_records, transport_records, collection_records,
    waste_status_history, waste_records, vehicles, waste_categories, users, treatment_facilities, facilities
    RESTART IDENTITY CASCADE`);
  // audit_logs is append-only by trigger; TRUNCATE bypasses row triggers, which is what we want for a dev reset.
  await db.query('TRUNCATE audit_logs RESTART IDENTITY');
  await db.query('ALTER SEQUENCE waste_record_seq RESTART WITH 1');
}

export async function seedReference(db: Db) {
  const f = async (code: string, name: string, type: string, city: string) =>
    (
      await db.query(
        `INSERT INTO facilities (code, name, type, city, address) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [code, name, type, city, `${name}, ${city} (synthetic address)`],
      )
    ).rows[0].id as string;
  const fac = {
    dgh: await f('DGH', 'Demo General Hospital', 'HOSPITAL', 'Metropolis'),
    dcc: await f('DCC', 'Demo City Clinic', 'CLINIC', 'Metropolis'),
    dlm: await f('DLM', 'Demo Lakeside Medical Centre', 'HOSPITAL', 'Lakeside'),
    dpl: await f('DPL', 'Demo Pathology Lab', 'LABORATORY', 'Metropolis'),
    drh: await f('DRH', 'Demo Riverside Hospital', 'HOSPITAL', 'Riverside'),
  };

  const tf = async (code: string, name: string, methods: string[], cap: number) =>
    (
      await db.query(
        `INSERT INTO treatment_facilities (code, name, city, address, methods, capacity_kg_per_day)
         VALUES ($1,$2,'Outskirts',$3,$4::disposal_method[],$5) RETURNING id`,
        [code, name, `${name} (synthetic address)`, methods, cap],
      )
    ).rows[0].id as string;
  const treat = {
    incin: await tf('DIP', 'Demo Central Incineration Plant', ['INCINERATION'], 2000),
    eco: await tf('DEA', 'Demo Eco Autoclave Unit', ['AUTOCLAVE', 'MICROWAVE', 'SHREDDING', 'CHEMICAL_DISINFECTION'], 1500),
    burial: await tf('DBS', 'Demo Deep Burial Site', ['DEEP_BURIAL'], 500),
  };

  const cats: [string, string, string, string, string, number, number][] = [
    ['YELLOW', 'Yellow - Anatomical & Soiled', '#EAB308', 'Human anatomical waste, soiled dressings, expired medicines', 'INCINERATION', 48, 60],
    ['RED', 'Red - Contaminated Plastics', '#DC2626', 'Contaminated recyclable plastics (tubing, catheters, IV sets)', 'AUTOCLAVE', 48, 40],
    ['WHITE', 'White - Sharps', '#E5E7EB', 'Needles, syringes with fixed needles, scalpels, blades', 'AUTOCLAVE', 72, 25],
    ['BLUE', 'Blue - Glassware', '#2563EB', 'Broken or discarded glass, medicine vials and ampoules', 'CHEMICAL_DISINFECTION', 72, 35],
  ];
  const catIds: Record<string, number> = {};
  for (const [code, name, color, desc, method, hours, qty] of cats) {
    const r = await db.query(
      `INSERT INTO waste_categories (code, name, color, description, default_method, max_storage_hours, alert_quantity_kg)
       VALUES ($1,$2,$3,$4,$5::disposal_method,$6,$7) RETURNING id`,
      [code, name, color, `${desc} (colour scheme modelled on India BMW Rules 2016)`, method, hours, qty],
    );
    catIds[code] = r.rows[0].id;
  }

  const vehicleIds: string[] = [];
  const vehicles: [string, string, number, string][] = [
    ['DM-01-BMW-1001', 'Closed body van', 800, 'AVAILABLE'],
    ['DM-01-BMW-1002', 'Closed body van', 800, 'AVAILABLE'],
    ['DM-02-BMW-2001', 'Refrigerated van', 500, 'AVAILABLE'],
    ['DM-02-BMW-2002', 'Light truck', 1500, 'AVAILABLE'],
    ['DM-03-BMW-3001', 'Closed body van', 800, 'MAINTENANCE'],
  ];
  for (const [reg, type, cap, status] of vehicles) {
    vehicleIds.push(
      (await db.query(`INSERT INTO vehicles (registration, type, capacity_kg, status) VALUES ($1,$2,$3,$4) RETURNING id`, [reg, type, cap, status]))
        .rows[0].id,
    );
  }

  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const u = async (email: string, name: string, role: string, facilityId: string | null = null) =>
    (
      await db.query(
        `INSERT INTO users (email, name, password_hash, role, facility_id) VALUES ($1,$2,$3,$4::user_role,$5) RETURNING id`,
        [email, name, hash, role, facilityId],
      )
    ).rows[0].id as string;
  const users = {
    admin: await u('admin@bmw.demo', 'Asha Admin', 'ADMIN'),
    staffDgh: await u('staff.dgh@bmw.demo', 'Dev Hospital-Staff (DGH)', 'HOSPITAL_STAFF', fac.dgh),
    staffDcc: await u('staff.dcc@bmw.demo', 'Chitra Clinic-Staff (DCC)', 'HOSPITAL_STAFF', fac.dcc),
    staffDlm: await u('staff.dlm@bmw.demo', 'Lakshmi Lakeside-Staff (DLM)', 'HOSPITAL_STAFF', fac.dlm),
    staffDpl: await u('staff.dpl@bmw.demo', 'Pranav Lab-Staff (DPL)', 'HOSPITAL_STAFF', fac.dpl),
    staffDrh: await u('staff.drh@bmw.demo', 'Rohan Riverside-Staff (DRH)', 'HOSPITAL_STAFF', fac.drh),
    collector1: await u('collector1@bmw.demo', 'Karthik Collector', 'WASTE_COLLECTOR'),
    collector2: await u('collector2@bmw.demo', 'Kavya Collector', 'WASTE_COLLECTOR'),
    transporter1: await u('transporter1@bmw.demo', 'Tarun Transporter', 'TRANSPORTER'),
    transporter2: await u('transporter2@bmw.demo', 'Tanvi Transporter', 'TRANSPORTER'),
    operator: await u('operator@bmw.demo', 'Omkar Operator', 'TREATMENT_OPERATOR'),
    auditor: await u('auditor@bmw.demo', 'Anita Auditor', 'AUDITOR'),
  };
  return { fac, treat, catIds, vehicleIds, users };
}

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Ref = Awaited<ReturnType<typeof seedReference>>;

export async function seedDemo(db: Db, ref: Ref, count = 260) {
  const rand = rng(20260401);
  const between = (a: number, b: number) => a + rand() * (b - a);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();

  const facilities = [
    { id: ref.fac.dgh, staff: ref.users.staffDgh, weight: 34, delayRate: 0.08 },
    { id: ref.fac.dcc, staff: ref.users.staffDcc, weight: 10, delayRate: 0.06 },
    { id: ref.fac.dlm, staff: ref.users.staffDlm, weight: 22, delayRate: 0.1 },
    { id: ref.fac.dpl, staff: ref.users.staffDpl, weight: 8, delayRate: 0.05 },
    // deliberate scenario: Riverside has repeated transport delays
    { id: ref.fac.drh, staff: ref.users.staffDrh, weight: 26, delayRate: 0.45 },
  ];
  const totalW = facilities.reduce((s, f) => s + f.weight, 0);
  const pickFacility = () => {
    let r = rand() * totalW;
    for (const f of facilities) if ((r -= f.weight) <= 0) return f;
    return facilities[0];
  };
  const catCodes = ['YELLOW', 'YELLOW', 'RED', 'RED', 'WHITE', 'BLUE'];
  const qtyRange: Record<string, [number, number]> = { YELLOW: [3, 38], RED: [2, 24], WHITE: [1, 12], BLUE: [2, 20] };
  const alertQty: Record<string, number> = { YELLOW: 60, RED: 40, WHITE: 25, BLUE: 35 };
  const destFor = (cat: string) => (cat === 'YELLOW' ? ref.treat.incin : ref.treat.eco);
  const methodFor = (cat: string) =>
    cat === 'YELLOW' ? 'INCINERATION' : cat === 'BLUE' ? 'CHEMICAL_DISINFECTION' : pick(['AUTOCLAVE', 'AUTOCLAVE', 'SHREDDING']);
  const collectors = [ref.users.collector1, ref.users.collector2];
  const transporters = [ref.users.transporter1, ref.users.transporter2];
  const usableVehicles = ref.vehicleIds.slice(0, 4);

  const audit = (userId: string | null, action: string, entity: string, entityId: string, at: number, meta: object = {}) =>
    db.query('INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
      userId,
      action,
      entity,
      entityId,
      JSON.stringify({ demo: true, ...meta }),
      new Date(at),
    ]);

  for (let i = 0; i < count; i++) {
    const fac = pickFacility();
    const cat = pick(catCodes);
    let [lo, hi] = qtyRange[cat];
    // deliberate scenario: high waste generation at Demo General Hospital in the last 10 days
    const bigSpike = fac.id === ref.fac.dgh && i % 23 === 0;
    if (bigSpike) [lo, hi] = [alertQty[cat] * 1.2, alertQty[cat] * 2.4];
    const quantity = Math.round(between(lo, hi) * 10) / 10;

    // spread over 45 days, with extra density in the last 4 days so "in progress" states exist
    const ageDays = bigSpike ? between(0.2, 9) : rand() < 0.2 ? between(0.1, 4) : between(0.1, 45);
    const g = now - ageDays * 24 * H;

    const reqAt = g + between(0.5, 3) * H;
    const assignAt = reqAt + between(0.2, 1) * H;
    const lateCollection = rand() < 0.08;
    const collAt = reqAt + (lateCollection ? between(26, 40) : between(2, 10)) * H;
    const planAt = collAt + 0.3 * H;
    const departAt = collAt + between(1, 5) * H;
    const expected = departAt + between(2, 4) * H;
    const delayed = rand() < fac.delayRate;
    const arrAt = delayed ? expected + between(0.5, 6) * H : expected - between(0, 0.5) * H;
    const tpAt = arrAt + between(0.5, 2) * H;
    const treatedAt = tpAt + between(2, 10) * H;
    const disposedAt = treatedAt + between(0.5, 3) * H;
    const closedAt = disposedAt + between(1, 24) * H;

    // limits: never requested / rejected / stuck without disposal
    const neverRequested = rand() < 0.04;
    const rejected = !neverRequested && rand() < 0.03;
    const stuckAtArrival = !neverRequested && !rejected && rand() < 0.05;

    type Ev = { status: string; at: number };
    const events: Ev[] = [{ status: 'SEGREGATED', at: g }];
    if (!neverRequested) {
      events.push({ status: 'COLLECTION_PENDING', at: reqAt });
      if (rejected) events.push({ status: 'REJECTED', at: reqAt + between(1, 6) * H });
      else {
        events.push({ status: 'COLLECTED', at: collAt }, { status: 'IN_TRANSIT', at: departAt }, { status: 'ARRIVED', at: arrAt });
        if (!stuckAtArrival)
          events.push(
            { status: 'TREATMENT_PENDING', at: tpAt },
            { status: 'TREATED', at: treatedAt },
            { status: 'DISPOSED', at: disposedAt },
            { status: 'CLOSED', at: closedAt },
          );
      }
    }
    const reached = events.filter((e) => e.at <= now);
    const last = reached[reached.length - 1];
    const wasteId = crypto.randomUUID();
    const terminal = ['CLOSED', 'REJECTED'].includes(last.status);

    await db.query(
      `INSERT INTO waste_records (id, category_id, facility_id, quantity, unit, status, generated_at, notes, is_demo,
                                  created_by, created_at, updated_at, closed_at)
       VALUES ($1,$2,$3,$4,'kg',$5::waste_status,$6,$7,TRUE,$8,$6,$9,$10)`,
      [
        wasteId,
        ref.catIds[cat],
        fac.id,
        quantity,
        last.status,
        new Date(g),
        '[DEMO] synthetic record',
        fac.staff,
        new Date(last.at),
        terminal ? new Date(last.at) : null,
      ],
    );
    let prev: string | null = null;
    for (const e of reached) {
      await db.query(
        'INSERT INTO waste_status_history (waste_id, from_status, to_status, changed_by, note, changed_at) VALUES ($1,$2,$3,$4,$5,$6)',
        [wasteId, prev, e.status, fac.staff, 'demo', new Date(e.at)],
      );
      await audit(fac.staff, e.status === 'SEGREGATED' ? 'WASTE_CREATED' : 'WASTE_STATUS_CHANGED', 'waste_record', wasteId, e.at, {
        to: e.status,
        from: prev,
      });
      prev = e.status;
    }

    const has = (s: string) => reached.some((e) => e.status === s);
    const collectorId = pick(collectors);
    let collectionId: string | null = null;
    if (has('COLLECTION_PENDING')) {
      const status = has('COLLECTED') ? 'COMPLETED' : assignAt <= now ? 'ASSIGNED' : 'PENDING';
      const rejectedNow = has('REJECTED');
      collectionId = (
        await db.query(
          `INSERT INTO collection_records (waste_id, requested_by, collector_id, status, requested_at, scheduled_for, collected_at, collected_quantity)
           VALUES ($1,$2,$3,$4::collection_status,$5,$6,$7,$8) RETURNING id`,
          [
            wasteId,
            fac.staff,
            status === 'PENDING' ? null : collectorId,
            rejectedNow ? 'CANCELLED' : status,
            new Date(reqAt),
            new Date(reqAt + 24 * H),
            status === 'COMPLETED' ? new Date(collAt) : null,
            status === 'COMPLETED' ? quantity : null,
          ],
        )
      ).rows[0].id;
      await audit(fac.staff, 'COLLECTION_REQUESTED', 'collection', collectionId!, reqAt);
      if (status !== 'PENDING') await audit(fac.staff, 'COLLECTION_ASSIGNED', 'collection', collectionId!, assignAt, { collectorId });
      if (status === 'COMPLETED') await audit(collectorId, 'COLLECTION_COMPLETED', 'collection', collectionId!, collAt);
    }

    if (has('COLLECTED') && planAt <= now) {
      const vehicleId = pick(usableVehicles);
      const transporterId = pick(transporters);
      const status = has('ARRIVED') ? 'ARRIVED' : has('IN_TRANSIT') ? 'IN_TRANSIT' : 'PLANNED';
      const isDelayed = has('ARRIVED') && arrAt > expected;
      const tid = (
        await db.query(
          `INSERT INTO transport_records (waste_id, vehicle_id, transporter_id, origin_facility_id, destination_id, status,
                                          departed_at, expected_arrival_at, actual_arrival_at, is_delayed, created_at)
           VALUES ($1,$2,$3,$4,$5,$6::transport_status,$7,$8,$9,$10,$11) RETURNING id`,
          [
            wasteId,
            vehicleId,
            transporterId,
            fac.id,
            destFor(cat),
            status,
            status === 'PLANNED' ? null : new Date(departAt),
            new Date(expected),
            status === 'ARRIVED' ? new Date(arrAt) : null,
            isDelayed,
            new Date(planAt),
          ],
        )
      ).rows[0].id as string;
      await audit(transporterId, 'VEHICLE_ASSIGNED', 'transport', tid, planAt, { vehicleId });
      if (status !== 'PLANNED') await audit(transporterId, 'TRANSPORT_STARTED', 'transport', tid, departAt);
      if (status === 'ARRIVED') await audit(transporterId, 'TRANSPORT_COMPLETED', 'transport', tid, arrAt, { delayed: isDelayed });
      if (isDelayed) {
        const mins = Math.round((arrAt - expected) / 60000);
        const old = now - arrAt > 3 * 24 * H;
        await db.query(
          `INSERT INTO alerts (type, severity, status, message, waste_id, facility_id, created_at, resolved_at, resolved_by)
           VALUES ('DELAYED_TRANSPORT', $1::alert_severity, $2::alert_status, $3, $4, $5, $6, $7, $8)`,
          [
            mins > 240 ? 'CRITICAL' : mins > 60 ? 'HIGH' : 'MEDIUM',
            old ? 'RESOLVED' : 'OPEN',
            `[DEMO] Transport arrived ${mins} min after the expected time`,
            wasteId,
            fac.id,
            new Date(arrAt),
            old ? new Date(arrAt + 20 * H) : null,
            old ? ref.users.admin : null,
          ],
        );
      }
    }

    if (has('DISPOSED')) {
      const method = methodFor(cat);
      const did = (
        await db.query(
          `INSERT INTO disposal_records (waste_id, treatment_facility_id, operator_id, method, treated_at, disposed_at, certificate_no)
           VALUES ($1,$2,$3,$4::disposal_method,$5,$6,$7) RETURNING id`,
          [wasteId, destFor(cat), ref.users.operator, method, new Date(treatedAt), new Date(disposedAt), `DEMO-CERT-${String(i).padStart(5, '0')}`],
        )
      ).rows[0].id;
      await audit(ref.users.operator, 'DISPOSAL_RECORDED', 'disposal', did, disposedAt, { method });
    }

    if (quantity > alertQty[cat]) {
      const old = now - g > 7 * 24 * H;
      await db.query(
        `INSERT INTO alerts (type, severity, status, message, waste_id, facility_id, created_at, resolved_at, resolved_by)
         VALUES ('EXCESSIVE_QUANTITY', $1::alert_severity, $2::alert_status, $3, $4, $5, $6, $7, $8)`,
        [
          quantity > alertQty[cat] * 2 ? 'HIGH' : 'MEDIUM',
          old ? 'RESOLVED' : 'OPEN',
          `[DEMO] ${quantity} kg recorded, above the ${alertQty[cat]} kg threshold`,
          wasteId,
          fac.id,
          new Date(g),
          old ? new Date(g + 6 * H) : null,
          old ? ref.users.admin : null,
        ],
      );
    }
  }

  // vehicles currently on a job are IN_USE
  await db.query(
    `UPDATE vehicles SET status = 'IN_USE'
     WHERE status = 'AVAILABLE' AND id IN (SELECT vehicle_id FROM transport_records WHERE status IN ('PLANNED','IN_TRANSIT'))`,
  );

  // manual alerts: repeated segregation problems at the clinic, vehicle in maintenance
  for (let k = 0; k < 4; k++) {
    await db.query(
      `INSERT INTO alerts (type, severity, status, message, facility_id, created_at)
       VALUES ('SEGREGATION_PROBLEM', $1::alert_severity, $2::alert_status, $3, $4, now() - ($5 || ' days')::interval)`,
      [k > 1 ? 'MEDIUM' : 'LOW', k === 0 ? 'OPEN' : 'ACKNOWLEDGED', '[DEMO] Sharps found in the red bag stream during pickup', ref.fac.dcc, String(k * 6 + 1)],
    );
  }
  await db.query(
    `INSERT INTO alerts (type, severity, message, created_at) VALUES ('VEHICLE_ISSUE','MEDIUM','[DEMO] DM-03-BMW-3001 withdrawn for refrigeration repair', now() - interval '2 days')`,
  );
  await db.query(`INSERT INTO notifications (user_id, title, body) VALUES ($1,'Demo data loaded','All records in this system are synthetic.')`, [
    ref.users.admin,
  ]);
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  await truncateAll(pool);
  const ref = await seedReference(pool);
  await seedDemo(pool, ref);
  // deliberate scenarios: two overdue collections and two in-transit trucks past their expected arrival
  await pool.query(
    `UPDATE collection_records SET scheduled_for = now() - interval '30 hours'
     WHERE id IN (SELECT id FROM collection_records WHERE status = 'ASSIGNED' ORDER BY requested_at DESC LIMIT 2)`,
  );
  await pool.query(
    `UPDATE transport_records SET expected_arrival_at = now() - interval '90 minutes'
     WHERE id IN (SELECT id FROM transport_records WHERE status = 'IN_TRANSIT' ORDER BY departed_at DESC LIMIT 2)`,
  );
  // generate time-based alerts (overdue collections, missing disposals, ...) from the data just created
  const res = await scan();
  console.log('Seed complete. Scan created:', res.created);
  const { rows } = await pool.query(
    `SELECT (SELECT count(*) FROM waste_records) AS waste, (SELECT count(*) FROM alerts) AS alerts, (SELECT count(*) FROM audit_logs) AS audit`,
  );
  console.log(rows[0]);
  console.log(`Demo login: admin@bmw.demo / ${DEMO_PASSWORD}`);
  await pool.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
