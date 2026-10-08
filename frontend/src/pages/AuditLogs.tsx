import { useState } from 'react';
import { api } from '../api';
import { Card, Empty, ErrorBox, PageHead, Pagination, Skeleton } from '../components/ui';
import { useFetch } from '../hooks';
import { AuditRow, fmtDate } from '../types';

const ENTITIES = ['waste_record', 'collection', 'transport', 'disposal', 'alert', 'user'];

export default function AuditLogs() {
  const [f, setF] = useState({ entity: '', action: '', page: 1 });
  const [open, setOpen] = useState<number | null>(null);
  const { data, meta, loading, error, reload } = useFetch(() => api<AuditRow[]>('/audit-logs', { query: { entity: f.entity, action: f.action, page: f.page, pageSize: 25 } }), [f]);
  return (
    <>
      <PageHead title="Audit logs" subtitle="Append-only record of every important action. Rows cannot be edited or deleted - the database rejects it." />
      <Card>
        <div className="filters">
          <select value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value, page: 1 })} aria-label="Entity">
            <option value="">All entities</option>
            {ENTITIES.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
          <input placeholder="Action, e.g. WASTE_CREATED" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value.toUpperCase(), page: 1 })} style={{ minWidth: 240 }} />
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Skeleton rows={8} />
        ) : data && data.length === 0 ? (
          <Empty title="No audit entries" />
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((a) => (
                  <tr key={a.id} className="clickable" onClick={() => setOpen(open === a.id ? null : a.id)}>
                    <td className="muted">{a.id}</td>
                    <td>{fmtDate(a.createdAt)}</td>
                    <td>{a.userName ?? 'System'}</td>
                    <td className="mono">{a.action}</td>
                    <td className="mono">
                      {a.entity} <span className="muted">{a.entityId?.slice(0, 8)}</span>
                    </td>
                    <td className="mono muted" style={{ maxWidth: 360, whiteSpace: open === a.id ? 'pre-wrap' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {open === a.id ? JSON.stringify(a.metadata, null, 2) : JSON.stringify(a.metadata)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} onPage={(p) => setF({ ...f, page: p })} />
      </Card>
    </>
  );
}
