import { AppError } from '../utils/errors';

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
export type WasteStatus = (typeof WASTE_STATUSES)[number];

/**
 * The single source of truth for legal lifecycle moves.
 * Forward-only; REJECTED is reachable until treatment begins; CLOSED and REJECTED are terminal.
 */
export const TRANSITIONS: Record<WasteStatus, WasteStatus[]> = {
  SEGREGATED: ['COLLECTION_PENDING', 'REJECTED'],
  COLLECTION_PENDING: ['COLLECTED', 'REJECTED'],
  COLLECTED: ['IN_TRANSIT', 'REJECTED'],
  IN_TRANSIT: ['ARRIVED'],
  ARRIVED: ['TREATMENT_PENDING', 'REJECTED'],
  TREATMENT_PENDING: ['TREATED', 'REJECTED'],
  TREATED: ['DISPOSED'],
  DISPOSED: ['CLOSED'],
  CLOSED: [],
  REJECTED: [],
};

export function canTransition(from: WasteStatus, to: WasteStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: WasteStatus, to: WasteStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot move waste from ${from} to ${to}`, {
      from,
      to,
      allowed: TRANSITIONS[from],
    });
  }
}
