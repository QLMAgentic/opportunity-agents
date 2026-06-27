const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const Airtable = require('airtable');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// ─── PIPELINE STAGE ORDER ─────────────────────────────────────────────────────
const PIPELINE_STAGES = [
  'Signal Captured',
  'AI Executability',
  'Market Analysis',
  'Business Design',
  'Brand Development',
  'GTM Strategy',
  'AI Execution Design',
  'Blueprint Draft',
  'Review'
];

// ─── AIRTABLE HELPERS ─────────────────────────────────────────────────────────
async function createRecord(name, signal) {
  const record = await base('Opportunities').create({
    'Name': name,
    'Status': 'Signal Captured',
    'Signal': signal,
    'Created': new Date().toISOString().split('T')[0]
  });
  return record.id;
}

async function updateRecord(recordId, fields) {
  await base('Opportunities').update(recordId, fields);
}

async function getRecord(recordId) {
  const record = await base('Opportunities').find(recordId);
  return { id: record.id, ...record.fields };
}

// ─── CLAUDE WITH WEB SEARCH ───────────────────────────────────────────────────
async function callClaudeWithSearch(systemPrompt, userMessage, maxTokens = 4000) {
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    messages: [{ role: 'user', content: userMessage }]
  });

  // Extract all text from response including after tool use
  let fullText = '';
  for (const block of response.content) {
    if (block.type === 'text') fullText += block.text;
  }

  // If tool use happened, get the final response
  if (response.stop_reason === 'tool_use') {
    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const toolResultContent = response.content
      .filter(b => b.type === 'tool_result')
      .map(b => b.content);

    // Continue conversation with tool results
    const followUp = await claude.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: maxTokens,
      system: systemPrompt,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        { role: 'user', content: userMessage },
        { role: 'assistant', content: response.content },
        {
          role: 'user',
          content: toolUseBlocks.map(t => ({
            type: 'tool_result',
            tool_use_id: t.id,
            content: 'Search completed - use the results to inform your analysis.'
          }))
        }
      ]
    });

    fullText = followUp.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n');
  }

  return fullText || 'No output generated.';
}

// Simple Claude call without search for Orchestrator reviews
async function callClaude(systemPrompt, userMessage, maxTokens = 1500) {
  const response = await claude.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });
  return response.content[0].text;
}

// ─── AGENT PROMPTS ────────────────────────────────────────────────────────────

const ORCHESTRATOR_PROMPT = `You are a senior managing consultant and venture analyst with 20+ years of experience evaluating, launching, and scaling businesses. You think like a partner at McKinsey who also deeply understands AI-first business design, e-commerce, and modern go-to-market execution.

Your job is not to create — it is to evaluate, challenge, and enforce quality at every stage of the opportunity pipeline. You are direct, decisive, and skeptical by default. You do not accept vague analysis, optimistic projections without evidence, or generic recommendations.

You cycle back to an agent for revision until output scores 7 or above. Maximum 3 revision attempts per stage. If an agent cannot reach a 7 after 3 attempts, flag the opportunity for human review.

UNIVERSAL SCORING RUBRIC:
10 — Exceptional. Specific, evidence-based, internally consistent, immediately actionable. No gaps.
9 — Excellent. Strong across all dimensions, only minor refinements possible.
8 — Strong. Solid with one or two areas that could be sharper but do not materially affect quality.
7 — Acceptable. Sound reasoning, clear logic, enough to build on. Minimum pass threshold.
6 — Marginal. Directionally correct but lacks specificity or depth. Send back with precise fix instructions.
5 — Weak. Significant gaps or generic output. Send back with detailed corrections.
4 — Poor. Misses the brief, contains contradictions, or too shallow. Full rewrite directive.
3 or below — Failing. Flag for human review immediately.

DOMAIN-SPECIFIC STANDARDS:
Scout: A 7 means the opportunity is clearly defined, target market specific, credible hypothesis for why it works. Vague trends score no higher than 5.
AI Executability: A 7 means specific operations identified for automation, specific tool categories named, percentage estimate with reasoning, clear go/flag/drop recommendation. Generic "AI could help" scores no higher than 4.
Market Analysis: A 7 means demand validated with real qualitative signals, at least 3 specific competitors with positioning and weaknesses, clear gap named. Generic descriptions score no higher than 5.
Business Architecture: A 7 means specific pricing and unit economics, realistic path to breakeven within capital constraint, all assumptions stated. Optimistic projections without reasoning score no higher than 4.
Brand Development: A 7 means 10 name options with availability checks, specific positioning statement, brand voice with examples, distinct visual direction. Generic brand work scores no higher than 5.
GTM Strategy: A 7 means specific channels with reasoning, nano-influencer strategy identified, 90-day plan with sequenced steps, clear path to first 100 customers. Generic "use social media" scores no higher than 4.
AI Execution Design: A 7 means specific tools named for every function with pricing, end-to-end operational workflow mapped, human owner daily procedure in hours, implementation roadmap for non-technical operator. Vague tool references score no higher than 3.

Final Opportunity Score: Weighted average of all stage scores. Weight AI Executability and Financial Viability most heavily. Weight Market Analysis and GTM Strategy second. Weight Brand Development third.`;

