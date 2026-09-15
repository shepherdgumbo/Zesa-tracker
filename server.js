/*
  ZesaTracker - One File App
  ===========================
  Run:
    npm init -y
    npm install express pg helmet cors compression

  Then:
    node server.js

  Render:
    Build Command: npm install
    Start Command: node server.js

  Optional environment variables:
    PORT=10000
    DATABASE_URL=your_supabase_postgres_connection_string

    AI_PROVIDER=custom
    AI_BASE_URL=https://your-provider/v1/chat/completions
    AI_API_KEY=your_key
    AI_MODEL=your_model

    Or:
    AI_PROVIDER=openai
    OPENAI_API_KEY=your_key
    OPENAI_MODEL=gpt-4o-mini

  IMPORTANT:
  Never put API keys in the browser.
*/

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(cors());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ============================================================
// CONFIGURATION
// ============================================================

const ZETDC = {
  website: "https://www.zetdc.co.zw/",
  contact: "https://www.zetdc.co.zw/?page_id=4487",
  charter: "https://www.zetdc.co.zw/?page_id=5327",
  tid: "https://www.zetdc.co.zw/?page_id=6782",
  tidFaq:
    "https://www.zetdc.co.zw/wp-content/uploads/2023/10/TID-FAQ.pdf",
  meterGuide:
    "https://www.zetdc.co.zw/wp-content/uploads/2024/01/ZETDC-Step-to-upgrade-meter.pdf",
  loadShedding: "https://www.zetdc.co.zw/?page_id=7328",
  harare: "https://www.zetdc.co.zw/?page_id=7197",
  generalFaq: "https://www.zetdc.co.zw/?page_id=7344",
  serviceCentres: "https://www.zetdc.co.zw/?page_id=4767",
  notices: "https://www.zetdc.co.zw/?page_id=4768",
  complaints:
    "https://www.zetdc.co.zw/wp-content/uploads/2023/10/Customer-Complaint-or-Compliment-Handling-Procedure.pdf"
};

const PARTNER_LINK =
  "https://app.sideshift.app/r/GUMBOZIMMARKETS1K4G6";

let memoryReports = [];

// ============================================================
// DATABASE
// ============================================================

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });

  pool.on("error", (err) => {
    console.error("Database error:", err.message);
  });
}

async function initDatabase() {
  if (!pool) return;

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id BIGSERIAL PRIMARY KEY,
        area TEXT NOT NULL,
        category TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    console.log("Database ready.");
  } catch (err) {
    console.error("Database initialization failed:", err.message);
  }
}

// ============================================================
// HELPERS
// ============================================================

function cleanText(value, max = 1000) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ============================================================
// AI
// ============================================================

const SYSTEM_PROMPT = `
You are ZesaTracker Power Assistant for Zimbabwe.

You help users understand electricity-related topics, especially:
- ZETDC services
- prepaid electricity meters
- TID meter updates
- electricity tokens
- load shedding information
- reporting faults
- customer service
- electrical safety

Important rules:
1. Never invent a live outage or load-shedding status.
2. Never claim that an area currently has electricity unless a verified
   live source confirms it.
3. When appropriate, direct users to the official ZETDC website.
4. Do not ask users for passwords, PINs, banking credentials or API keys.
5. Give practical, concise answers.
6. For emergencies involving electrical danger, advise users to stay away
   and contact the appropriate electricity emergency/service channels.

Official ZETDC resources:

Website:
${ZETDC.website}

Contact:
${ZETDC.contact}

Client Charter:
${ZETDC.charter}

TID:
${ZETDC.tid}

TID FAQ:
${ZETDC.tidFaq}

Meter upgrade guide:
${ZETDC.meterGuide}

Load shedding FAQs:
${ZETDC.loadShedding}

General FAQs:
${ZETDC.generalFaq}

Customer service centres:
${ZETDC.serviceCentres}
`;

async function callOpenAICompatible(message) {
  const baseURL =
    process.env.AI_BASE_URL ||
    "https://api.openai.com/v1/chat/completions";

  const apiKey =
    process.env.AI_API_KEY ||
    process.env.OPENAI_API_KEY;

  const model =
    process.env.AI_MODEL ||
    process.env.OPENAI_MODEL ||
    "gpt-4o-mini";

  if (!apiKey) {
    return null;
  }

  const response = await fetch(baseURL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT
        },
        {
          role: "user",
          content: message
        }
      ],
      temperature: 0.3,
      max_tokens: 700
    })
  });

  if (!response.ok) {
    throw new Error(`AI provider returned ${response.status}`);
  }

  const data = await response.json();

  return (
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    null
  );
}

