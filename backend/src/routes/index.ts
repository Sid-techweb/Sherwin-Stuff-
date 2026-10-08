import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { rateLimit } from '../middleware/rateLimit';
import { config } from '../config';
import { asyncHandler as h } from '../utils/asyncHandler';
import * as c from '../controllers';

const router = Router();

// Public
router.get('/health', h(c.health));
router.post('/auth/login', rateLimit('login', () => config.rateLimit.loginMax, config.rateLimit.windowSeconds), h(c.login));

// Everything below requires a valid token
router.use(authenticate);

router.get('/auth/me', h(c.profile));
router.post('/auth/register', requireRole('ADMIN'), h(c.register));

// Waste records
router.get('/waste', h(c.wasteList));
router.post('/waste', requireRole('ADMIN', 'HOSPITAL_STAFF'), h(c.wasteCreate));
router.get('/waste/:id', h(c.wasteGet));
router.patch('/waste/:id', requireRole('ADMIN', 'HOSPITAL_STAFF'), h(c.wasteUpdate));
router.delete('/waste/:id', requireRole('ADMIN'), h(c.wasteDelete));
router.post('/waste/:id/transition', requireRole('ADMIN', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'), h(c.wasteTransition));

// Collections (fine-grained permission for PATCH is decided by the body: assign vs complete)
router.get('/collections', h(c.collectionList));
router.post('/collections', requireRole('ADMIN', 'HOSPITAL_STAFF'), h(c.collectionCreate));
router.get('/collections/:id', h(c.collectionGet));
router.patch('/collections/:id', requireRole('ADMIN', 'HOSPITAL_STAFF', 'WASTE_COLLECTOR'), h(c.collectionPatch));

// Transport
router.get('/transport', h(c.transportList));
router.post('/transport', requireRole('ADMIN', 'TRANSPORTER'), h(c.transportCreate));
router.get('/transport/:id', h(c.transportGet));
router.patch('/transport/:id', requireRole('ADMIN', 'TRANSPORTER'), h(c.transportPatch));

// Disposal
router.get('/disposals', h(c.disposalList));
router.post('/disposals', requireRole('ADMIN', 'TREATMENT_OPERATOR'), h(c.disposalCreate));

// Reference data
router.get('/facilities', h(c.facilities));
router.get('/treatment-facilities', h(c.treatmentFacilities));
router.get('/vehicles', h(c.vehicles));
router.get('/categories', h(c.categories));
router.get('/users', requireRole('ADMIN', 'HOSPITAL_STAFF'), h(c.users));

// Alerts
router.get('/alerts', requireRole('ADMIN', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR', 'AUDITOR'), h(c.alertList));
router.post('/alerts', requireRole('ADMIN', 'HOSPITAL_STAFF', 'TRANSPORTER'), h(c.alertCreate));
router.post('/alerts/scan', requireRole('ADMIN'), h(c.alertScan));
router.get('/alerts/scan/last', requireRole('ADMIN', 'AUDITOR'), h(c.alertLastScan));
router.patch('/alerts/:id', requireRole('ADMIN', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'), h(c.alertPatch));

// Analytics & audit
router.get('/analytics/dashboard', requireRole('ADMIN', 'AUDITOR', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'), h(c.dashboard));
router.get('/analytics/operational', requireRole('ADMIN', 'AUDITOR', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'), h(c.operationalMetrics));
router.get('/audit-logs', requireRole('ADMIN', 'AUDITOR'), h(c.auditLogs));

// AI assistant (same roles as the dashboard; tools run as the calling user so scoping still applies)
const aiRoles = ['ADMIN', 'AUDITOR', 'HOSPITAL_STAFF', 'TREATMENT_OPERATOR'] as const;
router.get('/ai/status', requireRole(...aiRoles), h(c.aiStatus));
router.post('/ai/chat', requireRole(...aiRoles), rateLimit('ai', () => config.ai.rateLimitMax, config.rateLimit.windowSeconds), h(c.aiChat));
router.get('/ai/memories', requireRole('ADMIN', 'AUDITOR'), h(c.aiMemories));

export default router;
