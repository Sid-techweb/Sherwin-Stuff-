export type Role = 'ADMIN' | 'HOSPITAL_STAFF' | 'WASTE_COLLECTOR' | 'TRANSPORTER' | 'TREATMENT_OPERATOR' | 'AUDITOR';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  facilityId: string | null;
}

export const WASTE_STATUSES = [
  'SEGREGATED',
  'COLLECTION_PENDING',
  'COLLECTED',
  'IN_TRANSIT',
  'ARRIVED',
  'TREATMENT_PENDING',
  'TREATED',
  'DISPOSED',
  'CLOSED',
  'REJECTED',
] as const;

export interface Waste {
  id: string;
  recordCode: string;
  status: string;
  quantity: number;
  unit: string;
  generatedAt: string;
  notes: string | null;
  isDemo: boolean;
  closedAt: string | null;
  categoryId: number;
  categoryCode: string;
  categoryName: string;
  facilityId: string;
  facilityName: string;
  createdByName: string;
}

export interface History {
  id: number;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  changedAt: string;
  changedByName: string | null;
}
export interface CollectionRow {
  id: string;
  status: string;
  requestedAt: string;
  scheduledFor: string | null;
  collectedAt: string | null;
  collectedQuantity: number | null;
  collectorName: string | null;
  recordCode?: string;
  wasteId?: string;
  quantity?: number;
  unit?: string;
  facilityName?: string;
  requestedByName?: string;
}
export interface TransportRow {
  id: string;
  status: string;
  departedAt: string | null;
  expectedArrivalAt: string;
  actualArrivalAt: string | null;
  isDelayed: boolean;
  vehicle: string;
  destination: string;
  transporterName: string;
  recordCode?: string;
  wasteId?: string;
  origin?: string;
  quantity?: number;
  unit?: string;
}
export interface DisposalRow {
  id: string;
  method: string;
  treatedAt: string;
  disposedAt: string;
  certificateNo: string | null;
  treatmentFacility: string;
  operatorName: string;
  recordCode?: string;
  wasteId?: string;
  quantity?: number;
  unit?: string;
}
export interface WasteDetail extends Waste {
  history: History[];
  collections: CollectionRow[];
  transports: TransportRow[];
  disposals: DisposalRow[];
  auditTrail: { id: number; action: string; metadata: Record<string, unknown>; createdAt: string; userName: string | null }[];
}
export interface Category {
  id: number;
  code: string;
  name: string;
  color: string;
  defaultMethod: string;
  maxStorageHours: number;
  alertQuantityKg: number;
}
export interface Facility {
  id: string;
  code: string;
  name: string;
  type: string;
  city: string;
  isActive: boolean;
}
export interface TreatmentFacility {
  id: string;
  code: string;
  name: string;
  city: string;
  methods: string[];
  capacityKgPerDay: number;
}
export interface Vehicle {
  id: string;
  registration: string;
  type: string;
  capacityKg: number;
  status: string;
}
export interface AlertRow {
  id: string;
  type: string;
  severity: string;
  status: string;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  wasteId: string | null;
  recordCode: string | null;
  facilityName: string | null;
}
export interface AuditRow {
  id: number;
  action: string;
  entity: string;
  entityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  userName: string | null;
}
export interface Dashboard {
  totals: {
    records: number;
    quantityKg: number;
    collected: number;
    inTransit: number;
    awaitingDisposal: number;
    disposed: number;
    pendingCollections: number;
    delayedTransports: number;
    activeAlerts: number;
  };
  byStatus: { status: string; records: number; quantityKg: number }[];
  byCategory: { code: string; name: string; color: string; records: number; quantityKg: number }[];
  overTime: { day: string; records: number; quantityKg: number }[];
  byFacility: { id: string; name: string; records: number; quantityKg: number; disposed: number; delayedTransports: number }[];
  disposalMethods: { method: string; records: number }[];
  generatedAt: string;
}

export const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/^\w|\s\w/g, (c) => c.toUpperCase());
export const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
