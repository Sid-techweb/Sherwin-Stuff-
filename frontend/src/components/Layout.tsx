import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth';
import { Role } from '../types';
import { pretty } from '../types';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  roles?: Role[];
}

export const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '▦', roles: ['ADMIN', 'AUDITOR', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'] },
  { to: '/waste', label: 'Waste records', icon: '☣' },
  { to: '/collections', label: 'Collections', icon: '⛟' },
  { to: '/transport', label: 'Transportation', icon: '➜' },
  { to: '/disposals', label: 'Disposal / treatment', icon: '♻' },
  { to: '/analytics', label: 'Analytics', icon: '↗', roles: ['ADMIN', 'AUDITOR', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'] },
  { to: '/assistant', label: 'AI assistant', icon: '✦', roles: ['ADMIN', 'AUDITOR', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'] },
  { to: '/alerts', label: 'Alerts', icon: '⚠', roles: ['ADMIN', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR', 'AUDITOR'] },
  { to: '/audit', label: 'Audit logs', icon: '☰', roles: ['ADMIN', 'AUDITOR'] },
  { to: '/facilities', label: 'Facilities & fleet', icon: '⌂' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => !n.roles || (user && n.roles.includes(user.role)));
  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="logo">+</div>
          <div>
            BMW Tracker
            <div style={{ fontSize: 11, fontWeight: 400, opacity: 0.7 }}>Biomedical waste compliance</div>
          </div>
        </div>
        <nav className="nav" aria-label="Main">
          {items.map((n) => (
            <NavLink key={n.to} to={n.to} onClick={() => setOpen(false)} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span aria-hidden>{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <strong>{user?.name}</strong>
          <span>{user && pretty(user.role)}</span>
          <div style={{ marginTop: 8 }}>
            <button className="btn sm" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="btn sm" onClick={() => setOpen((o) => !o)} aria-label="Toggle menu">
            ☰
          </button>
          <strong>BMW Tracker</strong>
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
