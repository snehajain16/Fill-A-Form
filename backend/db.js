/**
 * Simple JSON file store. Swap for Postgres/SQLite in production.
 * All writes are atomic (write-then-rename) to avoid corruption.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = path.join(__dirname, 'data.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch {
    return { users: [], profiles: [], history: [] };
  }
}

function save(data) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

export const db = {
  // users
  findUserByEmail(email) {
    return load().users.find(u => u.email === email) || null;
  },
  findUserById(id) {
    return load().users.find(u => u.id === id) || null;
  },
  createUser(user) {
    const data = load();
    data.users.push(user);
    save(data);
    return user;
  },

  // profiles
  getProfiles(userId) {
    return load().profiles.filter(p => p.userId === userId);
  },
  upsertProfiles(userId, profiles) {
    const data = load();
    data.profiles = data.profiles.filter(p => p.userId !== userId);
    profiles.forEach(p => data.profiles.push({ ...p, userId }));
    save(data);
  },

  // history
  getHistory(userId, limit = 100) {
    return load().history.filter(h => h.userId === userId).slice(0, limit);
  },
  appendHistory(userId, entries) {
    const data = load();
    entries.forEach(e => data.history.unshift({ ...e, userId }));
    if (data.history.filter(h => h.userId === userId).length > 500) {
      const others = data.history.filter(h => h.userId !== userId);
      const mine = data.history.filter(h => h.userId === userId).slice(0, 500);
      data.history = [...mine, ...others];
    }
    save(data);
  },

  // usage
  getUsage(userId) {
    const data = load();
    const user = data.users.find(u => u.id === userId);
    return { fillCount: user?.fillCount || 0, isPremium: user?.isPremium || false };
  },
  incrementFillCount(userId) {
    const data = load();
    const user = data.users.find(u => u.id === userId);
    if (user) user.fillCount = (user.fillCount || 0) + 1;
    save(data);
  },
};