async function callGemini(message) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";

  if (!apiKey) return null;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: message }]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini returned ${response.status}`);
  }

  const data = await response.json();

  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("") || null
  );
}

async function callAnthropic(message) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const model =
    process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";

  if (!apiKey) return null;

  const response = await fetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: 700,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: message
          }
        ]
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Anthropic returned ${response.status}`);
  }

  const data = await response.json();

  return (
    data?.content
      ?.map((item) => item.text || "")
      .join("") || null
  );
}

// Local fallback means the app still works without an AI key.
function localAssistant(message) {
  const text = message.toLowerCase();

  if (
    text.includes("tid") ||
    text.includes("meter upgrade") ||
    text.includes("rollover")
  ) {
    return `
TID meter update help:

If your prepaid meter requires a TID update, follow the official
ZETDC instructions carefully. Where a sequence of update tokens is
provided, enter them in the required order and wait for confirmation
after each token.

Do not pay anyone just to perform the meter update.

Official TID information:
${ZETDC.tid}

TID FAQ:
${ZETDC.tidFaq}

If you experience a problem, contact ZETDC on 704.
`.trim();
  }

  if (
    text.includes("token") ||
    text.includes("prepaid") ||
    text.includes("electricity token")
  ) {
    return `
For prepaid electricity tokens, use the official ZETDC services and
follow the instructions associated with your meter.

If a token appears invalid or does not load, keep your token receipt
or transaction information and contact ZETDC customer service.

Official ZETDC website:
${ZETDC.website}

Customer service:
${ZETDC.contact}
`.trim();
  }

  if (
    text.includes("outage") ||
    text.includes("power cut") ||
    text.includes("no electricity") ||
    text.includes("blackout")
  ) {
    return `
I can help you report or understand an electricity fault, but I cannot
claim that your area currently has an outage without a verified live
source.

You can check ZETDC's official services or contact ZETDC:

${ZETDC.website}

Contact:
${ZETDC.contact}
`.trim();
  }

  if (
    text.includes("load shedding") ||
    text.includes("loadshed")
  ) {
    return `
Load-shedding schedules can change because of faults, network conditions
and interconnections. I cannot guarantee a live schedule from this app.

Check the official ZETDC load-shedding information:

${ZETDC.loadShedding}
`.trim();
  }

  if (
    text.includes("contact") ||
    text.includes("phone") ||
    text.includes("zetdc")
  ) {
    return `
ZETDC customer service information:

Phone: 704
Other listed contacts include:
08688003486
08688003485

Official website:
${ZETDC.website}

Contact page:
${ZETDC.contact}
`.trim();
  }

  if (
    text.includes("safe") ||
    text.includes("danger") ||
    text.includes("wire") ||
    text.includes("electric")
  ) {
    return `
Electrical safety:

• Stay away from fallen or exposed electrical wires.
• Do not touch electrical equipment with wet hands.
• Keep children away from damaged electrical infrastructure.
• Do not attempt dangerous repairs yourself.
• Report dangerous faults to the electricity utility or emergency services.

If there is immediate danger, move to a safe location first.
`.trim();
  }

  return `
I can help with:

• ZETDC services
• Power faults
• TID meter updates
• Prepaid tokens
• Load shedding information
• Customer service
• Electrical safety
• Finding official ZETDC resources

Ask me a specific question and I'll help.

Official ZETDC website:
${ZETDC.website}
`.trim();
}

async function getAIResponse(message) {
  const provider = (
    process.env.AI_PROVIDER || "custom"
  ).toLowerCase();

  try {
    if (provider === "gemini") {
      const answer = await callGemini(message);
      if (answer) return answer;
    }

    if (provider === "anthropic") {
      const answer = await callAnthropic(message);
      if (answer) return answer;
    }

    if (
      provider === "openai" ||
      provider === "custom"
    ) {
      const answer = await callOpenAICompatible(message);
      if (answer) return answer;
    }
  } catch (err) {
    console.error("AI error:", err.message);
  }

  return localAssistant(message);
}

