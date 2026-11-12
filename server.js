import "dotenv/config";
import express from "express";
import pdf from "pdf-parse/lib/pdf-parse.js";

const PORT = process.env.PORT || 3000;
const BASE = (process.env.API_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || "gpt-6-astra";
// Cost protection (all adjustable in .env)
const DAILY_LIMIT = Number(process.env.DAILY_LIMIT || 15); // messages per visitor per day
const GLOBAL_DAILY_LIMIT = Number(process.env.GLOBAL_DAILY_LIMIT || 1000); // messages for everyone per day
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 10); // past messages sent to the model
const MAX_TOKENS = Number(process.env.MAX_TOKENS || 0); // optional reply cap, 0 = off
// Image generation (images cost more than text, so the limits are tighter)
const IMAGE_MODEL = process.env.IMAGE_MODEL || "gpt-image-1";
const IMAGE_DAILY_LIMIT = Number(process.env.IMAGE_DAILY_LIMIT || 3); // per visitor per day
const IMAGE_GLOBAL_DAILY_LIMIT = Number(process.env.IMAGE_GLOBAL_DAILY_LIMIT || 50); // whole app per day
const SYSTEM =
  "You are My First AI, a sharp, friendly assistant inside a chat app. Be honest, concise and easy to read on a phone: short paragraphs, simple words, examples when they help. When given text from a PDF, summarize it accurately: main point first, then key points, and say clearly if something is not in the document. Keep answers under about 250 words unless the user asks for more detail.";

const app = express();
app.set("trust proxy", 1); // so each visitor gets their own limit behind a host's proxy
app.use(express.json({ limit: "15mb" })); // PDFs arrive as base64
app.use(express.static("public"));

// Simple per-IP rate limit: 20 requests per minute.
const hits = new Map();
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
function limit(req, res, next) {
  const now = Date.now();
  const recent = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  if (recent.length >= 20) return res.status(429).json({ error: "Too many requests. Wait a minute." });
  recent.push(now);
  hits.set(req.ip, recent);
  next();
}

// Daily message caps: one per visitor, one for the whole app. Resets each UTC day.
let day = "", perIp = new Map(), total = 0;
function daily(req, res, next) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; perIp = new Map(); total = 0; }
  if (total >= GLOBAL_DAILY_LIMIT) {
    return res.status(429).json({ error: "The app has reached its daily limit. Please come back tomorrow." });
  }
  const used = perIp.get(req.ip) || 0;
  if (used >= DAILY_LIMIT) {
    return res.status(429).json({ error: `You have used your ${DAILY_LIMIT} free messages for today. Come back tomorrow!` });
  }
  perIp.set(req.ip, used + 1);
  total++;
  next();
}

let imgDay = "", imgPerIp = new Map(), imgTotal = 0;
function imageDaily(req, res, next) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== imgDay) { imgDay = today; imgPerIp = new Map(); imgTotal = 0; }
  if (imgTotal >= IMAGE_GLOBAL_DAILY_LIMIT) {
    return res.status(429).json({ error: "The app has reached its daily image limit. Please come back tomorrow." });
  }
  const used = imgPerIp.get(req.ip) || 0;
  if (used >= IMAGE_DAILY_LIMIT) {
    return res.status(429).json({ error: `You have used your ${IMAGE_DAILY_LIMIT} free images for today. Come back tomorrow!` });
  }
  imgPerIp.set(req.ip, used + 1);
  imgTotal++;
  next();
}
// Give the visitor their image back if generation failed.
function refundImage(ip) {
  imgPerIp.set(ip, Math.max(0, (imgPerIp.get(ip) || 1) - 1));
  imgTotal = Math.max(0, imgTotal - 1);
}

// Optional access code so strangers can't spend your API credits.
function auth(req, res, next) {
  const code = process.env.ACCESS_CODE;
  if (code && req.get("x-access-code") !== code) {
    return res.status(401).json({ error: "Wrong or missing access code." });
  }
  next();
}

// The frontend sends PDFs as base64 blocks. Turn each message into plain text.
async function toText(m) {
  if (typeof m.content === "string") {
    return { role: m.role, content: m.role === "user" ? m.content.slice(0, 4000) : m.content };
  }
  let out = "";
  for (const b of m.content) {
    if (b.type === "document") {
      try {
        const r = await pdf(Buffer.from(b.source.data, "base64"));
        out += r.text.trim()
          ? `[Text from the attached PDF]\n${r.text.slice(0, 30000)}\n\n`
          : "[The attached PDF has no readable text. It may be scanned.]\n\n";
      } catch {
        out += "[The attached PDF could not be read.]\n\n";
      }
    } else if (b.type === "text") out += String(b.text).slice(0, 4000);
  }
  return { role: m.role, content: out };
}

app.post("/api/chat", auth, limit, daily, async (req, res) => {
  const { messages } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages is required" });
  }
  if (!KEY) return res.status(500).json({ error: "Server is missing API_KEY." });

  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (o) => res.write("data: " + JSON.stringify(o) + "\n\n");
  const ac = new AbortController();
  res.on("close", () => ac.abort());

  try {
    const msgs = await Promise.all(messages.slice(-MAX_HISTORY).map(toText));
    const r = await fetch(BASE + "/chat/completions", {
      method: "POST",
      signal: ac.signal,
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        ...(MAX_TOKENS ? { max_completion_tokens: MAX_TOKENS } : {}),
        messages: [{ role: "system", content: SYSTEM }, ...msgs],
      }),
    });
    if (!r.ok) throw new Error(`Provider error ${r.status}: ${(await r.text()).slice(0, 200)}`);

    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of r.body) {
      buf += dec.decode(chunk, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const l of lines) {
        if (!l.startsWith("data:")) continue;
        const d = l.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const t = JSON.parse(d).choices?.[0]?.delta?.content;
          if (t) send({ t });
        } catch {}
      }
    }
    send({ done: true });
  } catch (e) {
    if (!ac.signal.aborted) send({ error: e?.message || "Request failed" });
  }
  res.end();
});

app.post("/api/image", auth, limit, imageDaily, async (req, res) => {
  const prompt = String(req.body?.prompt || "").trim().slice(0, 1000);
  if (!prompt) { refundImage(req.ip); return res.status(400).json({ error: "Describe the image you want." }); }
  if (!KEY) { refundImage(req.ip); return res.status(500).json({ error: "Server is missing API_KEY." }); }
  try {
    const r = await fetch(BASE + "/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify({ model: IMAGE_MODEL, prompt, size: "1024x1024", n: 1 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      refundImage(req.ip);
      return res.status(502).json({ error: j?.error?.message || `Provider error ${r.status}` });
    }
    const d = j.data?.[0];
    const url = d?.b64_json ? `data:image/png;base64,${d.b64_json}` : d?.url;
    if (!url) { refundImage(req.ip); return res.status(502).json({ error: "The provider returned no image." }); }
    res.json({ url });
  } catch (e) {
    refundImage(req.ip);
    res.status(500).json({ error: e?.message || "Image request failed" });
  }
});

app.listen(PORT, () => console.log(`My First AI running on http://localhost:${PORT}`));
