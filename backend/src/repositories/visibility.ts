import { AuthUser } from '../types';

/**
 * Row-level scoping for waste records. Returns a SQL predicate (on alias `w`) plus its parameters.
 * Parameter placeholders start at `startIdx`.
 *  - HOSPITAL_STAFF: only their own facility
 *  - WASTE_COLLECTOR: only waste with a collection assigned to them
 *  - TRANSPORTER: only waste with a transport job assigned to them
 *  - ADMIN / AUDITOR / TREATMENT_OPERATOR: everything
 */
export function wasteVisibility(user: AuthUser, startIdx: number): { sql: string; params: unknown[] } {
  switch (user.role) {
    case 'HOSPITAL_STAFF':
      return { sql: `w.facility_id = $${startIdx}`, params: [user.facilityId] };
    case 'WASTE_COLLECTOR':
      return {
        sql: `EXISTS (SELECT 1 FROM collection_records vc WHERE vc.waste_id = w.id AND vc.collector_id = $${startIdx})`,
        params: [user.id],
      };
    case 'TRANSPORTER':
      return {
        sql: `EXISTS (SELECT 1 FROM transport_records vt WHERE vt.waste_id = w.id AND vt.transporter_id = $${startIdx})`,
        params: [user.id],
      };
    default:
      return { sql: 'TRUE', params: [] };
  }
}
