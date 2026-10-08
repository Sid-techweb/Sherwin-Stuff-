import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { Badge, Card, Empty, ErrorBox, Field, Modal, PageHead, Pagination, Skeleton, toIso, useToast } from '../components/ui';
import { useFetch } from '../hooks';
import { Category, Facility, fmtDate, pretty, Waste, WASTE_STATUSES } from '../types';

export default function WasteList() {
  const { can, user } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [creating, setCreating] = useState(false);
  const q = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    categoryId: params.get('categoryId') ?? '',
    facilityId: params.get('facilityId') ?? '',
    sortBy: params.get('sortBy') ?? 'generatedAt',
    sortDir: params.get('sortDir') ?? 'desc',
    page: Number(params.get('page') ?? 1),
    pageSize: 15,
  };
  const categories = useFetch(() => api<Category[]>('/categories'), []);
  const facilities = useFetch(() => api<Facility[]>('/facilities'), []);
  const list = useFetch(() => api<Waste[]>('/waste', { query: q }), [params]);

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };
  const sortHeader = (key: string, label: string) => (
    <th
      className="sortable"
      onClick={() => update({ sortBy: key, sortDir: q.sortBy === key && q.sortDir === 'desc' ? 'asc' : 'desc' })}
      aria-sort={q.sortBy === key ? (q.sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label} {q.sortBy === key ? (q.sortDir === 'asc' ? '▲' : '▼') : ''}
    </th>
  );

  return (
    <>
      <PageHead
        title="Waste records"
        subtitle="Every batch from segregation to closure"
        actions={
          can('ADMIN', 'HOSPITAL_STAFF') && (
            <button className="btn primary" onClick={() => setCreating(true)}>
              + New record
            </button>
          )
        }
      />
      <Card>
        <form
          className="filters"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            update({ search });
          }}
        >
          <input placeholder="Search record code or notes…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 240 }} />
          <select value={q.status} onChange={(e) => update({ status: e.target.value })} aria-label="Status">
            <option value="">All statuses</option>
            {WASTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {pretty(s)}
              </option>
            ))}
          </select>
          <select value={q.categoryId} onChange={(e) => update({ categoryId: e.target.value })} aria-label="Category">
            <option value="">All categories</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {user?.role !== 'HOSPITAL_STAFF' && (
            <select value={q.facilityId} onChange={(e) => update({ facilityId: e.target.value })} aria-label="Facility">
              <option value="">All facilities</option>
              {facilities.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button className="btn">Search</button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setSearch('');
              setParams(new URLSearchParams());
            }}
          >
            Clear
          </button>
        </form>

        {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
        {list.loading && !list.data ? (
          <Skeleton rows={8} />
        ) : list.data && list.data.length === 0 ? (
          <Empty title="No waste records found" hint="Adjust the filters or create a new record." />
        ) : (
          <div className="table-wrap" style={{ opacity: list.loading ? 0.6 : 1 }}>
            <table>
              <thead>
                <tr>
                  {sortHeader('recordCode', 'Record')}
                  <th>Category</th>
                  <th>Facility</th>
                  {sortHeader('quantity', 'Quantity')}
                  {sortHeader('status', 'Status')}
                  {sortHeader('generatedAt', 'Generated')}
                </tr>
              </thead>
              <tbody>
                {list.data?.map((w) => (
                  <tr key={w.id} className="clickable" onClick={() => nav(`/waste/${w.id}`)}>
                    <td>
                      <Link to={`/waste/${w.id}`} onClick={(e) => e.stopPropagation()} className="mono">
                        {w.recordCode}
                      </Link>
                    </td>
                    <td>{w.categoryName.split(' - ')[0]}</td>
                    <td>{w.facilityName}</td>
                    <td>
                      {w.quantity} {w.unit}
                    </td>
                    <td>
                      <Badge value={w.status} />
                    </td>
                    <td>{fmtDate(w.generatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination meta={list.meta} onPage={(p) => update({ page: String(p) })} />
      </Card>

      {creating && (
        <CreateWaste
          categories={categories.data ?? []}
          facilities={facilities.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            toast('success', 'Waste record created');
            nav(`/waste/${id}`);
          }}
        />
      )}
    </>
  );
}

function CreateWaste({ categories, facilities, onClose, onCreated }: { categories: Category[]; facilities: Facility[]; onClose: () => void; onCreated: (id: string) => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ categoryId: '', facilityId: '', quantity: '', unit: 'kg', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<Waste>('/waste', {
        method: 'POST',
        body: {
          categoryId: Number(form.categoryId),
          quantity: Number(form.quantity),
          unit: form.unit,
          notes: form.notes || undefined,
          ...(user?.role === 'ADMIN' ? { facilityId: form.facilityId } : {}),
        },
      });
      onCreated(r.data.id);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  void toIso;
  return (
    <Modal title="New waste record" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field label="Category">
            <select required value={form.categoryId} onChange={set('categoryId')}>
              <option value="">Select…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {user?.role === 'ADMIN' ? (
            <Field label="Source facility">
              <select required value={form.facilityId} onChange={set('facilityId')}>
                <option value="">Select…</option>
                {facilities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Source facility">
              <input disabled value="Your facility" />
            </Field>
          )}
          <Field label="Quantity">
            <input type="number" required min="0.01" step="0.01" value={form.quantity} onChange={set('quantity')} />
          </Field>
          <Field label="Unit">
            <select value={form.unit} onChange={set('unit')}>
              <option value="kg">kg</option>
              <option value="g">g</option>
              <option value="l">litres</option>
            </select>
          </Field>
        </div>
        <Field label="Notes (optional)">
          <textarea rows={2} value={form.notes} onChange={set('notes')} maxLength={1000} />
        </Field>
        <div className="row gap end">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create record'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
