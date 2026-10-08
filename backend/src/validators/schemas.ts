import { z } from 'zod';
import { ROLES } from '../types';
import { WASTE_STATUSES } from '../services/lifecycle';
import { paginationSchema } from '../utils/pagination';

const uuid = z.string().uuid();
const isoDate = z.string().datetime({ offset: true });
const optionalIso = isoDate.optional();

export const idParam = z.object({ id: uuid });

// ---- auth ----
export const loginBody = z.object({ email: z.string().email().max(255), password: z.string().min(1).max(200) });
export const registerBody = z.object({
  email: z.string().email().max(255),
  name: z.string().trim().min(2).max(120),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(200)
    .regex(/[A-Za-z]/, 'Password must contain a letter')
    .regex(/\d/, 'Password must contain a digit'),
  role: z.enum(ROLES),
  facilityId: uuid.optional(),
});

// ---- waste ----
export const wasteCreateBody = z.object({
  categoryId: z.number().int().positive(),
  facilityId: uuid.optional(),
  quantity: z.number().positive().max(100000),
  unit: z.enum(['kg', 'g', 'l']).default('kg'),
  generatedAt: optionalIso,
  notes: z.string().max(1000).optional(),
});
export const wasteUpdateBody = z
  .object({
    categoryId: z.number().int().positive().optional(),
    quantity: z.number().positive().max(100000).optional(),
    unit: z.enum(['kg', 'g', 'l']).optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update' });
export const wasteListQuery = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(WASTE_STATUSES).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  facilityId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sortBy: z.enum(['generatedAt', 'createdAt', 'quantity', 'status', 'recordCode']).default('generatedAt'),
  sortDir: z.enum(['asc', 'desc']).default('desc'),
});
export const transitionBody = z.object({ status: z.enum(WASTE_STATUSES), note: z.string().max(500).optional() });

// ---- collections ----
export const collectionCreateBody = z.object({
  wasteId: uuid,
  scheduledFor: optionalIso,
  notes: z.string().max(500).optional(),
});
export const collectionPatchBody = z
  .object({
    collectorId: uuid.optional(),
    status: z.literal('COMPLETED').optional(),
    collectedQuantity: z.number().positive().max(100000).optional(),
  })
  .refine((v) => v.collectorId || v.status, { message: 'Provide collectorId or status' })
  .refine((v) => !(v.collectorId && v.status), { message: 'Assign a collector and complete in separate requests' });
export const collectionListQuery = paginationSchema.extend({
  status: z.enum(['PENDING', 'ASSIGNED', 'COMPLETED', 'CANCELLED']).optional(),
});

// ---- transport ----
export const transportCreateBody = z.object({
  wasteId: uuid,
  vehicleId: uuid,
  destinationId: uuid,
  expectedArrivalAt: isoDate,
  transporterId: uuid.optional(),
  notes: z.string().max(500).optional(),
});
export const transportPatchBody = z.object({
  status: z.enum(['IN_TRANSIT', 'ARRIVED']),
  arrivedAt: optionalIso,
});
export const transportListQuery = paginationSchema.extend({
  status: z.enum(['PLANNED', 'IN_TRANSIT', 'ARRIVED', 'CANCELLED']).optional(),
  delayed: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

// ---- disposal ----
export const METHODS = ['INCINERATION', 'AUTOCLAVE', 'MICROWAVE', 'DEEP_BURIAL', 'CHEMICAL_DISINFECTION', 'SHREDDING'] as const;
export const disposalCreateBody = z.object({
  wasteId: uuid,
  method: z.enum(METHODS),
  treatmentFacilityId: uuid.optional(),
  treatedAt: optionalIso,
  disposedAt: optionalIso,
  certificateNo: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

// ---- alerts ----
export const ALERT_TYPES = [
  'DELAYED_COLLECTION',
  'DELAYED_TRANSPORT',
  'EXCESSIVE_QUANTITY',
  'MISSING_DISPOSAL',
  'INVALID_TRANSITION',
  'VEHICLE_ISSUE',
  'UNASSIGNED_WASTE',
  'SEGREGATION_PROBLEM',
] as const;
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const alertListQuery = paginationSchema.extend({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  severity: z.enum(SEVERITIES).optional(),
  type: z.enum(ALERT_TYPES).optional(),
  facilityId: uuid.optional(),
});
export const alertCreateBody = z.object({
  type: z.enum(['VEHICLE_ISSUE', 'SEGREGATION_PROBLEM']),
  severity: z.enum(SEVERITIES),
  message: z.string().trim().min(3).max(500),
  wasteId: uuid.optional(),
  facilityId: uuid.optional(),
});
export const alertPatchBody = z.object({ status: z.enum(['ACKNOWLEDGED', 'RESOLVED']) });

// ---- analytics / audit / reference ----
export const dashboardQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  facilityId: uuid.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  status: z.enum(WASTE_STATUSES).optional(),
});
export const auditQuery = paginationSchema.extend({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  action: z.string().max(60).optional(),
  userId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export const usersQuery = z.object({ role: z.enum(ROLES).optional() });
