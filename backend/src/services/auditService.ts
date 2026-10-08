import { Db, query } from '../db/pool';

/** Append-only audit trail. Pass the transaction client so the audit row commits atomically with the change. */
export async function audit(
  db: Db,
  userId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await query(
    'INSERT INTO audit_logs (user_id, action, entity, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)',
    [userId, action, entity, entityId, JSON.stringify(metadata)],
    db,
  );
}
