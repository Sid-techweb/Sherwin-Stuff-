export const ROLES = [
  'ADMIN',
  'HOSPITAL_STAFF',
  'WASTE_COLLECTOR',
  'TRANSPORTER',
  'TREATMENT_OPERATOR',
  'AUDITOR',
] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  facilityId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
