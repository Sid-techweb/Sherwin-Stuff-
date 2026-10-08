import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { useAuth } from '../auth';
import { Card, Empty, ErrorBox, PageHead, Skeleton } from '../components/ui';
import { useFetch } from '../hooks';
import { Facility } from '../types';

interface Ops {
  avgCollectionHours: number | null;
  avgTransportHours: number | null;
  avgDisposalTurnaroundHours: number | null;
  avgLifecycleHours: number | null;
  collectionCompletionPct: number | null;
  delayedTransportPct: number | null;
  sample: { collections: number; completedCollections: number; arrivedTransports: number; delayedTransports: number; disposals: number; closedRecords: number };
  byFacility: { id: string; name: string; avgCollectionHours: number | null; avgTransportHours: number | null; arrivedTransports: number; delayedTransports: number; delayedPct: number | null }[];
}

const h = (v: number | null) => (v === null ? '—' : v < 48 ? `${v} h` : `${v} h (${Math.round((v / 24) * 10) / 10} d)`);
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

function Stat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="kpi" style={{ ['--accent' as string]: accent }}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const [f, setF] = useState({ from: '', to: '', facilityId: '' });
  const facilities = useFetch(() => api<Facility[]>('/facilities'), []);
  const ops = useFetch(
    () => api<Ops>('/analytics/operational', { query: { from: f.from ? new Date(f.from).toISOString() : '', to: f.to ? new Date(f.to + 'T23:59:59').toISOString() : '', facilityId: f.facilityId } }),
    [f],
  );
  const d = ops.data;
  return (
    <>
      <PageHead
        title="Operational analytics"
        subtitle="Durations and rates computed from real timestamps in the database"
        actions={ops.meta.cache && <span className="cache-pill">{ops.meta.cache === 'HIT' ? '⚡ served from Redis cache' : '● computed from PostgreSQL'}</span>}
      />
      <div className="filters">
        {user?.role !== 'HOSPITAL_STAFF' && (
          <select value={f.facilityId} onChange={(e) => setF({ ...f, facilityId: e.target.value })} aria-label="Facility">
            <option value="">All facilities</option>
            {facilities.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <label className="row gap muted">
          From <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
        </label>
        <label className="row gap muted">
          To <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </label>
        <button className="btn" onClick={() => setF({ from: '', to: '', facilityId: '' })}>
          Reset
        </button>
      </div>
      {ops.error && <ErrorBox message={ops.error} onRetry={ops.reload} />}
      {ops.loading && !d && (
        <Card>
          <Skeleton rows={6} />
        </Card>
      )}
      {d && (
        <>
          <div className="grid kpis">
            <Stat label="Avg collection time" value={h(d.avgCollectionHours)} sub="request → collected" accent="#2563eb" />
            <Stat label="Avg transport time" value={h(d.avgTransportHours)} sub="departure → arrival" accent="#7c3aed" />
            <Stat label="Avg disposal turnaround" value={h(d.avgDisposalTurnaroundHours)} sub="arrival → disposed" accent="#d97706" />
            <Stat label="Avg lifecycle duration" value={h(d.avgLifecycleHours)} sub={`generated → closed (n=${d.sample.closedRecords})`} accent="#0f766e" />
            <Stat label="Delayed transports" value={pct(d.delayedTransportPct)} sub={`${d.sample.delayedTransports} of ${d.sample.arrivedTransports} arrived`} accent="#dc2626" />
            <Stat label="Collection completion" value={pct(d.collectionCompletionPct)} sub={`${d.sample.completedCollections} of ${d.sample.collections}`} accent="#16a34a" />
          </div>
          {d.byFacility.length === 0 ? (
            <Card>
              <Empty title="No data for these filters" />
            </Card>
          ) : (
            <>
              <div className="grid two">
                <Card title="Delayed transport rate by facility (%)">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={d.byFacility.map((x) => ({ ...x, short: x.name.replace('Demo ', '') }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                      <XAxis dataKey="short" fontSize={10} interval={0} />
                      <YAxis fontSize={11} unit="%" />
                      <Tooltip />
                      <Bar dataKey="delayedPct" name="Delayed %" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <Card title="Average collection & transport time by facility (h)">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={d.byFacility.map((x) => ({ ...x, short: x.name.replace('Demo ', '') }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                      <XAxis dataKey="short" fontSize={10} interval={0} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="avgCollectionHours" name="Collection (h)" fill="#2563eb" />
                      <Bar dataKey="avgTransportHours" name="Transport (h)" fill="#7c3aed" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>
              <Card title="Facility comparison">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Facility</th>
                        <th>Avg collection</th>
                        <th>Avg transport</th>
                        <th>Arrived transports</th>
                        <th>Delayed</th>
                        <th>Delay rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.byFacility.map((x) => (
                        <tr key={x.id}>
                          <td>{x.name}</td>
                          <td>{h(x.avgCollectionHours)}</td>
                          <td>{h(x.avgTransportHours)}</td>
                          <td>{x.arrivedTransports}</td>
                          <td>{x.delayedTransports}</td>
                          <td>{pct(x.delayedPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
