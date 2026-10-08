import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout, NAV } from './components/Layout';
import { Skeleton } from './components/ui';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import WasteList from './pages/WasteList';
import WasteDetailPage from './pages/WasteDetail';
import { Collections, Disposals, Transport } from './pages/Workflows';
import Alerts from './pages/Alerts';
import AuditLogs from './pages/AuditLogs';
import Facilities from './pages/Facilities';
import Settings from './pages/Settings';
import Analytics from './pages/Analytics';
import Assistant from './pages/Assistant';

export default function App() {
  const { user, loading } = useAuth();
  if (loading)
    return (
      <div style={{ padding: 40 }}>
        <Skeleton rows={4} />
      </div>
    );
  if (!user)
    return (
      <Routes>
        <Route path="*" element={<Login />} />
      </Routes>
    );
  const home = NAV.find((n) => !n.roles || n.roles.includes(user.role))!.to;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/waste" element={<WasteList />} />
        <Route path="/waste/:id" element={<WasteDetailPage />} />
        <Route path="/collections" element={<Collections />} />
        <Route path="/transport" element={<Transport />} />
        <Route path="/disposals" element={<Disposals />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/audit" element={<AuditLogs />} />
        <Route path="/facilities" element={<Facilities />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
