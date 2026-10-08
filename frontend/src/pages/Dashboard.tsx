import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api';
import { Card, Empty, ErrorBox, PageHead, Skeleton } from '../components/ui';
import { useFetch } from '../hooks';
import { Category, Dashboard as Dash, Facility, pretty } from '../types';
import { useAuth } from '../auth';
import { Link } from 'react-router-dom';

const PALETTE = ['#0f766e', '#2563eb', '#d97706', '#7c3aed', '#dc2626', '#0891b2'];

function Kpi({ label, value, sub, accent, to }: { label: string; value: string | number; sub?: string; accent?: string; to?: string }) {
  const body = (
    <div className="kpi" style={{ ['--accent' as string]: accent }}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
  return to ? (
    <Link to={to} style={{ color: 'inherit', textDecoration: 'none' }}>
      {body}
    </Link>
  ) : (
    body
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [f, setF] = useState({ from: '', to: '', facilityId: '', categoryId: '', status: '' });
  const facilities = useFetch(() => api<Facility[]>('/facilities'), []);
  const categories = useFetch(() => api<Category[]>('/categories'), []);
  const q = {
    from: f.from ? new Date(f.from).toISOString() : '',
    to: f.to ? new Date(f.to + 'T23:59:59').toISOString() : '',
    facilityId: f.facilityId,
    categoryId: f.categoryId,
    status: f.status,
  };
  const dash = useFetch(() => api<Dash>('/analytics/dashboard', { query: q }), [f]);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const d = dash.data;
  const t = d?.totals;

  return (
    <>
      <PageHead
        title="Operations dashboard"
        subtitle="Live view of biomedical waste across all facilities"
        actions={
          dash.meta.cache && (
            <span className="cache-pill" title="Dashboard results are cached in Redis for 60s and invalidated on every data change">
              {dash.meta.cache === 'HIT' ? '⚡ served from Redis cache' : '● computed from PostgreSQL'}
            </span>
          )
        }
      />
      <div className="demo-banner">All records shown are synthetic demo data.</div>

      <div className="filters">
        {user?.role !== 'HOSPITAL_STAFF' && (
          <select value={f.facilityId} onChange={set('facilityId')} aria-label="Facility">
            <option value="">All facilities</option>
            {facilities.data?.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        <select value={f.categoryId} onChange={set('categoryId')} aria-label="Category">
          <option value="">All categories</option>
          {categories.data?.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <select value={f.status} onChange={set('status')} aria-label="Status">
          <option value="">Any status</option>
          {['SEGREGATED', 'COLLECTION_PENDING', 'COLLECTED', 'IN_TRANSIT', 'ARRIVED', 'TREATMENT_PENDING', 'TREATED', 'DISPOSED', 'CLOSED', 'REJECTED'].map((s) => (
            <option key={s} value={s}>
              {pretty(s)}
            </option>
          ))}
        </select>
        <label className="row gap muted">
          From <input type="date" value={f.from} onChange={set('from')} />
        </label>
        <label className="row gap muted">
          To <input type="date" value={f.to} onChange={set('to')} />
        </label>
        <button className="btn" onClick={() => setF({ from: '', to: '', facilityId: '', categoryId: '', status: '' })}>
          Reset
        </button>
      </div>

      {dash.error && <ErrorBox message={dash.error} onRetry={dash.reload} />}
      {dash.loading && !d && (
        <Card>
          <Skeleton rows={6} />
        </Card>
      )}

      {t && d && (
        <>
          <div className="grid kpis">
            <Kpi label="Total waste generated" value={`${t.quantityKg.toLocaleString()} kg`} sub={`${t.records} records`} to="/waste" />
            <Kpi label="Collected (awaiting transport)" value={t.collected} accent="#2563eb" to="/waste?status=COLLECTED" />
            <Kpi label="In transit" value={t.inTransit} accent="#7c3aed" to="/transport?status=IN_TRANSIT" />
            <Kpi label="Awaiting disposal" value={t.awaitingDisposal} accent="#d97706" to="/waste?status=ARRIVED" />
            <Kpi label="Disposed / closed" value={t.disposed} accent="#16a34a" to="/disposals" />
            <Kpi label="Pending collections" value={t.pendingCollections} accent="#d97706" to="/collections?status=PENDING" />
            <Kpi label="Delayed transports" value={t.delayedTransports} accent="#dc2626" to="/transport?delayed=true" />
            <Kpi label="Active alerts" value={t.activeAlerts} accent="#dc2626" to="/alerts" />
          </div>

          {t.records === 0 ? (
            <Card>
              <Empty title="No records match these filters" hint="Try widening the date range or clearing filters." />
            </Card>
          ) : (
            <>
              <div className="grid two">
                <Card title="Waste generated over time (kg/day)">
                  <ResponsiveContainer width="100%" height={260}>
                    <LineChart data={d.overTime}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                      <XAxis dataKey="day" tickFormatter={(v: string) => v.slice(5)} fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Line type="monotone" dataKey="quantityKg" name="kg" stroke="#0f766e" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </Card>
                <Card title="Waste by category (kg)">
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={d.byCategory}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                      <XAxis dataKey="code" fontSize={11} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Bar dataKey="quantityKg" name="kg" stroke="#00000033">
                        {d.byCategory.map((c) => (
                          <Cell key={c.code} fill={c.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </div>
              <div className="grid two">
                <Card title="Facility performance">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={d.byFacility.map((x) => ({ ...x, short: x.name.replace('Demo ', '') }))}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                      <XAxis dataKey="short" fontSize={10} interval={0} />
                      <YAxis fontSize={11} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="records" name="Records" fill="#0f766e" />
                      <Bar dataKey="disposed" name="Disposed" fill="#16a34a" />
                      <Bar dataKey="delayedTransports" name="Delayed transports" fill="#dc2626" />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
                <Card title="Disposal methods">
                  {d.disposalMethods.length === 0 ? (
                    <Empty title="No disposals recorded yet" />
                  ) : (
                    <ResponsiveContainer width="100%" height={280}>
                      <PieChart>
                        <Pie data={d.disposalMethods.map((m) => ({ ...m, name: pretty(m.method) }))} dataKey="records" nameKey="name" outerRadius={90} label>
                          {d.disposalMethods.map((_, i) => (
                            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </Card>
              </div>
              <Card title="Records by lifecycle status">
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={d.byStatus.map((s) => ({ ...s, label: pretty(s.status) }))} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e3e8ee" />
                    <XAxis type="number" fontSize={11} />
                    <YAxis dataKey="label" type="category" fontSize={11} width={130} />
                    <Tooltip />
                    <Bar dataKey="records" name="Records" fill="#2563eb" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            </>
          )}
        </>
      )}
    </>
  );
}
