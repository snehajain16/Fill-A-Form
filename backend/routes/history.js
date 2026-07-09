import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json({ history: db.getHistory(req.user.userId, limit) });
});

router.post('/', (req, res) => {
  const { entries } = req.body || {};
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
  db.appendHistory(req.user.userId, entries);
  res.json({ success: true });
});

export default router;