// ============================================================
// RATE LIMITING
// ============================================================

const rateMap = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip =
      req.headers["x-forwarded-for"] ||
      req.socket.remoteAddress ||
      "unknown";

    const now = Date.now();

    let record = rateMap.get(ip);

    if (!record || now - record.start > windowMs) {
      record = {
        start: now,
        count: 0
      };
    }

    record.count++;
    rateMap.set(ip, record);

    if (record.count > maxRequests) {
      return res.status(429).json({
        error: "Too many requests. Please try again later."
      });
    }

    next();
  };
}

// ============================================================
// API ROUTES
// ============================================================

app.get("/api/health", async (req, res) => {
  let database = false;

  if (pool) {
    try {
      await pool.query("SELECT 1");
      database = true;
    } catch (_) {
      database = false;
    }
  }

  res.json({
    ok: true,
    app: "ZesaTracker",
    version: "1.0.0",
    database,
    aiProvider: process.env.AI_PROVIDER || "local-fallback",
    timestamp: new Date().toISOString()
  });
});

app.get("/api", (req, res) => {
  res.json({
    name: "ZesaTracker API",
    status: "online",
    endpoints: [
      "/api/health",
      "/api/ai",
      "/api/reports"
    ]
  });
});

// ============================================================
// AI API
// ============================================================

app.post(
  "/api/ai",
  rateLimit(15, 60 * 1000),
  async (req, res) => {
    try {
      const message = cleanText(req.body.message, 2000);

      if (!message) {
        return res.status(400).json({
          error: "Please enter a question."
        });
      }

      const answer = await getAIResponse(message);

      res.json({
        answer,
        provider: process.env.AI_PROVIDER || "local"
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: "The assistant is temporarily unavailable."
      });
    }
  }
);

// ============================================================
// REPORTS
// ============================================================

app.get("/api/reports", async (req, res) => {
  try {
    if (pool) {
      const result = await pool.query(`
        SELECT id, area, category, description, created_at
        FROM reports
        ORDER BY created_at DESC
        LIMIT 100
      `);

      return res.json({
        reports: result.rows
      });
    }

    return res.json({
      reports: memoryReports.slice(0, 100)
    });
  } catch (err) {
    console.error("Report read error:", err.message);

    res.status(500).json({
      error: "Unable to load reports."
    });
  }
});

app.post(
  "/api/reports",
  rateLimit(10, 60 * 1000),
  async (req, res) => {
    try {
      const area = cleanText(req.body.area, 120);
      const category = cleanText(req.body.category, 80);
      const description = cleanText(req.body.description, 1000);

      if (!area || !category || !description) {
        return res.status(400).json({
          error: "Area, category and description are required."
        });
      }

      if (area.length < 2) {
        return res.status(400).json({
          error: "Please provide a valid area."
        });
      }

      if (description.length < 5) {
        return res.status(400).json({
          error: "Please provide a little more detail."
        });
      }

      if (pool) {
        const result = await pool.query(
          `
          INSERT INTO reports
          (area, category, description)
          VALUES ($1, $2, $3)
          RETURNING id, area, category, description, created_at
          `,
          [area, category, description]
        );

        return res.status(201).json({
          report: result.rows[0]
        });
      }

      const report = {
        id: Date.now(),
        area,
        category,
        description,
        created_at: new Date().toISOString()
      };

      memoryReports.unshift(report);
      memoryReports = memoryReports.slice(0, 100);

      res.status(201).json({
        report
      });
    } catch (err) {
      console.error("Report creation error:", err.message);

      res.status(500).json({
        error: "Unable to submit report."
      });
    }
  }
);

// ============================================================
// MAIN WEBSITE
// ============================================================

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b63ce">
<meta name="description" content="ZesaTracker - Zimbabwe electricity companion">
<title>ZesaTracker</title>

<style>
* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  font-family:
    Inter, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI", sans-serif;
  color: #172033;
  background: #f4f7fb;
  line-height: 1.55;
}

a {
  color: inherit;
}