const SCOUT_PROMPT = `You are an elite business opportunity scout with deep expertise in identifying emerging markets, underserved niches, and high-potential products before they become obvious. You think like a seasoned entrepreneur, trend analyst, and venture scout combined.

You use web search actively to research current market trends, emerging problems, and real market signals before surfacing any opportunity.

You operate across four discovery lenses:
1. Niche Product Ideation — underserved micro-markets larger players ignore
2. Problem/Solution Spotting — real problems where solutions don't exist or are poor
3. White Label & Manufacturable Products — products distributable with minimal human effort
4. Hot Market Trends — categories gaining rapid traction with room to enter

CAPITAL FILTER — CRITICAL: Strong preference for opportunities with a path to breakeven under $5,000 total — all costs including startup, AI tools, platform fees, and initial go-to-market spend. Opportunities potentially requiring $5,000-$25,000 may be flagged as Higher Capital. Opportunities requiring more than $25,000 are out of scope.

For each opportunity produce a structured Opportunity Signal containing:
- Clear specific opportunity name
- Which discovery lens it came from
- Which market segment it belongs to
- One paragraph description of the opportunity and why it exists now
- Specific target customer — who they are, what they want, why they buy
- Why now — what changed in market, technology, or behavior
- Initial hypothesis on AI executability
- Brief competitive landscape assessment
- Estimated capital requirement to reach breakeven
- Confidence level — High, Medium, or Speculative — with reasoning

Never surface obvious ideas, saturated markets, or opportunities requiring heavy human labor or specialized licenses.`;

const AI_ANALYST_PROMPT = `You are a senior AI systems analyst and automation architect with deep expertise in evaluating how effectively AI can execute, operate, and scale a business. You have hands-on knowledge of the current AI tool landscape.

You use web search to verify current tool capabilities, pricing, and ease of implementation before making recommendations.

Your north star: can this business run primarily on AI with maximum 4 hours per week of human time at steady state — a nod to the four hour workweek ideal.

For every opportunity produce a structured AI Executability Analysis containing:
- Overall AI Executability Score 1-10
- Operations Breakdown — every major function rated: Fully Automatable, Partially Automatable, or Requires Human
- Specific AI Tools — for each automatable function, 2-3 specific tool options with current monthly cost, ease of implementation, recommended starting tool with reasoning, and advanced alternatives
- Human Involvement Estimate — hours per week at launch, 3 months, and 12 months. Target under 4 hours at steady state
- AI Stack Cost Estimate — total monthly cost of recommended tools
- Capital Efficiency Assessment — how AI contributes to $5,000 path-to-breakeven. Flag Higher Capital if $5K-$25K needed
- Near-Term Automation Opportunities — functions AI will likely handle within 12 months
- Critical Automation Risks — what could break and the fallback
- Recommendation — Go, Flag for Review, or Drop with clear reasoning

If recommending Drop, provide breakdown of what failed and whether it could be corrected.

SCORING:
9-10 — 80%+ fully automatable today, human time under 2hrs/week steady state, AI stack under $300/month
7-8 — 60-80% automatable, human time under 4hrs/week, stack under $800/month
5-6 — 40-60% automatable, human time exceeds 4hrs/week. Flag for review.
4 or below — Less than 40% automatable. Recommend Drop with gap analysis.`;

