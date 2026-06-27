const express = require('express');
const Airtable = require('airtable');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Expose Anthropic API key to frontend safely
app.get('/api/config', (req, res) => {
  res.json({ apiKey: process.env.ANTHROPIC_API_KEY });
});

// Create opportunity record
app.post('/api/opportunities', async (req, res) => {
  try {
    const { name, signal } = req.body;
    const record = await base('Opportunities').create({
      'Name': name,
      'Status': 'Signal Captured',
      'Signal': signal,
      'Created': new Date().toISOString().split('T')[0]
    });
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update opportunity record
app.patch('/api/opportunities/:id', async (req, res) => {
  try {
    const record = await base('Opportunities').update(req.params.id, req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all opportunities
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

// Get single opportunity
app.get('/api/opportunities/:id', async (req, res) => {
  try {
    const record = await base('Opportunities').find(req.params.id);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete opportunity
app.delete('/api/opportunities/:id', async (req, res) => {
  try {
    await base('Opportunities').destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy queue endpoint for compatibility
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
app.listen(PORT, () => console.log(`OpportunityAI server running on port ${PORT}`));
