import { FormEvent, ReactNode, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useFetch } from '../hooks';
import { pretty, TreatmentFacility, User, Vehicle } from '../types';
import { Confirm, Field, Modal, localInput, toIso, useToast } from './ui';

/** Runs an API action with busy state + toasts; calls onDone on success. */
export function useAction(onDone: () => void) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await fn();
      toast('success', success);
      onDone();
      return true;
    } catch (e) {
      toast('error', (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

/** A button that opens a modal form. */
export function ModalButton({ label, title, primary, small, children }: { label: string; title: string; primary?: boolean; small?: boolean; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`btn ${primary ? 'primary' : ''} ${small ? 'sm' : ''}`} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          {children(() => setOpen(false))}
        </Modal>
      )}
    </>
  );
}

export function ConfirmButton({ label, title, text, danger, small, onConfirm, disabled }: { label: string; title: string; text: string; danger?: boolean; small?: boolean; onConfirm: () => Promise<unknown> | void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={`btn ${danger ? 'danger' : ''} ${small ? 'sm' : ''}`} disabled={disabled} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <Confirm
          title={title}
          text={text}
          danger={danger}
          confirmLabel={label}
          onCancel={() => setOpen(false)}
          onConfirm={async () => {
            setOpen(false);
            await onConfirm();
          }}
        />
      )}
    </>
  );
}

const Footer = ({ close, busy, label }: { close: () => void; busy: boolean; label: string }) => (
  <div className="row gap end">
    <button type="button" className="btn" onClick={close}>
      Cancel
    </button>
    <button className="btn primary" disabled={busy}>
      {busy ? 'Working…' : label}
    </button>
  </div>
);

export function RequestCollectionButton({ wasteId, onDone, small }: { wasteId: string; onDone: () => void; small?: boolean }) {
  const { run, busy } = useAction(onDone);
  const [when, setWhen] = useState(localInput(6));
  return (
    <ModalButton label="Request collection" title="Request collection" primary={!small} small={small}>
      {(close) => (
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await run(() => api('/collections', { method: 'POST', body: { wasteId, scheduledFor: toIso(when) } }), 'Collection requested')) close();
          }}
        >
          <Field label="Scheduled pickup" hint="An alert is raised automatically if pickup is overdue.">
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
          </Field>
          <Footer close={close} busy={busy} label="Request" />
        </form>
      )}
    </ModalButton>
  );
}

export function AssignCollectorButton({ collectionId, onDone, small }: { collectionId: string; onDone: () => void; small?: boolean }) {
  const { run, busy } = useAction(onDone);
  const [collectorId, setCollectorId] = useState('');
  const users = useFetch(() => api<User[]>('/users', { query: { role: 'WASTE_COLLECTOR' } }), []);
  return (
    <ModalButton label="Assign collector" title="Assign collector" primary={!small} small={small}>
      {(close) => (
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            if (await run(() => api(`/collections/${collectionId}`, { method: 'PATCH', body: { collectorId } }), 'Collector assigned')) close();
          }}
        >
          <Field label="Collector">
            <select required value={collectorId} onChange={(e) => setCollectorId(e.target.value)}>
              <option value="">Select…</option>
              {users.data?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <Footer close={close} busy={busy} label="Assign" />
        </form>
      )}
    </ModalButton>
  );
}

export function CompleteCollectionButton({ collectionId, onDone, small }: { collectionId: string; onDone: () => void; small?: boolean }) {
  const { run, busy } = useAction(onDone);
  return (
    <ConfirmButton
      small={small}
      label="Mark collected"
      title="Confirm collection"
      text="Confirm the waste has been physically collected from the facility."
      disabled={busy}
      onConfirm={() => run(() => api(`/collections/${collectionId}`, { method: 'PATCH', body: { status: 'COMPLETED' } }), 'Collection completed')}
    />
  );
}