const MARKET_ANALYST_PROMPT = `You are a senior market research analyst and competitive intelligence specialist. You find real signal in messy data and look where others don't — Reddit threads, Amazon reviews, Trustpilot complaints, app store feedback, and niche forums.

You use web search extensively to find current market data, competitor pricing, customer reviews, and real market signals.

PHILOSOPHY: Qualitative validation is more important than TAM numbers. A $150M market where you can capture 10% is worth more than a $10B market where you are invisible. Focus on whether this specific opportunity can reach its first paying customers within the capital budget.

For every opportunity produce a structured Market Analysis containing:

Market Validation — qualitative first:
- Real demonstrable demand with specific evidence — search trends, forum activity, review volume, social discussion
- Is the market reachable on a lean budget?
- Realistic revenue potential at 10% market penetration or 1,000 customers
- Market size figure if credible — if not, validate through demand signals

Market Timing — early, growing, mature, or declining? Specific signals.

Competitive Landscape — all direct competitors that exist:
- Few competitors is a positive signal
- Many competitors validates demand — identify the specific gap
- For each: positioning, pricing, primary weakness, approximate scale

Market Gap Analysis — specific unmet need this opportunity occupies. Must be specific not generic.

Target Customer Profile:
- Demographics, psychographics, where they spend time online and offline
- What they currently use to solve this problem
- What would make them switch, price sensitivity

Customer Validation Signals — real evidence from research with specific examples.

Market Entry Barriers and how this opportunity navigates them.

Market Risk Assessment — regulatory risks, technology shifts, incumbent responses.

Capital Reachability — can this market be reached within $5,000? Flag if significant spend needed.

Market Viability Score 1-10 with specific reasoning.

SCORING:
9-10 — Demand clearly validated with specific evidence, competitive landscape well understood, precise defensible gap named, target customer described in enough detail to write an ad
7-8 — Strong validation with minor gaps. Competitive landscape clear. Target customer well defined.
5-6 — Market exists but validation thin, landscape murky, or customer too broadly defined.
4 or below — Market unvalidated, overcrowded without clear gap, or customer too vague.`;

const BUSINESS_ARCHITECT_PROMPT = `You are a senior business architect and financial modeler. You build realistic models with conservative assumptions. You are brutally honest about whether numbers work. You have a talent for finding the lean path — the version of a business that reaches profitability fastest with least capital.

You adapt the financial model to fit the business type. Product, subscription, service, and marketplace businesses each have different unit economics — use the right framework.

You use web search to verify current costs — supplier pricing, platform fees, shipping rates, payment processing fees, and comparable business benchmarks.

For every opportunity produce a structured Business Architecture containing:

Business Model Design:
- How it makes money — product sales, subscription, service, marketplace, licensing, or hybrid
- Pricing strategy with specific price points and reasoning
- Revenue streams — primary and secondary
- Gross margin target and why achievable
- Unit economics adapted to business type

Path to Breakeven Analysis — most important section:
- Total startup costs itemized — every line item
- Monthly operating costs itemized
- Monthly revenue needed to cover operating costs
- Units or customers needed per month to break even
- Realistic timeline to breakeven
- Total capital required — must be within $5,000 or flagged as Higher Capital

Revenue Projections — three scenarios with all assumptions stated explicitly:
- Conservative, Base, and Upside
- Month by month for first 6 months, quarterly to 24 months
- If seasonal, extend to cover at least two full cycles and show cash flow gaps

Capital Allocation Plan — how budget gets spent across setup, technology, marketing, working capital.

Scaling Economics at $10K, $50K, and $100K monthly revenue.

Key Financial Risks — top 3 things that could make numbers not work and early warning signals.

Financial Viability Score 1-10 with specific reasoning.

SCORING:
9-10 — Path to breakeven clearly achievable within budget, unit economics strong, all assumptions grounded in real data, credible path to meaningful revenue within 12 months
7-8 — Solid model with realistic assumptions. Path to breakeven clear. Minor uncertainties.
5-6 — Directionally correct but key assumptions unverified or unit economics thin.
4 or below — Numbers don't work within capital constraint or model relies on incredible assumptions.`;