nav {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(255,255,255,.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid #e4e9f1;
}

.nav-inner {
  max-width: 1150px;
  margin: auto;
  padding: 13px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 900;
  font-size: 20px;
  color: #0b63ce;
}

.logo {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  background: #0b63ce;
  color: white;
  font-size: 21px;
}

.nav-links {
  display: flex;
  gap: 17px;
  font-size: 14px;
}

.nav-links a {
  text-decoration: none;
  color: #506078;
}

.hero {
  min-height: 490px;
  display: grid;
  place-items: center;
  padding: 70px 20px;
  color: white;
  background:
    linear-gradient(
      135deg,
      rgba(3,38,82,.93),
      rgba(11,99,206,.76)
    ),
    url("https://images.unsplash.com/photo-1473341304170-971dccb5ac1e?auto=format&fit=crop&w=1800&q=80")
    center/cover;
}

.hero-content {
  width: min(1100px,100%);
}

.badge {
  display: inline-block;
  padding: 7px 12px;
  border-radius: 99px;
  background: rgba(255,255,255,.16);
  border: 1px solid rgba(255,255,255,.25);
  font-size: 13px;
  margin-bottom: 15px;
}

.hero h1 {
  font-size: clamp(38px,7vw,70px);
  line-height: 1;
  margin: 0 0 20px;
  letter-spacing: -2px;
}

.hero p {
  max-width: 680px;
  font-size: 19px;
  opacity: .94;
}

.buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 27px;
}

.btn {
  border: 0;
  border-radius: 12px;
  padding: 13px 18px;
  text-decoration: none;
  cursor: pointer;
  font-weight: 800;
  display: inline-block;
}

.btn-primary {
  background: #ffd23f;
  color: #172033;
}

.btn-white {
  background: white;
  color: #0b63ce;
}

.container {
  width: min(1100px,calc(100% - 30px));
  margin: auto;
}

section {
  padding: 65px 0;
}

.section-title {
  font-size: 30px;
  margin: 0 0 8px;
}

.section-subtitle {
  margin-top: 0;
  color: #69778d;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3,1fr);
  gap: 18px;
}

.card {
  background: white;
  border: 1px solid #e4e9f1;
  border-radius: 18px;
  padding: 22px;
  box-shadow: 0 10px 35px rgba(15,35,70,.05);
}

.card h3 {
  margin-top: 5px;
}

.icon {
  font-size: 28px;
}

.link-card {
  text-decoration: none;
  display: block;
  transition: .2s;
}

.link-card:hover {
  transform: translateY(-3px);
}

.ai-box {
  background: linear-gradient(135deg,#082d5b,#0b63ce);
  border-radius: 24px;
  padding: 25px;
  color: white;
}

.chat {
  height: 310px;
  overflow-y: auto;
  background: rgba(255,255,255,.08);
  border-radius: 16px;
  padding: 15px;
  margin: 18px 0;
}

.msg {
  max-width: 85%;
  padding: 12px 15px;
  border-radius: 15px;
  margin: 8px 0;
  white-space: pre-wrap;
}

.msg.bot {
  background: white;
  color: #172033;
}

.msg.user {
  margin-left: auto;
  background: #ffd23f;
  color: #172033;
}

.ai-form {
  display: flex;
  gap: 10px;
}

input,
textarea,
select {
  width: 100%;
  padding: 13px 14px;
  border: 1px solid #d8dfeb;
  border-radius: 11px;
  background: white;
  font: inherit;
}

textarea {
  min-height: 130px;
  resize: vertical;
}

form {
  display: grid;
  gap: 12px;
}

.report {
  padding: 15px 0;
  border-bottom: 1px solid #e7ebf2;
}

.report:last-child {
  border-bottom: 0;
}

.report strong {
  color: #0b63ce;
}

.notice {
  background: #fff8dc;
  border: 1px solid #f2dc79;
  color: #5e4d00;
  padding: 15px;
  border-radius: 13px;
  margin: 20px 0;
}

.safety {
  background: #fff1f1;
  border-color: #ffcaca;
}

footer {
  background: #101827;
  color: #c7d0de;
  padding: 45px 0;
}

footer a {
  color: white;
}

.footer-grid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr;
  gap: 30px;
}

.small {
  color: #748197;
  font-size: 13px;
}

@media(max-width:800px) {
  .grid,
  .footer-grid {
    grid-template-columns: 1fr;
  }

  .nav-links {
    display: none;
  }

  .hero {
    min-height: 530px;
  }

  .hero h1 {
    letter-spacing: -1px;
  }

  .ai-form {
    flex-direction: column;
  }
}
</style>
</head>

