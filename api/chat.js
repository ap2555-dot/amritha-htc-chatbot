// Vercel serverless function: POST /api/chat
// Keeps GROQ_API_KEY on the server and forwards a bounded chat history to Groq.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

const MAX_MESSAGES = 12; // recent messages kept as context
const MAX_MESSAGE_CHARS = 2000; // per message
const MAX_TOTAL_CHARS = 12000; // across the whole history
const MAX_OUTPUT_TOKENS = 1024;
const TIMEOUT_MS = 25000;

const SYSTEM_PROMPT =
  'You are Orbit, a friendly, general-purpose AI assistant. ' +
  'Answer questions on any topic, explain concepts clearly, write and edit content, brainstorm ideas, ' +
  'and handle follow-up questions using the conversation so far. ' +
  'Be concise by default, go deeper when asked, and say so when you are unsure. ' +
  'Use plain text with short paragraphs; use lists or code blocks only when they help.';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch { return null; }
    }
    return req.body;
  }
  return null;
}

// Validate and trim the incoming history. Returns an array or null if invalid.
function cleanMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const cleaned = [];
  for (const m of input.slice(-MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') return null;
    const content = m.content.trim().slice(0, MAX_MESSAGE_CHARS);
    if (content) cleaned.push({ role: m.role, content });
  }
  // Enforce a total budget by dropping the oldest messages first.
  let total = cleaned.reduce((n, m) => n + m.content.length, 0);
  while (cleaned.length > 1 && total > MAX_TOTAL_CHARS) total -= cleaned.shift().content.length;
  // Must end on a user message, and start on one.
  while (cleaned.length && cleaned[0].role !== 'user') cleaned.shift();
  if (!cleaned.length || cleaned[cleaned.length - 1].role !== 'user') return null;
  return cleaned;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { error: 'Method not allowed.' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return send(res, 500, { error: 'Server is missing GROQ_API_KEY. Add it in your environment variables.' });
  }

  const body = readBody(req);
  const messages = cleanMessages(body && body.messages);
  if (!messages) {
    return send(res, 400, { error: 'Send a "messages" array that ends with a user message.' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(GROQ_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || DEFAULT_MODEL,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, ...messages],
        temperature: 0.7,
        max_tokens: MAX_OUTPUT_TOKENS,
      }),
    });

    const data = await upstream.json().catch(() => null);

    if (!upstream.ok) {
      const detail = data && data.error && data.error.message;
      console.error('Groq error', upstream.status, detail);
      const status = upstream.status === 429 ? 429 : 502;
      const msg = upstream.status === 429
        ? 'Orbit is getting too many requests right now. Try again in a moment.'
        : 'The AI service returned an error. Please try again.';
      return send(res, status, { error: msg });
    }

    const reply = data && data.choices && data.choices[0] && data.choices[0].message &&
      data.choices[0].message.content;
    if (!reply) return send(res, 502, { error: 'The AI service returned an empty response.' });

    return send(res, 200, { reply: reply.trim() });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      return send(res, 504, { error: 'The request timed out. Please try again.' });
    }
    console.error('Chat handler failed', err && err.message);
    return send(res, 502, { error: 'Could not reach the AI service. Please try again.' });
  } finally {
    clearTimeout(timer);
  }
};
