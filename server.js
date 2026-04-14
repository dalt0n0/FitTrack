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
    return { workouts: [], bodyStats: [], nutrition: [], customFoods: [], recipes: [], settings: null, plan: null };
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
  writeDB({ workouts: [], bodyStats: [], nutrition: [], customFoods: [], recipes: [], settings: null, plan: null });
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
  if (!db.recipes) db.recipes = [];
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

// ── Food Search — USDA FoodData Central ──────────────────────────────────────
// Free API key (1000 req/hr): https://fdc.nal.usda.gov/api-key-signup.html
// Set via env:  FDC_API_KEY=your_key pm2 restart fittrack
// Or edit the fallback string below.
const FDC_API_KEY = process.env.FDC_API_KEY || 'DEMO_KEY';

const _foodCache = new Map();
const FOOD_CACHE_TTL = 10 * 60 * 1000; // 10 min

// Normalize a USDA FDC food item into the same shape parseOFFProduct() expects
function fdcToOFF(f) {
  const getNutrient = (id) => {
    // FDC can have multiple entries per nutrient ID (different derivation methods).
    // Prefer the one with the highest confidence / smallest derivation code,
    // but practically just take the first non-zero value.
    const match = (f.foodNutrients || []).find(n => n.nutrientId === id && (n.value || 0) > 0)
                || (f.foodNutrients || []).find(n => n.nutrientId === id);
    return match ? (match.value || 0) : 0;
  };

  const serving = f.servingSize || 100;
  const unit    = (f.servingSizeUnit || 'g').toLowerCase();

  // The FDC /foods/search endpoint returns nutrients per 100g for ALL food types
  // (Branded, Foundation, SR Legacy). The per-serving behavior only applies to
  // the individual /food/{fdcId} detail endpoint, not search results.
  const factor = serving / 100;

  const adjusted = {
    cal:  Math.round(getNutrient(1008) * factor),
    prot: Math.round(getNutrient(1003) * factor * 10) / 10,
    carb: Math.round(getNutrient(1005) * factor * 10) / 10,
    fat:  Math.round(getNutrient(1004) * factor * 10) / 10,
  };

  return {
    product_name: (f.description || 'Unknown').replace(/,\s*/g, ' '),
    brands:       f.brandOwner || f.brandName || '',
    serving_size: `${serving}${unit}`,
    nutriments: {
      'energy-kcal_serving':   adjusted.cal,
      'proteins_serving':      adjusted.prot,
      'carbohydrates_serving': adjusted.carb,
      'fat_serving':           adjusted.fat,
    }
  };
}

// Debug endpoint — returns raw FDC data + normalized output side-by-side
// Usage: /api/foodsearch/debug?q=chicken+breast
app.get('/api/foodsearch/debug', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ error: 'provide ?q=' });
  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&api_key=${FDC_API_KEY}&pageSize=5&dataType=Branded,Foundation,SR%20Legacy`;
  try {
    const r = await fetch(url);
    const raw = await r.json();
    const debug = (raw.foods || []).map(f => {
      const keyNutrients = (f.foodNutrients || [])
        .filter(n => [1008,1003,1005,1004].includes(n.nutrientId))
        .map(n => ({ id: n.nutrientId, name: n.nutrientName, value: n.value, unit: n.unitName }));
      return {
        fdcId: f.fdcId,
        description: f.description,
        dataType: f.dataType,
        brandOwner: f.brandOwner,
        servingSize: f.servingSize,
        servingSizeUnit: f.servingSizeUnit,
        rawNutrients: keyNutrients,
        normalized: fdcToOFF(f).nutriments,
      };
    });
    res.json(debug);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

app.get('/api/foodsearch', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ products: [] });
  res.setHeader('Cache-Control', 'no-store');

  const key = q.toLowerCase();
  const cached = _foodCache.get(key);
  if (cached && Date.now() - cached.ts < FOOD_CACHE_TTL) {
    console.log(`[foodsearch] cache hit "${q}" (${cached.data.products.length} products)`);
    return res.json(cached.data);
  }

  const url = `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(q)}&api_key=${FDC_API_KEY}&pageSize=20&dataType=Branded,Foundation,SR%20Legacy`;
  console.log(`[foodsearch] → FDC "${q}"`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`FDC HTTP ${r.status}`);
    const raw = await r.json();
    const products = (raw.foods || []).map(fdcToOFF);
    console.log(`[foodsearch] ← "${q}" ${products.length} results, first="${products[0]?.product_name ?? 'none'}"`);
    const data = { products };
    _foodCache.set(key, { ts: Date.now(), data });
    if (_foodCache.size > 300) {
      const oldest = [..._foodCache.entries()].sort((a, b) => a[1].ts - b[1].ts)[0][0];
      _foodCache.delete(oldest);
    }
    return res.json(data);
  } catch (e) {
    clearTimeout(timeout);
    console.error(`[foodsearch] ERROR "${q}": ${e.message}`);
    res.status(502).json({ error: e.message, products: [] });
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

// ── Recipes ──────────────────────────────────────
app.get('/api/recipes', (req, res) => {
  const db = readDB();
  res.json(db.recipes || []);
});

app.post('/api/recipes', (req, res) => {
  const db = readDB();
  if (!db.recipes) db.recipes = [];
  const recipe = { id: Date.now(), createdAt: new Date().toISOString().slice(0, 10), ...req.body };
  db.recipes.push(recipe);
  writeDB(db);
  res.json(recipe);
});

app.put('/api/recipes/:id', (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  const idx = (db.recipes || []).findIndex(r => r.id === id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  db.recipes[idx] = { ...req.body, id };
  writeDB(db);
  res.json(db.recipes[idx]);
});

app.delete('/api/recipes/:id', (req, res) => {
  const db = readDB();
  const id = parseInt(req.params.id);
  db.recipes = (db.recipes || []).filter(r => r.id !== id);
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
  const { workouts, bodyStats, nutrition, customFoods, recipes, settings, plan } = req.body;
  writeDB({
    workouts: workouts || [],
    bodyStats: bodyStats || [],
    nutrition: nutrition || [],
    customFoods: customFoods || [],
    recipes: recipes || [],
    settings: settings || null,
    plan: plan || null
  });
  res.json({ ok: true });
});

// ── Start ────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`FitTrack running at http://localhost:${PORT}`);
});
