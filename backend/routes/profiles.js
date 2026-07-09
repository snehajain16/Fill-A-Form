import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({ profiles: db.getProfiles(req.user.userId) });
});

router.put('/', (req, res) => {
  const { profiles } = req.body || {};
  if (!Array.isArray(profiles)) return res.status(400).json({ error: 'profiles must be an array' });
  db.upsertProfiles(req.user.userId, profiles);
  res.json({ success: true, count: profiles.length });
});

export default router;
