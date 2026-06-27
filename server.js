const express = require('express');
const Airtable = require('airtable');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Expose API key to frontend
app.get('/api/config', (req, res) => {
  res.json({ apiKey: process.env.ANTHROPIC_API_KEY });
});

// ─── OPPORTUNITIES ────────────────────────────────────────────────────────────
app.post('/api/opportunities', async (req, res) => {
  try {
    const { name, signal, sourceTrend } = req.body;
    const fields = {
      'Name': name,
      'Status': 'Signal Captured',
      'Signal': signal,
      'Created': new Date().toISOString().split('T')[0]
    };
    if (sourceTrend) fields['Source Trend'] = sourceTrend;
    const record = await base('Opportunities').create(fields);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/opportunities/:id', async (req, res) => {
  try {
    const record = await base('Opportunities').update(req.params.id, req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/opportunities', async (req, res) => {
  try {
    const records = await base('Opportunities').select({
      sort: [{ field: 'Created', direction: 'desc' }]
    }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/opportunities/:id', async (req, res) => {
  try {
    const record = await base('Opportunities').find(req.params.id);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/opportunities/:id', async (req, res) => {
  try {
    await base('Opportunities').destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── TRENDS ───────────────────────────────────────────────────────────────────
app.post('/api/trends', async (req, res) => {
  try {
    const record = await base('Trends').create(req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/trends/:id', async (req, res) => {
  try {
    const record = await base('Trends').update(req.params.id, req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/trends', async (req, res) => {
  try {
    const records = await base('Trends').select({
      sort: [{ field: 'Date Identified', direction: 'desc' }]
    }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/trends/:id', async (req, res) => {
  try {
    await base('Trends').destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LEGACY ENDPOINTS ─────────────────────────────────────────────────────────
app.get('/api/queue', async (req, res) => {
  try {
    const records = await base('Opportunities').select({
      sort: [{ field: 'Created', direction: 'desc' }]
    }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/queue/:id', async (req, res) => {
  try {
    const { status, notes } = req.body;
    const fields = { 'Status': status };
    if (notes) fields['Orchestrator Summary'] = notes;
    await base('Opportunities').update(req.params.id, fields);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/queue/:id', async (req, res) => {
  try {
    await base('Opportunities').destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`OpportunityAI running on port ${PORT}`));