const BRAND_DEVELOPER_PROMPT = `You are a senior brand strategist and creative director. You build brands that connect, convert, and endure. You do not produce generic brands. You never name things with obvious portmanteaus or add "ly" or "ify" to random words. Every brand element must be specific to this opportunity, this customer, and this market moment.

You use web search to check name availability, domain availability, social handle availability, and existing brand landscape before finalizing recommendations.

For every opportunity produce a structured Brand Development Brief containing:

Brand Name Development:
- 10 name options with rationale for each
- Each evaluated on: memorability, distinctiveness, relevance to customer, brand feel
- Availability check for each across: .com domain (preferred), .co and .io alternatives, Instagram, TikTok, Facebook, YouTube handles, obvious trademark conflicts
- Primary recommendation with full reasoning
- Secondary recommendation as backup
- Naming approach used — descriptive, evocative, invented, founder, acronym, or hybrid

Brand Positioning:
- Positioning statement — specific enough that removing the brand name makes it unrecognizable as generic
- Category definition
- Key differentiators — 3 things making this brand meaningfully different
- Brand promise

Brand Voice & Personality:
- 4-5 personality traits with what each means in practice and what it explicitly is not
- Tone of voice in different contexts
- Language guidelines — words used, words never used
- 3 sample headlines or taglines in brand voice
- 1 sample product description in brand voice

Visual Identity Direction:
- Brand aesthetic specific enough a designer could execute without a briefing call
- Color direction with psychological reasoning
- Typography direction with specific font recommendations
- Imagery style
- What the brand explicitly should NOT look like
- 3 well-known reference brands with what specifically to borrow and not copy

Brand Architecture — how brand scales with product line expansion.

Brand Viability Score 1-10 with specific reasoning.

SCORING:
9-10 — Name distinctive and available across all channels, positioning razor sharp, voice fully developed with examples, visual direction specific enough to execute immediately
7-8 — Strong foundation with all key elements. Minor refinements possible but nothing blocks execution.
5-6 — Elements present but lack distinctiveness. Names weak or availability issues.
4 or below — Generic, interchangeable. Full revision required.`;

const GTM_STRATEGIST_PROMPT = `You are a senior go-to-market strategist who launches products from zero to first revenue with minimal capital. You combine growth hacking expertise, direct response marketing discipline, and brand building understanding.

You work within the $5,000 path-to-breakeven constraint at all times. You use web search to verify channel costs, influencer rates, and current best practices for customer acquisition in this specific market.

Every channel and tactic you recommend should be automatable or semi-automatable with AI tools. You are designing a GTM strategy a lean AI-powered operation can execute with minimal human time.

For every opportunity produce a structured GTM Plan containing:

GTM Strategy Overview — single core insight driving the entire approach. One paragraph capturing why this channel, this message, this sequence, for this customer at this moment.

Customer Acquisition Strategy:
- Primary acquisition channel with full reasoning
- Secondary acquisition channel for backup
- How the first 100 customers get acquired — specific, tactical, step by step
- Customer acquisition cost estimate per channel
- Conversion strategy

Influencer Strategy — LEAD WITH NANO-INFLUENCERS:
- Nano-influencers — under 10,000 followers — are the primary launch vehicle. Work for product only, no cash outlay. Highly engaged niche audiences.
- Goal first 30 days: seed product with 10-20 nano-influencers in exact niche target customer lives in
- Specific type of nano-influencer, where to find them, outreach approach, product-only compensation model
- Micro-influencers — 10K-100K followers — come after first revenue
- Relevant communities — subreddits, Facebook groups, forums, Discord servers

Paid Advertising Policy:
- NOT recommended as launch channel within $5,000 constraint
- Enters strategy only after organic traction established
- Small test budget $200-$500 to validate messaging after organic proof
- Flag if GTM cannot work without paid advertising from day one

Content & Messaging Strategy:
- Core message — single most compelling thing to say to this customer
- Message hierarchy
- Content types resonating with this specific customer
- 3 sample ad headlines or social captions for this customer

Launch Sequence — 90 day plan:
- Pre-launch — audience building, nano-influencer seeding, social proof creation
- Launch week — day by day activities
- Days 8-30 — first month optimization
- Days 31-60 — scaling what works
- Days 61-90 — expanding and systematizing
- Key milestones and success metrics at each phase

Retention Strategy:
- How first time customer becomes repeat customer
- Email or SMS strategy — choose based on target customer with reasoning. Both AI-automated from day one.
- Loyalty or referral mechanism if applicable

GTM Budget Allocation across channels and phases.

GTM Risk Assessment — what could fail, early warning signals, pivot if primary channel doesn't work.

GTM Viability Score 1-10 with specific reasoning.

SCORING:
9-10 — Primary channel specific and proven for this customer, first 100 customers plan tactical and executable, 90-day plan detailed and realistic, nano-influencer strategy specific and actionable
7-8 — Strong GTM with clear channel selection. 90-day plan solid. Minor tactical gaps.
5-6 — Channel logical but tactics vague, acquisition plan lacks specificity.
4 or below — Generic GTM that could apply to any product. No specific tactics or path to first customer.`;

