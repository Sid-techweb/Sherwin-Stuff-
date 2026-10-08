import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { Field } from '../components/ui';

const DEMO = [
  ['Admin', 'admin@bmw.demo'],
  ['Hospital staff', 'staff.dgh@bmw.demo'],
  ['Collector', 'collector1@bmw.demo'],
  ['Transporter', 'transporter1@bmw.demo'],
  ['Treatment operator', 'operator@bmw.demo'],
  ['Auditor', 'auditor@bmw.demo'],
];

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-hero">
        <div className="logo" style={{ width: 48, height: 48, fontSize: 28, marginBottom: 20 }}>
          +
        </div>
        <h2>Biomedical Waste Tracking &amp; Compliance</h2>
        <p>From the ward to final disposal, every kilogram accounted for.</p>
        <ul>
          <li>Segregation → collection → transport → treatment → closure</li>
          <li>Role-based access with a tamper-resistant audit trail</li>
          <li>Live alerts for delays, overdue pickups and missing disposals</li>
        </ul>
      </div>
      <div className="login-form">
        <form className="login-box" onSubmit={submit}>
          <h1 style={{ marginBottom: 4 }}>Sign in</h1>
          <p className="muted" style={{ marginBottom: 18 }}>
            Use your organisation account.
          </p>
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          <Field label="Email">
            <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="Password">
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <div className="demo-users">
            <p className="muted">Demo accounts (synthetic data, password Demo@1234):</p>
            {DEMO.map(([label, mail]) => (
              <button
                type="button"
                key={mail}
                className="btn sm"
                onClick={() => {
                  setEmail(mail);
                  setPassword('Demo@1234');
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
