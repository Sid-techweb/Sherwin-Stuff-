import { api } from '../api';
import { Badge, Card, ErrorBox, PageHead, Skeleton } from '../components/ui';
import { useFetch } from '../hooks';
import { Category, Facility, pretty, TreatmentFacility, Vehicle } from '../types';

export default function Facilities() {
  const fac = useFetch(() => api<Facility[]>('/facilities'), []);
  const tf = useFetch(() => api<TreatmentFacility[]>('/treatment-facilities'), []);
  const veh = useFetch(() => api<Vehicle[]>('/vehicles'), []);
  const cat = useFetch(() => api<Category[]>('/categories'), []);
  const err = fac.error ?? tf.error ?? veh.error ?? cat.error;
  return (
    <>
      <PageHead title="Facilities & fleet" subtitle="Waste generators, treatment sites, vehicles and waste categories" />
      {err && <ErrorBox message={err} />}
      <Card title="Waste-generating facilities">
        {!fac.data ? (
          <Skeleton rows={4} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>City</th></tr></thead>
              <tbody>
                {fac.data.map((f) => (
                  <tr key={f.id}><td className="mono">{f.code}</td><td>{f.name}</td><td>{pretty(f.type)}</td><td>{f.city}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <div className="grid two">
        <Card title="Treatment facilities">
          {!tf.data ? (
            <Skeleton rows={3} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Methods</th><th>Capacity</th></tr></thead>
                <tbody>
                  {tf.data.map((f) => (
                    <tr key={f.id}><td>{f.name}</td><td>{f.methods.map(pretty).join(', ')}</td><td>{f.capacityKgPerDay} kg/day</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title="Vehicles">
          {!veh.data ? (
            <Skeleton rows={3} />
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Registration</th><th>Type</th><th>Capacity</th><th>Status</th></tr></thead>
                <tbody>
                  {veh.data.map((v) => (
                    <tr key={v.id}><td className="mono">{v.registration}</td><td>{v.type}</td><td>{v.capacityKg} kg</td><td><Badge value={v.status} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <Card title="Waste categories (colour-coded segregation)">
        {!cat.data ? (
          <Skeleton rows={3} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Category</th><th>Default treatment</th><th>Max storage</th><th>Alert above</th></tr></thead>
              <tbody>
                {cat.data.map((c) => (
                  <tr key={c.id}>
                    <td><span className="dot" style={{ background: c.color }} />{c.name}</td>
                    <td>{pretty(c.defaultMethod)}</td>
                    <td>{c.maxStorageHours} h</td>
                    <td>{c.alertQuantityKg} kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