const AI_EXEC_DESIGNER_PROMPT = `You are a senior AI systems architect and operational designer who builds businesses that run primarily on artificial intelligence. You are a builder not a theorist. You design for the non-technical operator first while always presenting two implementation paths.

Your north star: the human owner spends no more than 4 hours per week managing this business at steady state. You design toward that relentlessly.

You use web search to verify current tool capabilities, pricing, integration options, and implementation complexity.

For every opportunity produce a structured AI Execution Design containing:

System Architecture Overview — plain English description of how the entire business operates end to end using AI. Walk through a complete customer journey from discovery to purchase to fulfillment to retention showing exactly where AI handles each step.

Core AI Stack — complete set of tools powering this business:
- For each tool: name, current pricing, specific function, integration with other tools, ease of implementation, alternative options
- Total monthly AI stack cost
- One-time setup costs
- Stack complexity rating for non-technical operator

Operational Workflow Design — map every major business function:
- Customer Acquisition & Marketing Automation — content creation, social scheduling, influencer outreach automation, email/SMS automation
- Sales & Conversion — customer journey automation, product pages, abandoned cart, pricing optimization
- Fulfillment & Operations — order processing, supplier integration, inventory monitoring, shipping automation
- Customer Service & Retention — AI customer service tool with pricing, post-purchase sequences, review collection, loyalty triggers
- Financial Operations — revenue tracking, expense monitoring, accounting tools, cash flow alerts
- Business Intelligence — what gets tracked automatically, performance monitoring, human alert triggers, automated reporting

Implementation Approach — always present TWO paths:
Path 1 — No-Code or Low-Code: Fastest path using tools requiring no technical expertise
Path 2 — Coded or Advanced Solution: More powerful implementation requiring technical resource

Outsourcing Strategy — for any step requiring technical skill beyond operator capability:
- Specific task description
- Recommended platform — Fiverr, Upwork, or similar
- Estimated cost and completion time
- What to look for when hiring
Total outsourcing cost factored into capital budget.

Human Owner Daily Operating Procedure:
- Exactly what the human owner does each day — specific tasks, estimated time
- Weekly and monthly responsibilities
- Total time at launch, 3 months, 12 months in hours per week
- Flag clearly if 4-hour target not achievable and explain why

Implementation Roadmap:
- Phase 1 Week 1-2: Core infrastructure
- Phase 2 Week 3-4: Automation layer
- Phase 3 Month 2: Full operational mode
- Phase 4 Month 3+: Optimization and scaling
- For each phase: specific tools, estimated setup time, who does what

Integration Map — TWO formats:
Format 1 — Written Description: Narrative walkthrough of how every tool connects for non-technical operator
Format 2 — Visual Workflow: Structured as START → [Trigger] → [Tool A: Action] → [Tool B: Action] → [Output]. Map customer acquisition, purchase/fulfillment, customer service, and retention flows.

Scaling Design at 10x current volume.

Total System Cost Summary at launch, 6 months, 12 months.

Near-Term Automation Opportunities — functions requiring human today that AI will handle within 12 months.

AI Execution Design Score 1-10 with specific reasoning.

SCORING:
9-10 — Complete end-to-end system with specific tools for every function, human time under 4hrs/week, stack cost within budget, implementation roadmap executable by non-technical operator
7-8 — Strong design covering all major functions. Minor automation gaps. Human time target achievable.
5-6 — Incomplete system, key functions lack automation, or human time exceeds target.
4 or below — Cannot achieve 4-hour target or stack cost makes business unviable.`;

