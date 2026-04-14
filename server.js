const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// ── Init DB ──────────────────────────────────────
function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    return { workouts: [], bodyStats: [], nutrition: [], customFoods: [], settings: null, plan: null };
  }
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

// Ensure data dir and db file exist
if (!fs.existsSync(path.dirname(DB_PATH))) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
}
if (!fs.existsSync(DB_PATH)) {
  writeDB({ workouts: [], bodyStats: [], nutrition: [], customFoods: [], settings: null, plan: null });
}

// ── Middleware ───────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ───────────────────────────────────────

// GET all data (initial load)
app.get('/api/data', (req, res) => {
  const db = readDB();
  if (!db.settings) db.settings = { calories: 1850, protein: 200, carbs: 160, fat: 55, targetWeight: 220, height: '6\'1"' };
  if (!db.customFoods) db.customFoods = [];
  res.json(db);
});

// ── Workouts ─────────────────────────────────────
app.get('/api/workouts', (req, res) => {
  res.json(readDB().workouts);
});

app.post('/api/workouts', (req, res) => {
  const db = readDB();
  const workout = { id: Date.now(), ...req.body };
  db.workouts.push(workout);
  writeDB(db);
  res.json(workout);
});

app.delete('/api/workouts/:id', (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  db.workouts = db.workouts.filter(w => w.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

// ── Body Stats ───────────────────────────────────
app.get('/api/bodystats', (req, res) => {
  res.json(readDB().bodyStats);
});

app.post('/api/bodystats', (req, res) => {
  const db = readDB();
  const entry = { id: Date.now(), ...req.body };
  const existing = db.bodyStats.findIndex(e => e.date === entry.date);
  if (existing >= 0) {
    db.bodyStats[existing] = entry;
  } else {
    db.bodyStats.push(entry);
  }
  writeDB(db);
  res.json(entry);
});

app.delete('/api/bodystats/:id', (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  db.bodyStats = db.bodyStats.filter(e => e.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

// ── Nutrition ────────────────────────────────────
app.get('/api/nutrition', (req, res) => {
  res.json(readDB().nutrition);
});

app.post('/api/nutrition', (req, res) => {
  const db = readDB();
  const entry = { ...req.body };
  const existing = db.nutrition.findIndex(n => n.date === entry.date);
  if (existing >= 0) {
    db.nutrition[existing] = entry;
  } else {
    db.nutrition.push(entry);
  }
  writeDB(db);
  res.json(entry);
});

app.delete('/api/nutrition/:date', (req, res) => {
  const db = readDB();
  db.nutrition = db.nutrition.filter(n => n.date !== req.params.date);
  writeDB(db);
  res.json({ ok: true });
});

// ── Settings ─────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const db = readDB();
  res.json(db.settings || { calories: 1850, protein: 200, carbs: 160, fat: 55, targetWeight: 220, height: '6\'1"' });
});

app.put('/api/settings', (req, res) => {
  const db = readDB();
  db.settings = req.body;
  writeDB(db);
  res.json(db.settings);
});

// ── Food Search Proxy ─────────────────────────────
// OFF rate limit: 10 req/min — enforce ≥7s between actual OFF calls
const _foodCache = new Map();
const FOOD_CACHE_TTL = 10 * 60 * 1000;
const OFF_MIN_INTERVAL = 7000;
let _lastOFFCall = 0;

app.get('/api/foodsearch', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ products: [] });
  res.setHeader('Cache-Control', 'no-store');

  const key = q.toLowerCase();
  const cached = _foodCache.get(key);
  if (cached && Date.now() - cached.ts < FOOD_CACHE_TTL) {
    console.log(`[foodsearch] CACHE HIT "${q}" (${cached.data.products?.length ?? 0} products)`);
    return res.json(cached.data);
  }

  // Rate-limit gate
  const gap = (_lastOFFCall + OFF_MIN_INTERVAL) - Date.now();
  if (gap > 0) {
    console.log(`[foodsearch] rate-limit wait ${gap}ms for "${q}"`);
    await new Promise(r => setTimeout(r, gap));
  }
  _lastOFFCall = Date.now();

  const url = `https://world.openfoodfacts.org/api/v2/search?search_terms=${encodeURIComponent(q)}&page_size=20&fields=product_name,brands,nutriments,serving_size&json=true`;
  console.log(`[foodsearch] → OFF "${q}"`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const r = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'FitTrack/1.0 (https://github.com/dalt0n0/FitTrack; self-hosted)' }
    });
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`OFF HTTP ${r.status}`);
    const data = await r.json();
    const count = data.products?.length ?? 0;
    const firstName = data.products?.[0]?.product_name ?? 'n/a';
    console.log(`[foodsearch] ← "${q}" got ${count} products, first="${firstName}"`);
    _foodCache.set(key, { ts: Date.now(), data });
    if (_foodCache.size > 300) {
      const oldest = [..._foodCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0][0];
      _foodCache.delete(oldest);
    }
    return res.json(data);
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[foodsearch] ERROR "${q}": ${e.message}`);
    res.status(502).json({ error: e.message || 'Food search unavailable', products: [] });
  }
});

// Quick connectivity test — hit this from the server to verify OFF is reachable
app.get('/api/foodsearch/test', async (req, res) => {
  try {
    const r = await fetch('https://world.openfoodfacts.org/api/v2/search?search_terms=apple&page_size=1&fields=product_name&json=true', {
      headers: { 'User-Agent': 'FitTrack/1.0 (connectivity-test)' }
    });
    const text = await r.text();
    res.json({ status: r.status, ok: r.ok, bodySnippet: text.slice(0, 200) });
  } catch (e) {
    res.status(502).json({ error: e.message, stack: e.stack });
  }
});

// ── Custom Foods ─────────────────────────────────
app.get('/api/customfoods', (req, res) => {
  const db = readDB();
  res.json(db.customFoods || []);
});

app.post('/api/customfoods', (req, res) => {
  const db = readDB();
  if (!db.customFoods) db.customFoods = [];
  const food = { id: Date.now(), createdAt: new Date().toISOString().slice(0, 10), ...req.body };
  db.customFoods.push(food);
  writeDB(db);
  res.json(food);
});

app.put('/api/customfoods/:id', (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  const idx = (db.customFoods || []).findIndex(f => f.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.customFoods[idx] = { ...req.body, id };
  writeDB(db);
  res.json(db.customFoods[idx]);
});

app.delete('/api/customfoods/:id', (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  db.customFoods = (db.customFoods || []).filter(f => f.id !== id);
  writeDB(db);
  res.json({ ok: true });
});

// ── Plan ─────────────────────────────────────────
app.get('/api/plan', (req, res) => {
  res.json(readDB().plan || null);
});

app.put('/api/plan', (req, res) => {
  const db = readDB();
  db.plan = req.body;
  writeDB(db);
  res.json(db.plan);
});

// ── Export / Import ──────────────────────────────
app.get('/api/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="fittrack-backup.json"');
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(readDB(), null, 2));
});

app.post('/api/import', (req, res) => {
  const { workouts, bodyStats, nutrition, customFoods, settings, plan } = req.body;
  writeDB({
    workouts: workouts || [],
    bodyStats: bodyStats || [],
    nutrition: nutrition || [],
    customFoods: customFoods || [],
    settings: settings || null,
    plan: plan || null
  });
  res.json({ ok: true });
});

// ── Start ────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FitTrack running at http://localhost:${PORT}`);
});
