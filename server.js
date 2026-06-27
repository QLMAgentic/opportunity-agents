const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const Airtable = require('airtable');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const BUFFER_API_KEY = process.env.BUFFER_API_KEY;
const BUFFER_ORG_ID = process.env.BUFFER_ORG_ID;

async function pushToBuffer(content, scheduledDate, channelIds) {
  if (!BUFFER_API_KEY || !channelIds || channelIds.length === 0) {
    return { success: false, reason: 'Buffer not configured' };
  }

  const results = [];
  for (const channelId of channelIds) {
    try {
      const mutation = `
        mutation CreateScheduledPost {
          createPost(input: {
            organizationId: "${BUFFER_ORG_ID}"
            channelId: "${channelId}"
            content: {
              text: ${JSON.stringify(content)}
            }
            scheduling: {
              scheduledAt: "${new Date(scheduledDate).toISOString()}"
            }
          }) {
            ... on Post {
              id
              status
            }
          }
        }
      `;

      const res = await fetch('https://api.buffer.com', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${BUFFER_API_KEY}`
        },
        body: JSON.stringify({ query: mutation })
      });

      const data = await res.json();
      results.push({ channelId, success: !data.errors, data });
    } catch (err) {
      results.push({ channelId, success: false, error: err.message });
    }
  }
  return results;
}
const BRAND_VOICE = `
BRAND: Tresse Botanicals
WEBSITE: tressebotanicals.com
POSITIONING: Professional-grade botanical hair care system for damaged, color-treated, chemically processed, heat-styled, or extension hair. System approach: Clean → Repair → Seal.
DIFFERENTIATOR: Ingredients delivered at the right stage — not washed down the drain in shampoo. Quad-layer strengthening: deep cortex bond repair, mid-level fiber reinforcement, shaft-sealing proteins, sealing conditioner.
AUDIENCE: Women 25-45 who invest in coloring, bleaching, heat styling, extensions. Frustrated hair looks dull and damaged too quickly.
TONE: Expert but friendly. Empathetic. Confident but never pushy. Educational. Empowering.
PRODUCTS: Complete Hair Strengthening & Repair System ($52.25), Protein Treatment, Leave-In Conditioning Spray, Nourishing Conditioner, Moisturizing Daily Shampoo, Weekly Reset Deep Cleanse Shampoo.
KEY PHRASES: restoration, repair, strengthen, rebuild, seal, structural, quad-layer, botanical, professional-grade, Clean → Repair → Seal.
AVOID: Generic claims without substance, jargon without explanation, aggressive sales language.
PLATFORMS: Instagram, Facebook, TikTok, Blog.
`;

const agents = {
  vp: `You are the VP of Marketing for Tresse Botanicals with 20 years of experience.
You are a strategic marketing director who thinks in campaigns, narratives, and content calendars.

${BRAND_VOICE}

When you receive a campaign brief create exactly the number of pieces requested.
Vary content types across pieces — never repeat the same content_type twice in one batch.
Content types to choose from: educational, inspirational, product, social-proof, tips, behind-the-scenes.

Respond ONLY with valid JSON — no text before or after:
{
  "strategy": "overall campaign strategy",
  "calendar_note": "what direction tomorrow should go",
  "pieces": [
    {
      "id": 1,
      "theme": "specific angle for this piece",
      "content_type": "educational",
      "writer_task": "specific writing instructions",
      "designer_task": "specific visual design instructions",
      "social_task": "specific social media instructions for Instagram, Facebook, and TikTok"
    }
  ]
}`,

  writer: `You are an expert content writer for Tresse Botanicals.
${BRAND_VOICE}
Produce high quality on-brand content for the specific task given.
Write compelling headlines, body copy, and calls to action.
Return complete written content ready for review.`,

  designer: `You are a creative director for Tresse Botanicals.
${BRAND_VOICE}
Produce detailed actionable design briefs.
Include: dimensions for each platform, color palette (soft botanicals — greens, creams, blush tones), typography, imagery direction, copy placement.
Make briefs specific enough that a designer or AI tool can execute immediately.`,

  social: `You are a social media specialist for Tresse Botanicals.
${BRAND_VOICE}
Produce platform-optimized posts for each piece.
For each piece create:
- Instagram: caption (150-200 words), 15-20 hashtags, story concept
- Facebook: longer form post (200-300 words), engagement question
- TikTok: video concept, hook (first 3 seconds), script outline
Return complete ready-to-post content for all three platforms.`,

  reviewer: `You are the VP of Marketing for Tresse Botanicals reviewing content.
${BRAND_VOICE}
Review the content package and respond ONLY with valid JSON — no text before or after:
{
  "approved": true,
  "overall_score": 8,
  "feedback": "",
  "approved_content": {
    "writer": "final approved writing here",
    "designer": "final approved design brief here",
    "social": "final approved social posts here"
  }
}`
};

// Store pending jobs in memory
const jobs = {};

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

async function processSinglePiece(piece, brief, _, pieceNum, total, jobId, campaignName) {
  const job = jobs[jobId];
  if (!job) return;

  const log = (msg) => {
    job.logs.push({ time: new Date().toLocaleTimeString(), msg });
  };

  try {
    log(`Starting piece ${pieceNum} of ${total}: ${piece.theme} [${piece.content_type}]`);

    // Writer
    log(`Writer working on piece ${pieceNum}...`);
    const writerRes = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: `Brief: ${brief}\nTask: ${piece.writer_task}\nTheme: ${piece.theme}\nContent type: ${piece.content_type}` }],
      system: agents.writer
    });
    const writerResult = writerRes.content[0].text;
    log(`Writer done for piece ${pieceNum}`);

    // Designer
    log(`Designer working on piece ${pieceNum}...`);
    const designerRes = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: `Brief: ${brief}\nTask: ${piece.designer_task}\nTheme: ${piece.theme}\nWritten content:\n${writerResult}` }],
      system: agents.designer
    });
    const designerResult = designerRes.content[0].text;
    log(`Designer done for piece ${pieceNum}`);

    // Social
    log(`Social Media working on piece ${pieceNum}...`);
    const socialRes = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      messages: [{ role: 'user', content: `Brief: ${brief}\nTask: ${piece.social_task}\nTheme: ${piece.theme}\nWritten content:\n${writerResult}` }],
      system: agents.social
    });
    const socialResult = socialRes.content[0].text;
    log(`Social Media done for piece ${pieceNum}`);

    // VP Review
    log(`VP reviewing piece ${pieceNum}...`);
    const reviewRes = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: `Review piece ${pieceNum} - Theme: ${piece.theme}\n\nWRITER:\n${writerResult}\n\nDESIGNER:\n${designerResult}\n\nSOCIAL:\n${socialResult}`
      }],
      system: agents.reviewer
    });

    let reviewResult;
    try {
      const reviewText = reviewRes.content[0].text;
      const jsonMatch = reviewText.match(/\{[\s\S]*\}/);
      reviewResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      reviewResult = null;
    }

    const finalWriter = reviewResult?.approved_content?.writer || writerResult;
    const finalDesigner = reviewResult?.approved_content?.designer || designerResult;
    const finalSocial = reviewResult?.approved_content?.social || socialResult;
    const score = reviewResult?.overall_score || 8;

    log(`VP approved piece ${pieceNum} (Score: ${score}/10)`);

    // Save to Airtable
    try {
      await base('Content').create([{
        fields: {
          Name: `[${piece.content_type}] ${piece.theme}`,
          Content: `WRITTEN CONTENT:\n${finalWriter}\n\n---\n\nDESIGNER BRIEF:\n${finalDesigner}\n\n---\n\nSOCIAL MEDIA POSTS:\n${finalSocial}`,
          Agent: 'VP Approved',
          Status: 'Needs Review',
          Brief: brief,
          Campaign: campaignName || 'Untitled Campaign',
          Notes: `VP Score: ${score}/10 | Type: ${piece.content_type}`
        }
      }], {typecast: true});
      log(`Piece ${pieceNum} saved to Airtable`);
    } catch (err) {
      log(`Airtable error for piece ${pieceNum}: ${err.message}`);
    }

    job.completed.push({
      pieceNum,
      theme: piece.theme,
      content_type: piece.content_type,
      score
    });

  } catch (err) {
    log(`Error on piece ${pieceNum}: ${err.message}`);
    job.errors.push({ pieceNum, error: err.message });
  }
}

// Start a job — returns immediately with jobId
app.post('/api/run', async (req, res) => {
  const { brief, numPieces = 3 } = req.body;
  const jobId = generateId();

  jobs[jobId] = {
    status: 'running',
    brief,
    numPieces,
    campaignName: req.body.campaignName || 'Untitled Campaign',
    logs: [],
    completed: [],
    errors: [],
    strategy: '',
    calendarNote: ''
  };

  res.json({ jobId });

  // Run async in background
  (async () => {
    const job = jobs[jobId];

    try {
      job.logs.push({ time: new Date().toLocaleTimeString(), msg: `VP creating ${numPieces}-piece content calendar...` });

      const vpRes = await claude.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: `Create exactly ${numPieces} content pieces for: ${brief}` }],
        system: agents.vp
      });

      let vpResult;
      try {
        const vpText = vpRes.content[0].text;
        const jsonMatch = vpText.match(/\{[\s\S]*\}/);
        vpResult = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        vpResult = null;
      }

      if (!vpResult?.pieces) {
        const types = ['educational', 'inspirational', 'product', 'social-proof', 'tips'];
        vpResult = {
          strategy: 'Campaign strategy created',
          calendar_note: 'Continue building on today themes tomorrow',
          pieces: Array.from({length: numPieces}, (_, i) => ({
            id: i + 1,
            theme: `Content piece ${i + 1}`,
            content_type: types[i % types.length],
            writer_task: brief,
            designer_task: brief,
            social_task: brief
          }))
        };
      }

      job.strategy = vpResult.strategy;
      job.calendarNote = vpResult.calendar_note;
      job.logs.push({ time: new Date().toLocaleTimeString(), msg: `Strategy: ${vpResult.strategy}` });
      job.logs.push({ time: new Date().toLocaleTimeString(), msg: `Tomorrow: ${vpResult.calendar_note}` });

      // Process pieces one at a time to avoid timeout
      for (let i = 0; i < vpResult.pieces.length; i++) {
        await processSinglePiece(vpResult.pieces[i], brief, null, i + 1, vpResult.pieces.length, jobId, job.campaignName);
      }

      job.status = 'complete';
      job.logs.push({ time: new Date().toLocaleTimeString(), msg: `All ${vpResult.pieces.length} pieces complete!` });

    } catch (err) {
      job.status = 'error';
      job.logs.push({ time: new Date().toLocaleTimeString(), msg: `Fatal error: ${err.message}` });
    }
  })();
});

// Poll for job status
app.get('/api/job/:jobId', (req, res) => {
  const job = jobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({
    status: job.status,
    logs: job.logs,
    completed: job.completed,
    errors: job.errors,
    strategy: job.strategy,
    calendarNote: job.calendarNote,
    numPieces: job.numPieces
  });
});

app.get('/api/queue', async (req, res) => {
  try {
    const showAll = req.query.all === 'true';
    const formula = showAll ? '' : "{Status} = 'Needs Review'";
    const options = {
      sort: [{field: 'Created', direction: 'desc'}]
    };
    if (formula) options.filterByFormula = formula;
    const records = await base('Content').select(options).all();
    res.json(records.map(r => ({ id: r.id, ...r.fields })));
  } catch (error) {
    console.log('Queue error:', error.message);
    res.json([]);
  }
});

app.patch('/api/queue/:id', async (req, res) => {
  try {
    const { status, notes, scheduledDate } = req.body;
    const fields = { Status: status };
    if (notes) fields.Notes = notes;
    if (scheduledDate) fields['Scheduled Date'] = new Date(scheduledDate).toISOString();
    await base('Content').update(req.params.id, fields);

    // Push to Buffer if scheduling
    if (status === 'Scheduled' && scheduledDate && BUFFER_API_KEY) {
      try {
        // Get the record to pull content
        const record = await base('Content').find(req.params.id);
        const content = record.fields.Content || '';
        
        // Get Buffer channels
        const channelsRes = await fetch('https://api.buffer.com', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${BUFFER_API_KEY}`
          },
          body: JSON.stringify({
            query: `query { channels(input: { organizationId: "${BUFFER_ORG_ID}" }) { id service } }`
          })
        });
        const channelsData = await channelsRes.json();
        const channelIds = (channelsData.data?.channels || []).map(c => c.id);

        if (channelIds.length > 0) {
          await pushToBuffer(content.substring(0, 2200), scheduledDate, channelIds);
          console.log('Pushed to Buffer successfully');
        }
      } catch (bufferErr) {
        console.log('Buffer push error:', bufferErr.message);
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/queue/:id', async (req, res) => {
  try {
    await base('Content').destroy(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Marketing Agents running at http://localhost:${PORT}`));