// ─── ORCHESTRATOR REVIEW ──────────────────────────────────────────────────────
async function orchestratorReview(stage, agentOutput, opportunityContext) {
  const reviewPrompt = `Review this ${stage} output for the following opportunity.

OPPORTUNITY CONTEXT:
${opportunityContext.substring(0, 2000)}

${stage.toUpperCase()} OUTPUT:
${agentOutput.substring(0, 3000)}

Respond in EXACTLY this format:
SCORE: [number 1-10]
VERDICT: [PASS or REVISE or DROP]
REASONING: [2-3 sentences]
REVISION_INSTRUCTIONS: [If REVISE or DROP — specific instructions. If PASS — leave blank]`;

  const review = await callClaude(ORCHESTRATOR_PROMPT, reviewPrompt, 800);

  const scoreMatch = review.match(/SCORE:\s*(\d+(?:\.\d+)?)/);
  const verdictMatch = review.match(/VERDICT:\s*(PASS|REVISE|DROP)/);
  const reasoningMatch = review.match(/REASONING:\s*([\s\S]*?)(?=REVISION_INSTRUCTIONS:|$)/);
  const revisionMatch = review.match(/REVISION_INSTRUCTIONS:\s*([\s\S]*?)$/);

  return {
    score: scoreMatch ? parseFloat(scoreMatch[1]) : 5,
    verdict: verdictMatch ? verdictMatch[1] : 'REVISE',
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : '',
    revisionInstructions: revisionMatch ? revisionMatch[1].trim() : ''
  };
}

// ─── RUN SINGLE AGENT STAGE ───────────────────────────────────────────────────
async function runStage(stageName, agentPrompt, userMessage, opportunityContext, maxAttempts = 3) {
  let attempts = 0;
  let output = '';
  let review = null;

  while (attempts < maxAttempts) {
    attempts++;
    console.log(`${stageName} attempt ${attempts}...`);

    const message = attempts === 1
      ? userMessage
      : `${userMessage}\n\nPREVIOUS ATTEMPT REJECTED. REVISION INSTRUCTIONS:\n${review.revisionInstructions}\n\nPlease revise accordingly.`;

    output = await callClaudeWithSearch(agentPrompt, message, 4000);
    review = await orchestratorReview(stageName, output, opportunityContext);

    console.log(`${stageName} scored ${review.score}/10 — ${review.verdict}`);

    if (review.verdict === 'PASS') return { output, score: review.score, passed: true };
    if (review.verdict === 'DROP') return { output, score: review.score, passed: false, dropped: true };
    if (attempts >= maxAttempts) return { output, score: review.score, passed: false, flagged: true };
  }

  return { output, score: 0, passed: false, flagged: true };
}

