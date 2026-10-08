import { useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { useAction } from '../components/actions';
import { Badge, Card, Empty, ErrorBox, PageHead, Pagination, Skeleton, useToast } from '../components/ui';
import { useFetch } from '../hooks';
import { AlertRow, fmtDate, pretty } from '../types';

export default function Alerts() {
  const { can } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'OPEN';
  const severity = params.get('severity') ?? '';
  const type = params.get('type') ?? '';
  const page = Number(params.get('page') ?? 1);
  const { data, meta, loading, error, reload } = useFetch(() => api<AlertRow[]>('/alerts', { query: { status: status === 'ALL' ? '' : status, severity, type, page, pageSize: 15 } }), [params]);
  const act = useAction(reload);
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const canAct = can('ADMIN', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR');
  const update = (id: string, s: 'ACKNOWLEDGED' | 'RESOLVED') => act.run(() => api(`/alerts/${id}`, { method: 'PATCH', body: { status: s } }), s === 'RESOLVED' ? 'Alert resolved' : 'Alert acknowledged');

  async function scan() {
    try {
      const r = await api<{ skipped: boolean; created: Record<string, number> }>('/alerts/scan', { method: 'POST' });
      const n = Object.values(r.data.created).reduce((a, b) => a + b, 0);
      toast('success', r.data.skipped ? 'A scan is already running' : `Scan complete: ${n} new alert${n === 1 ? '' : 's'}`);
      reload();
    } catch (e) {
      toast('error', (e as Error).message);
    }
  }

  return (
    <>
      <PageHead
        title="Alerts"
        subtitle="Delays, overdue pickups, missing disposals and other compliance risks"
        actions={can('ADMIN') && <button className="btn" onClick={scan}>Run alert scan now</button>}
      />
      <Card>
        <div className="filters">
          <select value={status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All</option>
          </select>
          <select value={severity} onChange={(e) => set({ severity: e.target.value })} aria-label="Severity">
            <option value="">Any severity</option>
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
          <select value={type} onChange={(e) => set({ type: e.target.value })} aria-label="Type">
            <option value="">Any type</option>
            {['DELAYED_COLLECTION', 'DELAYED_TRANSPORT', 'EXCESSIVE_QUANTITY', 'MISSING_DISPOSAL', 'INVALID_TRANSITION', 'VEHICLE_ISSUE', 'UNASSIGNED_WASTE', 'SEGREGATION_PROBLEM'].map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Skeleton rows={7} />
        ) : data && data.length === 0 ? (
          <Empty title="No alerts match" hint="Nothing needs attention with these filters." />
        ) : (
          <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
            <table>
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Type</th>
                  <th>Message</th>
                  <th>Record</th>
                  <th>Facility</th>
                  <th>Raised</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data?.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Badge value={a.severity} />
                    </td>
                    <td>{pretty(a.type)}</td>
                    <td style={{ maxWidth: 380 }}>{a.message}</td>
                    <td>{a.wasteId ? <Link className="mono" to={`/waste/${a.wasteId}`}>{a.recordCode}</Link> : '—'}</td>
                    <td>{a.facilityName ?? '—'}</td>
                    <td>{fmtDate(a.createdAt)}</td>
                    <td>
                      <Badge value={a.status} />
                    </td>
                    <td>
                      {canAct && a.status !== 'RESOLVED' && (
                        <div className="row gap">
                          {a.status === 'OPEN' && (
                            <button className="btn sm" disabled={act.busy} onClick={() => update(a.id, 'ACKNOWLEDGED')}>
                              Acknowledge
                            </button>
                          )}
                          <button className="btn sm" disabled={act.busy} onClick={() => update(a.id, 'RESOLVED')}>
                            Resolve
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={meta} onPage={(p) => set({ page: String(p) })} />
      </Card>
    </>
  );
}