<body>

<nav>
  <div class="nav-inner">
    <a class="brand" href="#home">
      <span class="logo">⚡</span>
      ZesaTracker
    </a>

    <div class="nav-links">
      <a href="#assistant">AI Assistant</a>
      <a href="#reports">Reports</a>
      <a href="#resources">ZETDC</a>
      <a href="#safety">Safety</a>
    </div>
  </div>
</nav>

<header class="hero" id="home">
  <div class="hero-content">
    <span class="badge">🇿🇼 Zimbabwe Electricity Companion</span>

    <h1>Power information, simplified.</h1>

    <p>
      Get help with ZETDC services, prepaid meters, TID updates,
      electricity faults, customer service and more.
    </p>

    <div class="buttons">
      <a class="btn btn-primary" href="#assistant">
        Ask the AI Assistant
      </a>

      <a class="btn btn-white" href="#reports">
        Report a Fault
      </a>
    </div>
  </div>
</header>

<section>
  <div class="container">

    <div class="grid">

      <a
        class="card link-card"
        href="${ZETDC.website}"
        target="_blank"
        rel="noopener"
      >
        <div class="icon">🏢</div>
        <h3>Official ZETDC</h3>
        <p>
          Access official ZETDC information and services.
        </p>
      </a>

      <a
        class="card link-card"
        href="${ZETDC.tidFaq}"
        target="_blank"
        rel="noopener"
      >
        <div class="icon">⚡</div>
        <h3>TID Meter Help</h3>
        <p>
          Read the official TID FAQ and meter upgrade information.
        </p>
      </a>

      <a
        class="card link-card"
        href="${ZETDC.loadShedding}"
        target="_blank"
        rel="noopener"
      >
        <div class="icon">🕒</div>
        <h3>Load Shedding</h3>
        <p>
          Check official ZETDC load-shedding information.
        </p>
      </a>

    </div>

    <div class="notice">
      <strong>Important:</strong>
      ZesaTracker does not invent live outage information.
      For current electricity status, always verify through official
      ZETDC channels.
    </div>

  </div>
</section>

<section id="assistant">
  <div class="container">

    <h2 class="section-title">AI Power Assistant</h2>

    <p class="section-subtitle">
      Ask about electricity tokens, TID, faults, safety and ZETDC services.
    </p>

    <div class="ai-box">

      <div id="chat" class="chat">
        <div class="msg bot">
          Hello! 👋 I'm the ZesaTracker Power Assistant.
          Ask me about ZETDC, TID, prepaid tokens, faults or electricity safety.
        </div>
      </div>

      <form id="aiForm" class="ai-form">
        <input
          id="aiInput"
          autocomplete="off"
          placeholder="e.g. How do I update my TID meter?"
          required
        />

        <button class="btn btn-primary" type="submit">
          Ask
        </button>
      </form>

    </div>

  </div>
</section>

<section id="reports">
  <div class="container">

    <h2 class="section-title">Community Fault Reports</h2>

    <p class="section-subtitle">
      Share a local electricity issue with other ZesaTracker users.
    </p>

    <div class="grid">

      <div class="card">

        <h3>Report a problem</h3>

        <form id="reportForm">

          <input
            id="area"
            placeholder="Area / suburb"
            maxlength="120"
            required
          />

          <select id="category" required>
            <option value="">Select category</option>
            <option>Power Outage</option>
            <option>Fault Report</option>
            <option>Load Shedding</option>
            <option>Meter Problem</option>
            <option>Token Problem</option>
            <option>Safety Issue</option>
            <option>Other</option>
          </select>

          <textarea
            id="description"
            placeholder="Describe the issue..."
            maxlength="1000"
            required
          ></textarea>

          <button class="btn btn-primary" type="submit">
            Submit Report
          </button>

        </form>

      </div>

      <div class="card">

        <h3>Recent community reports</h3>

        <div id="reportsList">
          Loading reports...
        </div>

      </div>

    </div>

  </div>
</section>

