import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuid } from 'crypto';
import { db } from '../db.js';
import { signToken } from '../middleware/auth.js';

// crypto.randomUUID is available in Node 14.17+
function newId() { return crypto.randomUUID(); }

const router = Router();

router.post('/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  if (db.findUserByEmail(email)) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const user = db.createUser({ id: newId(), email, password: hash, fillCount: 0, isPremium: false, createdAt: new Date().toISOString() });
  const token = signToken({ userId: user.id, email: user.email });
  res.status(201).json({ token, user: { id: user.id, email: user.email, isPremium: user.isPremium } });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.findUserByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = signToken({ userId: user.id, email: user.email });
  res.json({ token, user: { id: user.id, email: user.email, isPremium: user.isPremium } });
});

export default router;
