const express = require('express');
const Airtable = require('airtable');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, PageBreak } = require('docx');

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

// ─── WORD DOC EXPORT ──────────────────────────────────────────────────────────
app.get('/api/opportunities/:id/export', async (req, res) => {
  try {
    const record = await base('Opportunities').find(req.params.id);
    const item = { id: record.id, ...record.fields };

    const name = item['Name'] || 'Opportunity Blueprint';
    const score = item['Opportunity Score'];
    const aiScore = item['AI Executability Score'];
    const sourceTrend = item['Source Trend'] || '';
    const created = item['Created'] || '';

    const divider = new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '00C896', space: 1 } },
      spacing: { before: 300, after: 300 },
      children: []
    });

    function h1(text) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text, bold: true, size: 36, font: 'Arial', color: '0F1117' })],
        spacing: { before: 400, after: 200 }
      });
    }

    function h2(text) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text, bold: true, size: 26, font: 'Arial', color: '00C896' })],
        spacing: { before: 300, after: 150 }
      });
    }

    function body(text) {
      if (!text) return [];
      // Convert markdown to paragraphs
      return text.split('\n').filter(line => line.trim()).map(line => {
        const isBold = line.startsWith('**') || line.startsWith('###') || line.startsWith('##') || line.startsWith('#');
        const clean = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
        if (!clean) return null;
        return new Paragraph({
          children: [new TextRun({
            text: clean,
            size: 22,
            font: 'Arial',
            bold: isBold,
            color: '1D1D1F'
          })],
          spacing: { after: 120 }
        });
      }).filter(Boolean);
    }

    const SECTIONS = [
      { label: 'Orchestrator Summary & Blueprint', field: 'Orchestrator Summary' },
      { label: 'AI Executability Analysis', field: 'AI Executability Notes' },
      { label: 'Market Analysis', field: 'Market Analysis' },
      { label: 'Competitive Landscape', field: 'Competitive Landscape' },
      { label: 'Target Customer', field: 'Target Customer' },
      { label: 'Business Model', field: 'Business Model' },
      { label: 'Revenue Projections', field: 'Revenue Projections' },
      { label: 'Financial Analysis', field: 'Financial Analysis' },
      { label: 'Brand Name & Positioning', field: 'Brand Name & Positioning' },
      { label: 'Brand Identity Direction', field: 'Brand Identity Direction' },
      { label: 'GTM Plan', field: 'GTM Plan' },
      { label: 'AI Stack Plan', field: 'AI Stack Plan' },
      { label: 'Execution Roadmap', field: 'Execution Roadmap' },
      { label: 'Risks & Challenges', field: 'Risks & Challenges' },
    ];

    const children = [
      // Cover
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 800, after: 200 },
        children: [new TextRun({ text: 'OPPORTUNITY LAUNCH BLUEPRINT', bold: true, size: 48, font: 'Arial', color: '0F1117' })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: name, bold: true, size: 36, font: 'Arial', color: '00C896' })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: `Overall Score: ${score ? score + '/10' : 'Pending'} | AI Executability: ${aiScore ? aiScore + '/10' : 'Pending'}`, size: 24, font: 'Arial', color: '666666' })]
      }),
      ...(sourceTrend ? [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 },
        children: [new TextRun({ text: `Source Trend: ${sourceTrend}`, size: 22, font: 'Arial', color: '8B5CF6' })]
      })] : []),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 600 },
        children: [new TextRun({ text: `Generated: ${created} | QLMAgentic OpportunityAI`, size: 20, font: 'Arial', color: '999999' })]
      }),
      divider,
    ];

    // Add each section
    for (const sec of SECTIONS) {
      const content = item[sec.field];
      if (!content || content.trim() === '') continue;

      children.push(
        new Paragraph({ children: [new PageBreak()] }),
        h2(sec.label),
        divider,
        ...body(content),
      );
    }

    // Footer
    children.push(
      divider,
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 400 },
        children: [new TextRun({ text: `QLMAgentic · OpportunityAI · ${created} · Confidential`, size: 18, font: 'Arial', color: '999999' })]
      })
    );

    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } },
        paragraphStyles: [
          { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 36, bold: true, font: 'Arial', color: '0F1117' },
            paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
          { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
            run: { size: 26, bold: true, font: 'Arial', color: '00C896' },
            paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
        ]
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = name.replace(/[^a-z0-9]/gi, '_').substring(0, 50);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_Blueprint.docx"`);
    res.send(buffer);

  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── ACQUISITIONS ─────────────────────────────────────────────────────────────
app.post('/api/acquisitions', async (req, res) => {
  try {
    const { name, source } = req.body;
    const fields = {
      'Name': name,
      'Status': 'Signal Captured',
      'Source': source || '',
      'Created': new Date().toISOString().split('T')[0]
    };
    const record = await base('Acquisitions').create(fields);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/acquisitions/:id', async (req, res) => {
  try {
    const record = await base('Acquisitions').update(req.params.id, req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/acquisitions', async (req, res) => {
  try {
    const records = await base('Acquisitions').select({
      sort: [{ field: 'Created', direction: 'desc' }]
    }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/acquisitions/:id', async (req, res) => {
  try {
    const record = await base('Acquisitions').find(req.params.id);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/acquisitions/:id', async (req, res) => {
  try {
    await base('Acquisitions').destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Acquisition Word Doc Export
app.get('/api/acquisitions/:id/export', async (req, res) => {
  try {
    const record = await base('Acquisitions').find(req.params.id);
    const item = { id: record.id, ...record.fields };
    const name = item['Name'] || 'Acquisition Blueprint';
    const score = item['Opportunity Score'];
    const fundingTier = item['Funding Tier'] || '';
    const created = item['Created'] || '';

    const divider = new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '6366F1', space: 1 } },
      spacing: { before: 300, after: 300 },
      children: []
    });

    function h2(text) {
      return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun({ text, bold: true, size: 26, font: 'Arial', color: '6366F1' })],
        spacing: { before: 300, after: 150 }
      });
    }

    function body(text) {
      if (!text) return [];
      return text.split('\n').filter(l => l.trim()).map(line => {
        const isBold = line.startsWith('**') || line.startsWith('#');
        const clean = line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
        if (!clean) return null;
        return new Paragraph({ children: [new TextRun({ text: clean, size: 22, font: 'Arial', bold: isBold, color: '1D1D1F' })], spacing: { after: 120 } });
      }).filter(Boolean);
    }

    const SECTIONS = [
      { label: 'Orchestrator Summary & Acquisition Blueprint', field: 'Orchestrator Summary' },
      { label: 'Business Profile', field: 'Business Profile' },
      { label: 'Acquirability Signals', field: 'Acquirability Signals' },
      { label: 'AI Executability Analysis', field: 'AI Executability Notes' },
      { label: 'Market Analysis', field: 'Market Analysis' },
      { label: 'Business Architecture', field: 'Business Architecture' },
      { label: 'Acquisition Strategy', field: 'Acquisition Strategy' },
      { label: 'Brand Assessment', field: 'Brand Assessment' },
      { label: 'GTM Plan', field: 'GTM Plan' },
      { label: 'AI Transformation Plan', field: 'AI Transformation Plan' },
      { label: 'Investor Summary', field: 'Investor Summary' },
      { label: 'Pitch Deck Outline', field: 'Pitch Deck Outline' },
    ];

    const children = [
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 800, after: 200 }, children: [new TextRun({ text: 'ACQUISITION BLUEPRINT', bold: true, size: 48, font: 'Arial', color: '0F1117' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: name, bold: true, size: 36, font: 'Arial', color: '6366F1' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [new TextRun({ text: `Overall Score: ${score ? score + '/10' : 'Pending'} | ${fundingTier}`, size: 24, font: 'Arial', color: '666666' })] }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [new TextRun({ text: `Generated: ${created} | QLMAgentic OpportunityAI`, size: 20, font: 'Arial', color: '999999' })] }),
      divider,
    ];

    for (const sec of SECTIONS) {
      const content = item[sec.field];
      if (!content || content.trim() === '') continue;
      children.push(new Paragraph({ children: [new PageBreak()] }), h2(sec.label), divider, ...body(content));
    }

    children.push(divider, new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400 }, children: [new TextRun({ text: `QLMAgentic · OpportunityAI · ${created} · Confidential`, size: 18, font: 'Arial', color: '999999' })] }));

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
      sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }]
    });

    const buffer = await Packer.toBuffer(doc);
    const filename = name.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}_Acquisition_Blueprint.docx"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
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