<section id="resources">
  <div class="container">

    <h2 class="section-title">Official ZETDC Resources</h2>

    <p class="section-subtitle">
      Quick access to official information.
    </p>

    <div class="grid">

      <a class="card link-card"
         href="${ZETDC.website}"
         target="_blank"
         rel="noopener">
        <div class="icon">🌐</div>
        <h3>ZETDC Website</h3>
        <p>Official website.</p>
      </a>

      <a class="card link-card"
         href="${ZETDC.contact}"
         target="_blank"
         rel="noopener">
        <div class="icon">☎️</div>
        <h3>Contact ZETDC</h3>
        <p>Customer contact information.</p>
      </a>

      <a class="card link-card"
         href="${ZETDC.tid}"
         target="_blank"
         rel="noopener">
        <div class="icon">🔢</div>
        <h3>TID Rollover</h3>
        <p>Official TID information.</p>
      </a>

      <a class="card link-card"
         href="${ZETDC.meterGuide}"
         target="_blank"
         rel="noopener">
        <div class="icon">🔌</div>
        <h3>Meter Upgrade Guide</h3>
        <p>Official meter upgrade instructions.</p>
      </a>

      <a class="card link-card"
         href="${ZETDC.generalFaq}"
         target="_blank"
         rel="noopener">
        <div class="icon">❓</div>
        <h3>General FAQs</h3>
        <p>Frequently asked questions.</p>
      </a>

      <a class="card link-card"
         href="${ZETDC.serviceCentres}"
         target="_blank"
         rel="noopener">
        <div class="icon">📍</div>
        <h3>Service Centres</h3>
        <p>Customer service centre information.</p>
      </a>

    </div>

  </div>
</section>

<section id="safety">
  <div class="container">

    <h2 class="section-title">Electrical Safety</h2>

    <div class="card safety">

      <h3>⚠️ Stay safe around electricity</h3>

      <ul>
        <li>Stay away from fallen or exposed power lines.</li>
        <li>Never touch electrical equipment with wet hands.</li>
        <li>Keep children away from electrical infrastructure.</li>
        <li>Do not attempt dangerous electrical repairs yourself.</li>
        <li>Report dangerous faults to the appropriate utility/service.</li>
      </ul>

      <strong>
        If there is immediate danger, move to a safe location first.
      </strong>

    </div>

  </div>
</section>

<section>
  <div class="container">

    <div class="card">

      <h2>Partner</h2>

      <p>
        ZesaTracker may contain a partner/referral link.
        This is not a ZETDC service.
      </p>

      <a
        class="btn btn-primary"
        href="${PARTNER_LINK}"
        target="_blank"
        rel="noopener sponsored"
      >
        Visit Partner
      </a>

    </div>

  </div>
</section>

<footer>

  <div class="container footer-grid">

    <div>
      <h2>⚡ ZesaTracker</h2>

      <p>
        An independent electricity information companion for Zimbabwe.
      </p>

      <p class="small">
        ZesaTracker is not ZETDC and does not represent ZETDC.
      </p>
    </div>

    <div>
      <h3>Links</h3>

      <p>
        <a href="${ZETDC.website}" target="_blank">
          Official ZETDC
        </a>
      </p>

      <p>
        <a href="${ZETDC.contact}" target="_blank">
          Contact
        </a>
      </p>
    </div>

    <div>
      <h3>App</h3>

      <p>
        Web version ready for testing.
      </p>

      <p class="small">
        © ${new Date().getFullYear()} ZesaTracker
      </p>
    </div>

  </div>

</footer>

<script>
const chat = document.getElementById("chat");
const aiForm = document.getElementById("aiForm");
const aiInput = document.getElementById("aiInput");

function addMessage(text, type) {
  const div = document.createElement("div");
  div.className = "msg " + type;
  div.textContent = text;
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

aiForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const message = aiInput.value.trim();

  if (!message) return;

  addMessage(message, "user");
  aiInput.value = "";

  addMessage("Thinking...", "bot");

  const thinking = chat.lastElementChild;

  try {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message
      })
    });

    const data = await response.json();

    thinking.remove();

    if (!response.ok) {
      addMessage(
        data.error || "Something went wrong.",
        "bot"
      );
      return;
    }

    addMessage(data.answer, "bot");

  } catch (error) {
    thinking.remove();

    addMessage(
      "I could not connect to the assistant. Please try again.",
      "bot"
    );
  }
});

