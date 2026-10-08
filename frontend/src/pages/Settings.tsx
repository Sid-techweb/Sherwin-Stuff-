import { useAuth } from '../auth';
import { api } from '../api';
import { Badge, Card, PageHead } from '../components/ui';
import { useFetch } from '../hooks';
import { pretty } from '../types';

interface Health {
  status: string;
  database: boolean;
  redis: boolean;
  time: string;
}

export default function Settings() {
  const { user, logout } = useAuth();
  const health = useFetch(() => api<Health>('/health'), []);
  const h = health.data;
  return (
    <>
      <PageHead title="Settings" subtitle="Your account and system status" />
      <div className="grid two">
        <Card title="Profile">
          <dl className="detail-grid">
            <div><dt>Name</dt><dd>{user?.name}</dd></div>
            <div><dt>Email</dt><dd>{user?.email}</dd></div>
            <div><dt>Role</dt><dd>{user && pretty(user.role)}</dd></div>
          </dl>
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={logout}>Sign out</button>
          </div>
        </Card>
        <Card title="System status" actions={<button className="btn sm" onClick={health.reload}>Refresh</button>}>
          {h ? (
            <dl className="detail-grid">
              <div><dt>API</dt><dd><Badge value={h.status === 'ok' ? 'Healthy' : h.status} tone={h.status === 'down' ? 'red' : h.status === 'degraded' ? 'amber' : 'green'} /></dd></div>
              <div><dt>PostgreSQL</dt><dd><Badge value={h.database ? 'Connected' : 'Down'} tone={h.database ? 'green' : 'red'} /></dd></div>
              <div><dt>Redis cache</dt><dd><Badge value={h.redis ? 'Connected' : 'Unavailable'} tone={h.redis ? 'green' : 'amber'} /></dd></div>
            </dl>
          ) : (
            <p className="muted">{health.error ?? 'Checking…'}</p>
          )}
          <p className="muted" style={{ marginTop: 12 }}>If Redis is unavailable the app keeps working directly from PostgreSQL (just slower).</p>
        </Card>
      </div>
    </>
  );
}
