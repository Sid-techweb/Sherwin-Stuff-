import { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { AssignCollectorButton, CompleteCollectionButton, TransportStepButton } from '../components/actions';
import { Badge, Card, Empty, ErrorBox, PageHead, Pagination, Skeleton } from '../components/ui';
import { useFetch } from '../hooks';
import { CollectionRow, DisposalRow, fmtDate, pretty, TransportRow } from '../types';

function Table({ loading, error, reload, rows, empty, head, children, meta, onPage }: { loading: boolean; error: string | null; reload: () => void; rows: unknown[] | null; empty: string; head: string[]; children: ReactNode; meta: Parameters<typeof Pagination>[0]['meta']; onPage: (p: number) => void }) {
  return (
    <>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !rows ? (
        <Skeleton rows={7} />
      ) : rows && rows.length === 0 ? (
        <Empty title={empty} />
      ) : (
        <div className="table-wrap" style={{ opacity: loading ? 0.6 : 1 }}>
          <table>
            <thead>
              <tr>
                {head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>{children}</tbody>
          </table>
        </div>
      )}
      <Pagination meta={meta} onPage={onPage} />
    </>
  );
}

const rec = (id?: string, code?: string) => (id ? <Link to={`/waste/${id}`} className="mono">{code}</Link> : code);

function useQuery() {
  const [params, setParams] = useSearchParams();
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  return { params, set, page: Number(params.get('page') ?? 1) };
}

export function Collections() {
  const { can } = useAuth();
  const { params, set, page } = useQuery();
  const status = params.get('status') ?? '';
  const { data, meta, loading, error, reload } = useFetch(() => api<CollectionRow[]>('/collections', { query: { status, page, pageSize: 15 } }), [params]);
  return (
    <>
      <PageHead title="Collections" subtitle="Pickup requests, assigned collectors and completed collections" />
      <Card>
        <div className="filters">
          <select value={status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {['PENDING', 'ASSIGNED', 'COMPLETED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
        </div>
        <Table loading={loading} error={error} reload={reload} rows={data} empty="No collections found" meta={meta} onPage={(p) => set({ page: String(p) })} head={['Record', 'Source', 'Quantity', 'Status', 'Collector', 'Scheduled', 'Collected', '']}>
          {data?.map((c) => (
            <tr key={c.id}>
              <td>{rec(c.wasteId, c.recordCode)}</td>
              <td>{c.facilityName}</td>
              <td>
                {c.quantity} {c.unit}
              </td>
              <td>
                <Badge value={c.status} />
              </td>
              <td>{c.collectorName ?? '—'}</td>
              <td>{fmtDate(c.scheduledFor)}</td>
              <td>{fmtDate(c.collectedAt)}</td>
              <td>
                <div className="row gap">
                  {c.status === 'PENDING' && can('ADMIN', 'HOSPITAL_STAFF') && <AssignCollectorButton small collectionId={c.id} onDone={reload} />}
                  {c.status === 'ASSIGNED' && can('ADMIN', 'WASTE_COLLECTOR') && <CompleteCollectionButton small collectionId={c.id} onDone={reload} />}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

export function Transport() {
  const { can } = useAuth();
  const { params, set, page } = useQuery();
  const status = params.get('status') ?? '';
  const delayed = params.get('delayed') ?? '';
  const { data, meta, loading, error, reload } = useFetch(() => api<TransportRow[]>('/transport', { query: { status, delayed, page, pageSize: 15 } }), [params]);
  return (
    <>
      <PageHead title="Transportation" subtitle="Vehicles, routes and arrival performance" />
      <Card>
        <div className="filters">
          <select value={status} onChange={(e) => set({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {['PLANNED', 'IN_TRANSIT', 'ARRIVED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
          <label className="row gap">
            <input type="checkbox" checked={delayed === 'true'} onChange={(e) => set({ delayed: e.target.checked ? 'true' : '' })} /> Delayed only
          </label>
        </div>
        <Table loading={loading} error={error} reload={reload} rows={data} empty="No transport jobs found" meta={meta} onPage={(p) => set({ page: String(p) })} head={['Record', 'Route', 'Vehicle', 'Transporter', 'Status', 'Departed', 'Expected', 'Actual', '']}>
          {data?.map((t) => (
            <tr key={t.id}>
              <td>{rec(t.wasteId, t.recordCode)}</td>
              <td>
                {t.origin} → {t.destination}
              </td>
              <td className="mono">{t.vehicle}</td>
              <td>{t.transporterName}</td>
              <td>
                <Badge value={t.status} /> {t.isDelayed && <span className="badge red">Delayed</span>}
              </td>
              <td>{fmtDate(t.departedAt)}</td>
              <td>{fmtDate(t.expectedArrivalAt)}</td>
              <td>{fmtDate(t.actualArrivalAt)}</td>
              <td>{(t.status === 'PLANNED' || t.status === 'IN_TRANSIT') && can('ADMIN', 'TRANSPORTER') && <TransportStepButton small transportId={t.id} status={t.status} onDone={reload} />}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}

export function Disposals() {
  const { set, page } = useQuery();
  const { data, meta, loading, error, reload } = useFetch(() => api<DisposalRow[]>('/disposals', { query: { page, pageSize: 15 } }), [page]);
  return (
    <>
      <PageHead title="Disposal & treatment" subtitle="Completed treatment records and certificates" />
      <Card>
        <Table loading={loading} error={error} reload={reload} rows={data} empty="No disposals recorded yet" meta={meta} onPage={(p) => set({ page: String(p) })} head={['Record', 'Quantity', 'Method', 'Facility', 'Operator', 'Treated', 'Disposed', 'Certificate']}>
          {data?.map((d) => (
            <tr key={d.id}>
              <td>{rec(d.wasteId, d.recordCode)}</td>
              <td>
                {d.quantity} {d.unit}
              </td>
              <td>{pretty(d.method)}</td>
              <td>{d.treatmentFacility}</td>
              <td>{d.operatorName}</td>
              <td>{fmtDate(d.treatedAt)}</td>
              <td>{fmtDate(d.disposedAt)}</td>
              <td className="mono">{d.certificateNo ?? '—'}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