// ─── CONSUMER PROBLEMS ───────────────────────────────────────────────────────
app.post('/api/consumerproblems', async (req, res) => {
  try {
    const record = await base('ConsumerProblems').create(req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/consumerproblems/:id', async (req, res) => {
  try {
    const record = await base('ConsumerProblems').update(req.params.id, req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/consumerproblems', async (req, res) => {
  try {
    const records = await base('ConsumerProblems').select({
      sort: [{ field: 'Date Identified', direction: 'desc' }]
    }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/consumerproblems/:id', async (req, res) => {
  try {
    await base('ConsumerProblems').destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── HOT PRODUCTS ─────────────────────────────────────────────────────────────
app.post('/api/hotproducts', async (req, res) => {
  try {
    const record = await base('HotProducts').create(req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/hotproducts/:id', async (req, res) => {
  try {
    const record = await base('HotProducts').update(req.params.id, req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/hotproducts', async (req, res) => {
  try {
    const records = await base('HotProducts').select({
      sort: [{ field: 'Date Identified', direction: 'desc' }]
    }).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/hotproducts/:id', async (req, res) => {
  try {
    await base('HotProducts').destroy(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PIPELINE LOGS ────────────────────────────────────────────────────────────
app.post('/api/pipelinelogs', async (req, res) => {
  try {
    const record = await base('PipelineLogs').create(req.body);
    res.json({ id: record.id, ...record.fields });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/pipelinelogs', async (req, res) => {
  try {
    const opts = { sort: [{ field: 'Run Date', direction: 'desc' }], maxRecords: 200 };
    if (req.query.opportunityId) {
      opts.filterByFormula = `{Opportunity ID} = '${req.query.opportunityId}'`;
    }
    const records = await base('PipelineLogs').select(opts).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── LEGACY ───────────────────────────────────────────────────────────────────
app.get('/api/queue', async (req, res) => {
  try {
    const records = await base('Opportunities').select({ sort: [{ field: 'Created', direction: 'desc' }] }).all();
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
