import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import authRoutes from './routes/auth.js';
import profileRoutes from './routes/profiles.js';
import historyRoutes from './routes/history.js';
import usageRoutes from './routes/usage.js';
import { requireAuth } from './middleware/auth.js';
import { db } from './db.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '2mb' }));

// rate limiting
app.use('/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many requests' } }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 60, message: { error: 'Too many requests' } }));

// routes
app.use('/auth', authRoutes);
app.use('/api/profiles', profileRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/usage', usageRoutes);

// sync endpoint — receives profiles + history from extension in one call
app.post('/api/sync', requireAuth, (req, res) => {
  const { profiles, history } = req.body || {};
  if (Array.isArray(profiles)) db.upsertProfiles(req.user.userId, profiles);
  if (Array.isArray(history)) db.appendHistory(req.user.userId, history);
  res.json({ success: true });
});

// enterprise API key auth (for government/healthcare integrations)
app.post('/enterprise/autofill-request', (req, res) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.ENTERPRISE_API_KEY) {
    return res.status(401).json({ error: 'Invalid enterprise API key' });
  }
  // proxy to Claude — enterprise clients send fields, we handle API key centrally
  res.json({ message: 'Enterprise autofill endpoint — implement Claude proxy here' });
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Fill-A-Form backend running on port ${PORT}`));