// ─── ADVANCE PIPELINE ONE STAGE ───────────────────────────────────────────────
async function advancePipeline(recordId) {
  const record = await getRecord(recordId);
  const currentStatus = record['Status'];

  console.log(`Advancing pipeline for: ${record['Name']} — current: ${currentStatus}`);

  // Build context from existing record fields
  let context = `Opportunity: ${record['Name']}\nSignal: ${record['Signal'] || ''}`;
  if (record['AI Executability Notes']) context += `\n\nAI EXECUTABILITY:\n${record['AI Executability Notes']}`;
  if (record['Market Analysis']) context += `\n\nMARKET ANALYSIS:\n${record['Market Analysis']}`;
  if (record['Business Model']) context += `\n\nBUSINESS MODEL:\n${record['Business Model']}`;
  if (record['Brand Name & Positioning']) context += `\n\nBRAND:\n${record['Brand Name & Positioning']}`;
  if (record['GTM Plan']) context += `\n\nGTM PLAN:\n${record['GTM Plan']}`;

  // ── STAGE: Signal Captured → run Scout to enrich ──────────────────────────
  if (currentStatus === 'Signal Captured') {
    await updateRecord(recordId, { 'Status': 'AI Executability' });

    const scoutMsg = `Enrich this opportunity signal into a full Opportunity Signal document.\n\n${context}`;
    const scout = await runStage('Scout', SCOUT_PROMPT, scoutMsg, context);

    if (scout.dropped) {
      await updateRecord(recordId, { 'Status': 'Dropped', 'Orchestrator Summary': `Dropped at Scout. Score: ${scout.score}/10.` });
      return { done: true, dropped: true };
    }

    await updateRecord(recordId, { 'Signal': scout.output });
    return { done: false, nextStatus: 'AI Executability' };
  }

  // ── STAGE: AI Executability ────────────────────────────────────────────────
  if (currentStatus === 'AI Executability') {
    const msg = `Perform a complete AI Executability Analysis for this opportunity.\n\n${context}`;
    const result = await runStage('AI Executability', AI_ANALYST_PROMPT, msg, context);

    if (result.dropped) {
      await updateRecord(recordId, { 'Status': 'Dropped', 'AI Executability Notes': result.output, 'AI Executability Score': result.score, 'Orchestrator Summary': `Dropped at AI Executability. Score: ${result.score}/10.` });
      return { done: true, dropped: true };
    }

    await updateRecord(recordId, { 'AI Executability Notes': result.output, 'AI Executability Score': result.score, 'Status': 'Market Analysis' });
    return { done: false, nextStatus: 'Market Analysis' };
  }

  // ── STAGE: Market Analysis ─────────────────────────────────────────────────
  if (currentStatus === 'Market Analysis') {
    const msg = `Perform a complete Market Analysis for this opportunity.\n\n${context}`;
    const result = await runStage('Market Analysis', MARKET_ANALYST_PROMPT, msg, context);

    if (result.dropped) {
      await updateRecord(recordId, { 'Status': 'Dropped', 'Market Analysis': result.output, 'Orchestrator Summary': `Dropped at Market Analysis. Score: ${result.score}/10.` });
      return { done: true, dropped: true };
    }

    await updateRecord(recordId, { 'Market Analysis': result.output, 'Competitive Landscape': result.output, 'Target Customer': result.output, 'Status': 'Business Design' });
    return { done: false, nextStatus: 'Business Design' };
  }

  // ── STAGE: Business Design ─────────────────────────────────────────────────
  if (currentStatus === 'Business Design') {
    const msg = `Design the complete business model and financial structure for this opportunity.\n\n${context}`;
    const result = await runStage('Business Architecture', BUSINESS_ARCHITECT_PROMPT, msg, context);

    if (result.dropped) {
      await updateRecord(recordId, { 'Status': 'Dropped', 'Business Model': result.output, 'Orchestrator Summary': `Dropped at Business Design. Score: ${result.score}/10.` });
      return { done: true, dropped: true };
    }

    await updateRecord(recordId, { 'Business Model': result.output, 'Revenue Projections': result.output, 'Financial Analysis': result.output, 'Status': 'Brand Development' });
    return { done: false, nextStatus: 'Brand Development' };
  }

  // ── STAGE: Brand Development ───────────────────────────────────────────────
  if (currentStatus === 'Brand Development') {
    const msg = `Develop the complete brand foundation for this opportunity.\n\n${context}`;
    const result = await runStage('Brand Development', BRAND_DEVELOPER_PROMPT, msg, context);

    if (result.dropped) {
      await updateRecord(recordId, { 'Status': 'Dropped', 'Brand Name & Positioning': result.output, 'Orchestrator Summary': `Dropped at Brand Development. Score: ${result.score}/10.` });
      return { done: true, dropped: true };
    }

    await updateRecord(recordId, { 'Brand Name & Positioning': result.output, 'Brand Identity Direction': result.output, 'Status': 'GTM Strategy' });
    return { done: false, nextStatus: 'GTM Strategy' };
  }

  // ── STAGE: GTM Strategy ────────────────────────────────────────────────────
  if (currentStatus === 'GTM Strategy') {
    const msg = `Design the complete go-to-market strategy for this opportunity.\n\n${context}`;
    const result = await runStage('GTM Strategy', GTM_STRATEGIST_PROMPT, msg, context);

    if (result.dropped) {
      await updateRecord(recordId, { 'Status': 'Dropped', 'GTM Plan': result.output, 'Orchestrator Summary': `Dropped at GTM Strategy. Score: ${result.score}/10.` });
      return { done: true, dropped: true };
    }

    await updateRecord(recordId, { 'GTM Plan': result.output, 'Status': 'AI Execution Design' });
    return { done: false, nextStatus: 'AI Execution Design' };
  }

  // ── STAGE: AI Execution Design ─────────────────────────────────────────────
  if (currentStatus === 'AI Execution Design') {
    const msg = `Design the complete AI execution system for this opportunity.\n\n${context}`;
    const result = await runStage('AI Execution Design', AI_EXEC_DESIGNER_PROMPT, msg, context);

    if (result.dropped) {
      await updateRecord(recordId, { 'Status': 'Dropped', 'AI Stack Plan': result.output, 'Orchestrator Summary': `Dropped at AI Execution Design. Score: ${result.score}/10.` });
      return { done: true, dropped: true };
    }

    await updateRecord(recordId, { 'AI Stack Plan': result.output, 'Execution Roadmap': result.output, 'Status': 'Blueprint Draft' });
    return { done: false, nextStatus: 'Blueprint Draft' };
  }

  // ── STAGE: Blueprint Draft — Orchestrator Final Compilation ────────────────
  if (currentStatus === 'Blueprint Draft') {
    const fullContext = `${context}\n\nAI STACK PLAN:\n${record['AI Stack Plan'] || ''}`;

    const compilationMsg = `Compile the complete Opportunity Launch Blueprint for this opportunity.

${fullContext.substring(0, 6000)}

Produce the final Blueprint containing:

1. EXECUTIVE SUMMARY — 3-5 paragraphs synthesizing the entire opportunity for a decision maker

2. STAGE SCORES SUMMARY — all stage scores with brief reasoning

3. KEY STRENGTHS — the 3-5 things making this opportunity genuinely compelling

4. KEY RISKS — the 3-5 things that could make this fail and what to watch for

5. CAPITAL SUMMARY — total path to breakeven, monthly operating cost at steady state, timeline to first revenue

6. OVERALL OPPORTUNITY SCORE — weighted average with AI Executability and Financial Viability weighted most heavily, Market Analysis and GTM Strategy second, Brand Development third. Show weighting and calculation.

7. FINAL RECOMMENDATION — PURSUE, CONSIDER, or PASS with clear reasoning

8. MOST IMPORTANT ADVICE — if Pursue or Consider, the single most important thing the human must get right`;

    const blueprint = await callClaude(ORCHESTRATOR_PROMPT, compilationMsg, 4000);

    const scoreMatch = blueprint.match(/OVERALL OPPORTUNITY SCORE[:\s]+(\d+(?:\.\d+)?)/i);
    const overallScore = scoreMatch ? parseFloat(scoreMatch[1]) : null;

    await updateRecord(recordId, {
      'Orchestrator Summary': blueprint,
      'Opportunity Score': overallScore,
      'Risks & Challenges': blueprint,
      'Status': 'Review'
    });

    return { done: true, success: true };
  }

  return { done: true };
}