export function PlanTransportButton({ wasteId, onDone }: { wasteId: string; onDone: () => void }) {
  const { run, busy } = useAction(onDone);
  const { can } = useAuth();
  const vehicles = useFetch(() => api<Vehicle[]>('/vehicles'), []);
  const dests = useFetch(() => api<TreatmentFacility[]>('/treatment-facilities'), []);
  const transporters = useFetch(() => api<User[]>('/users', { query: { role: 'TRANSPORTER' } }), []);
  const [f, setF] = useState({ vehicleId: '', destinationId: '', eta: localInput(3), transporterId: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  return (
    <ModalButton label="Plan transport" title="Plan transport" primary>
      {(close) => (
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            const body = { wasteId, vehicleId: f.vehicleId, destinationId: f.destinationId, expectedArrivalAt: toIso(f.eta), ...(can('ADMIN') ? { transporterId: f.transporterId } : {}) };
            if (await run(() => api('/transport', { method: 'POST', body }), 'Transport planned')) close();
          }}
        >
          <Field label="Vehicle">
            <select required value={f.vehicleId} onChange={set('vehicleId')}>
              <option value="">Select…</option>
              {vehicles.data?.map((v) => (
                <option key={v.id} value={v.id} disabled={v.status !== 'AVAILABLE'}>
                  {v.registration} · {v.type} · {v.capacityKg} kg {v.status !== 'AVAILABLE' ? `(${pretty(v.status)})` : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Destination treatment facility">
            <select required value={f.destinationId} onChange={set('destinationId')}>
              <option value="">Select…</option>
              {dests.data?.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.methods.map(pretty).join(', ')})
                </option>
              ))}
            </select>
          </Field>
          {can('ADMIN') && (
            <Field label="Transporter">
              <select required value={f.transporterId} onChange={set('transporterId')}>
                <option value="">Select…</option>
                {transporters.data?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Expected arrival" hint="If the actual arrival is later than this, a delay alert is generated.">
            <input type="datetime-local" required value={f.eta} onChange={set('eta')} />
          </Field>
          <Footer close={close} busy={busy} label="Plan transport" />
        </form>
      )}
    </ModalButton>
  );
}

export function TransportStepButton({ transportId, status, onDone, small }: { transportId: string; status: 'PLANNED' | 'IN_TRANSIT'; onDone: () => void; small?: boolean }) {
  const { run, busy } = useAction(onDone);
  const next = status === 'PLANNED' ? 'IN_TRANSIT' : 'ARRIVED';
  return (
    <ConfirmButton
      small={small}
      label={status === 'PLANNED' ? 'Depart' : 'Mark arrived'}
      title={status === 'PLANNED' ? 'Start transport' : 'Confirm arrival'}
      text={status === 'PLANNED' ? 'The vehicle is leaving the facility with this waste.' : 'The vehicle has reached the treatment facility. If it is later than expected, a delay alert will be created.'}
      disabled={busy}
      onConfirm={() => run(() => api(`/transport/${transportId}`, { method: 'PATCH', body: { status: next } }), next === 'ARRIVED' ? 'Arrival recorded' : 'Transport started')}
    />
  );
}

export function RecordDisposalButton({ wasteId, onDone }: { wasteId: string; onDone: () => void }) {
  const { run, busy } = useAction(onDone);
  const dests = useFetch(() => api<TreatmentFacility[]>('/treatment-facilities'), []);
  const [f, setF] = useState({ facilityId: '', method: '', cert: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const methods = dests.data?.find((d) => d.id === f.facilityId)?.methods ?? [];
  return (
    <ModalButton label="Record treatment & disposal" title="Record treatment & disposal" primary>
      {(close) => (
        <form
          onSubmit={async (e: FormEvent) => {
            e.preventDefault();
            const body = { wasteId, method: f.method, treatmentFacilityId: f.facilityId || undefined, certificateNo: f.cert || undefined };
            if (await run(() => api('/disposals', { method: 'POST', body }), 'Disposal recorded')) close();
          }}
        >
          <Field label="Treatment facility">
            <select required value={f.facilityId} onChange={(e) => setF((s) => ({ ...s, facilityId: e.target.value, method: '' }))}>
              <option value="">Select…</option>
              {dests.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Method">
            <select required value={f.method} onChange={set('method')} disabled={!f.facilityId}>
              <option value="">Select…</option>
              {methods.map((m) => (
                <option key={m} value={m}>
                  {pretty(m)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Certificate no. (optional)">
            <input value={f.cert} onChange={set('cert')} maxLength={50} />
          </Field>
          <Footer close={close} busy={busy} label="Record disposal" />
        </form>
      )}
    </ModalButton>
  );
}

export function TransitionButton({ wasteId, to, label, text, danger, onDone }: { wasteId: string; to: string; label: string; text: string; danger?: boolean; onDone: () => void }) {
  const { run, busy } = useAction(onDone);
  return (
    <ConfirmButton
      label={label}
      title={label}
      text={text}
      danger={danger}
      disabled={busy}
      onConfirm={() => run(() => api(`/waste/${wasteId}/transition`, { method: 'POST', body: { status: to } }), `Status changed to ${pretty(to)}`)}
    />
  );
}
