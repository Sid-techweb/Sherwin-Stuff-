import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  AssignCollectorButton,
  CompleteCollectionButton,
  ConfirmButton,
  PlanTransportButton,
  RecordDisposalButton,
  RequestCollectionButton,
  TransitionButton,
  TransportStepButton,
  useAction,
} from '../components/actions';
import { Badge, Card, Empty, ErrorBox, PageHead, Skeleton } from '../components/ui';
import { useFetch } from '../hooks';
import { fmtDate, pretty, WasteDetail } from '../types';

const STEPS = ['SEGREGATED', 'COLLECTION_PENDING', 'COLLECTED', 'IN_TRANSIT', 'ARRIVED', 'TREATMENT_PENDING', 'TREATED', 'DISPOSED', 'CLOSED'];

export default function WasteDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const { data: w, loading, error, reload } = useFetch(() => api<WasteDetail>(`/waste/${id}`), [id]);
  const del = useAction(() => nav('/waste'));

  if (loading && !w) return <Skeleton rows={8} />;
  if (error || !w)
    return (
      <>
        <ErrorBox message={error ?? 'Not found'} onRetry={reload} />
        <Link to="/waste">← Back to records</Link>
      </>
    );

  const when = (s: string) => w.history.find((h) => h.toStatus === s)?.changedAt;
  const currentIdx = STEPS.indexOf(w.status);
  const rejected = w.status === 'REJECTED';
  const col = w.collections.find((c) => c.status === 'PENDING' || c.status === 'ASSIGNED');
  const tr = w.transports.find((t) => t.status === 'PLANNED' || t.status === 'IN_TRANSIT');
  const actions: JSX.Element[] = [];
  const st = w.status;

  if (st === 'SEGREGATED' && can('ADMIN', 'HOSPITAL_STAFF')) actions.push(<RequestCollectionButton key="rc" wasteId={w.id} onDone={reload} />);
  if (st === 'COLLECTION_PENDING' && col) {
    if (can('ADMIN', 'HOSPITAL_STAFF')) actions.push(<AssignCollectorButton key="ac" collectionId={col.id} onDone={reload} />);
    if (col.status === 'ASSIGNED' && can('ADMIN', 'WASTE_COLLECTOR')) actions.push(<CompleteCollectionButton key="cc" collectionId={col.id} onDone={reload} />);
  }
  if (st === 'COLLECTED' && can('ADMIN', 'TRANSPORTER')) {
    if (tr) actions.push(<TransportStepButton key="dep" transportId={tr.id} status="PLANNED" onDone={reload} />);
    else actions.push(<PlanTransportButton key="pt" wasteId={w.id} onDone={reload} />);
  }
  if (st === 'IN_TRANSIT' && tr && can('ADMIN', 'TRANSPORTER')) actions.push(<TransportStepButton key="arr" transportId={tr.id} status="IN_TRANSIT" onDone={reload} />);
  if (st === 'ARRIVED' && can('ADMIN', 'TREATMENT_OPERATOR'))
    actions.push(<TransitionButton key="q" wasteId={w.id} to="TREATMENT_PENDING" label="Queue for treatment" text="Move this waste into the treatment queue." onDone={reload} />);
  if (['ARRIVED', 'TREATMENT_PENDING'].includes(st) && can('ADMIN', 'TREATMENT_OPERATOR')) actions.push(<RecordDisposalButton key="rd" wasteId={w.id} onDone={reload} />);
  if (st === 'DISPOSED' && can('ADMIN', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'))
    actions.push(<TransitionButton key="close" wasteId={w.id} to="CLOSED" label="Close record" text="Closing completes the lifecycle. This cannot be undone." onDone={reload} />);
  if (['SEGREGATED', 'COLLECTION_PENDING', 'COLLECTED', 'ARRIVED', 'TREATMENT_PENDING'].includes(st) && can('ADMIN', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'))
    actions.push(<TransitionButton key="rej" wasteId={w.id} to="REJECTED" label="Reject" danger text="Reject this batch (e.g. wrongly segregated). Open collections and planned transports are cancelled. This cannot be undone." onDone={reload} />);
  if (st === 'SEGREGATED' && can('ADMIN'))
    actions.push(
      <ConfirmButton key="del" label="Delete" danger title="Delete record" text="Permanently delete this record? The deletion is written to the audit log." disabled={del.busy} onConfirm={() => del.run(() => api(`/waste/${w.id}`, { method: 'DELETE' }), 'Record deleted')} />,
    );

  return (
    <>
      <p>
        <Link to="/waste">← Waste records</Link>
      </p>
      <PageHead
        title={w.recordCode}
        subtitle={`${w.categoryName} · ${w.quantity} ${w.unit} · ${w.facilityName}`}
        actions={
          <>
            {w.isDemo && <span className="badge amber">Demo data</span>}
            <Badge value={w.status} />
          </>
        }
      />

      <Card title="Lifecycle">
        <div className="stepper" role="list">
          {rejected ? (
            <>
              {STEPS.slice(0, 2).map((s) => (
                <div key={s} role="listitem" className={`step ${when(s) ? 'done' : ''}`}>
                  <div className="circle">{when(s) ? '✓' : ''}</div>
                  <div className="name">{pretty(s)}</div>
                  <div className="when">{fmtDate(when(s))}</div>
                </div>
              ))}
              <div role="listitem" className="step current rejected">
                <div className="circle">✕</div>
                <div className="name">Rejected</div>
                <div className="when">{fmtDate(when('REJECTED'))}</div>
              </div>
            </>
          ) : (
            STEPS.map((s, i) => (
              <div key={s} role="listitem" className={`step ${i < currentIdx ? 'done' : ''} ${i === currentIdx ? 'current' : ''}`} aria-current={i === currentIdx ? 'step' : undefined}>
                <div className="circle">{i < currentIdx ? '✓' : i + 1}</div>
                <div className="name">{pretty(s)}</div>
                <div className="when">{fmtDate(when(s))}</div>
              </div>
            ))
          )}
        </div>
      </Card>

      <div className="grid two">
        <Card title="Details">
          <dl className="detail-grid">
            <div>
              <dt>Category</dt>
              <dd>{w.categoryName}</dd>
            </div>
            <div>
              <dt>Quantity</dt>
              <dd>
                {w.quantity} {w.unit}
              </dd>
            </div>
            <div>
              <dt>Source facility</dt>
              <dd>{w.facilityName}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>{fmtDate(w.generatedAt)}</dd>
            </div>
            <div>
              <dt>Registered by</dt>
              <dd>{w.createdByName}</dd>
            </div>
            <div>
              <dt>Closed</dt>
              <dd>{fmtDate(w.closedAt)}</dd>
            </div>
          </dl>
          {w.notes && <p className="muted" style={{ marginTop: 12 }}>Notes: {w.notes}</p>}
        </Card>

        <Card title="Next actions">
          {actions.length ? (
            <div className="row gap wrap">{actions}</div>
          ) : (
            <p className="muted">{['CLOSED', 'REJECTED'].includes(st) ? 'This record is finished - no further actions.' : 'No actions available for your role at this stage.'}</p>
          )}
        </Card>
      </div>

      <div className="grid two">
        <Card title="Collection & transport">
          {w.collections.length === 0 && w.transports.length === 0 ? (
            <Empty title="Not collected yet" />
          ) : (
            <>
              {w.collections.map((c) => (
                <p key={c.id}>
                  <Badge value={c.status} /> Collection · {c.collectorName ?? 'no collector yet'} · requested {fmtDate(c.requestedAt)}
                  {c.collectedAt && <> · collected {fmtDate(c.collectedAt)}</>}
                </p>
              ))}
              {w.transports.map((t) => (
                <p key={t.id}>
                  <Badge value={t.status} /> {t.vehicle} → {t.destination} · {t.transporterName}
                  <br />
                  <span className="muted">
                    ETA {fmtDate(t.expectedArrivalAt)} · arrived {fmtDate(t.actualArrivalAt)} {t.isDelayed && <span className="badge red">Delayed</span>}
                  </span>
                </p>
              ))}
            </>
          )}
          {w.disposals.map((d) => (
            <p key={d.id}>
              <Badge value="DISPOSED" /> {pretty(d.method)} at {d.treatmentFacility} · cert {d.certificateNo ?? '—'} · {fmtDate(d.disposedAt)}
            </p>
          ))}
        </Card>

        <Card title="Status history">
          <ol className="timeline">
            {w.history.map((h) => (
              <li key={h.id}>
                <strong>{pretty(h.toStatus)}</strong> <span className="muted">· {fmtDate(h.changedAt)}</span>
                <div className="muted">
                  {h.changedByName ?? 'System'}
                  {h.note ? ` — ${h.note}` : ''}
                </div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <Card title="Audit history">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {w.auditTrail.map((a) => (
                <tr key={a.id}>
                  <td>{fmtDate(a.createdAt)}</td>
                  <td>{a.userName ?? 'System'}</td>
                  <td className="mono">{a.action}</td>
                  <td className="mono muted">{JSON.stringify(a.metadata).slice(0, 110)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