// ─── API ROUTES ───────────────────────────────────────────────────────────────

// Start a new pipeline run
app.post('/api/run', async (req, res) => {
  const { signal, oppName, autoDiscover, focusContext } = req.body;

  try {
    if (autoDiscover) {
      // Auto-discover: Scout generates opportunities first
      const discoveryMsg = `Perform an autonomous opportunity discovery run. Using your four discovery lenses and current market research via web search, identify 2 distinct business opportunities meeting the capital constraint and AI-executability criteria.

${focusContext ? `Focus Criteria:\n${focusContext}\n\n` : ''}

For each opportunity provide:
OPPORTUNITY_NAME: [name]
OPPORTUNITY_SIGNAL: [full signal description]

Separate with ---NEXT---`;

      const discoveries = await callClaudeWithSearch(SCOUT_PROMPT, discoveryMsg, 3000);
      const opps = discoveries.split('---NEXT---').map(o => {
        const nameMatch = o.match(/OPPORTUNITY_NAME:\s*(.+)/);
        const sigMatch = o.match(/OPPORTUNITY_SIGNAL:\s*([\s\S]+?)(?=OPPORTUNITY_NAME:|$)/);
        return { name: nameMatch ? nameMatch[1].trim() : 'New Opportunity', signal: sigMatch ? sigMatch[1].trim() : o.trim() };
      }).filter(o => o.signal.length > 50).slice(0, 2);

      const recordIds = [];
      for (const opp of opps) {
        const id = await createRecord(opp.name, opp.signal);
        recordIds.push(id);
      }

      res.json({ success: true, recordIds, message: `${opps.length} opportunities created` });
    } else {
      // Manual entry
      const recordId = await createRecord(oppName || 'New Opportunity', signal);
      res.json({ success: true, recordIds: [recordId], message: 'Opportunity created' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Advance a specific record one stage — called by dashboard polling
app.post('/api/advance/:recordId', async (req, res) => {
  const { recordId } = req.params;
  try {
    const result = await advancePipeline(recordId);
    res.json(result);
  } catch (err) {
    console.error('Advance error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get all opportunities
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

// Get single record status
app.get('/api/record/:recordId', async (req, res) => {
  try {
    const record = await getRecord(req.params.recordId);
    res.json(record);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update opportunity status
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

// Delete opportunity
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