async function loadReports() {
  const container = document.getElementById("reportsList");

  try {
    const response = await fetch("/api/reports");
    const data = await response.json();

    if (!data.reports || data.reports.length === 0) {
      container.innerHTML =
        "<p>No reports yet. Be the first to report an issue.</p>";
      return;
    }

    container.innerHTML = "";

    data.reports.forEach((report) => {
      const div = document.createElement("div");
      div.className = "report";

      const date = report.created_at
        ? new Date(report.created_at).toLocaleString()
        : "";

      div.innerHTML = \`
        <strong>\${escapeHTML(report.area)}</strong>
        <br>
        <span>\${escapeHTML(report.category)}</span>
        <p>\${escapeHTML(report.description)}</p>
        <small>\${escapeHTML(date)}</small>
      \`;

      container.appendChild(div);
    });

  } catch (error) {
    container.innerHTML =
      "<p>Unable to load reports right now.</p>";
  }
}

function escapeHTML(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document
  .getElementById("reportForm")
  .addEventListener("submit", async (event) => {

    event.preventDefault();

    const button = event.target.querySelector("button");

    button.disabled = true;
    button.textContent = "Submitting...";

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          area: document.getElementById("area").value,
          category: document.getElementById("category").value,
          description: document.getElementById("description").value
        })
      });

      const data = await response.json();

      if (!response.ok) {
        alert(data.error || "Unable to submit report.");
        return;
      }

      document.getElementById("reportForm").reset();

      alert("Report submitted successfully.");

      loadReports();

    } catch (error) {
      alert("Unable to submit report.");
    } finally {
      button.disabled = false;
      button.textContent = "Submit Report";
    }
  });

loadReports();
</script>

</body>
</html>`;

// ============================================================
// WEBSITE ROUTE
// ============================================================

app.get("/", (req, res) => {
  res.type("html").send(HTML);
});

// Simple privacy page
app.get("/privacy", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZesaTracker Privacy</title>
<style>
body{font-family:system-ui;max-width:850px;margin:40px auto;padding:20px;line-height:1.7}
a{color:#0b63ce}
</style>
</head>
<body>
<h1>ZesaTracker Privacy Policy</h1>

<p>
ZesaTracker is an independent electricity information application.
</p>

<h2>Information submitted by users</h2>

<p>
If you submit a community report, the area, category and description
may be stored so that reports can be displayed to other users.
</p>

<h2>AI Assistant</h2>

<p>
Questions sent to the AI assistant may be processed by the configured
AI provider. API credentials are kept on the server and are not
displayed to users.
</p>

<h2>Third-party services</h2>

<p>
ZesaTracker may link to official ZETDC resources and third-party
services. Those services have their own policies.
</p>

<p>
<a href="/">Back to ZesaTracker</a>
</p>
</body>
</html>
  `);
});

// Terms page
app.get("/terms", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ZesaTracker Terms</title>
<style>
body{font-family:system-ui;max-width:850px;margin:40px auto;padding:20px;line-height:1.7}
a{color:#0b63ce}
</style>
</head>
<body>
<h1>ZesaTracker Terms</h1>

<p>
ZesaTracker is an independent information and community platform.
It is not ZETDC and does not represent ZETDC.
</p>

<p>
Information provided by the AI assistant is for general guidance and
should not be treated as confirmation of live electricity status.
</p>

<p>
For official electricity information, users should verify information
through official ZETDC channels.
</p>

<p>
<a href="/">Back to ZesaTracker</a>
</p>
</body>
</html>
  `);
});

// ============================================================
// 404
// ============================================================

app.use((req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({
      error: "API endpoint not found."
    });
  }

  res.status(404).send(`
    <html>
    <head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Not Found</title>
      <style>
        body{
          font-family:system-ui;
          text-align:center;
          padding:80px 20px;
        }
        a{color:#0b63ce}
      </style>
    </head>
    <body>
      <h1>404</h1>
      <p>Page not found.</p>
      <a href="/">Return to ZesaTracker</a>
    </body>
    </html>
  `);
});

// ============================================================
// START
// ============================================================

async function start() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log("");
    console.log("====================================");
    console.log("       ZesaTracker is running");
    console.log("====================================");
    console.log("Port:", PORT);
    console.log("Database:", pool ? "Supabase/PostgreSQL" : "Memory");
    console.log(
      "AI:",
      process.env.AI_PROVIDER || "Local fallback"
    );
    console.log("");
  });
}

start().catch((err) => {
  console.error("Startup error:", err);
  process.exit(1);
});
