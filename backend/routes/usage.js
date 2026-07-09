import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { db } from '../db.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(db.getUsage(req.user.userId));
});

// Enterprise API — record a fill via the backend
router.post('/fill', (req, res) => {
  const { settings } = db.getUsage(req.user.userId);
  const FREE_LIMIT = 20;
  if (!settings?.isPremium && (settings?.fillCount || 0) >= FREE_LIMIT) {
    return res.status(402).json({ error: 'LIMIT_REACHED' });
  }
  db.incrementFillCount(req.user.userId);
  res.json({ success: true });
});

export default router;
