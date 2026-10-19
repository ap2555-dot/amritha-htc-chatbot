# Orbit

A general-purpose AI chatbot with a pixel-art robot, powered by Groq. Plain HTML/CSS/JS plus one Vercel serverless function (`api/chat.js`). No auth, database or payments.

## Run locally
```
cp .env.example .env     # then put your key in .env (never commit it)
npm run dev              # http://localhost:3000
```
Or with the Vercel CLI: `vercel dev`.

## Deploy on Vercel
1. Push this folder to a GitHub repo and import it in Vercel (framework preset: **Other**, no build command).
2. Project Settings → Environment Variables: add `GROQ_API_KEY` (required) and optionally `GROQ_MODEL` (default `openai/gpt-oss-120b`).
3. Redeploy so the variables take effect.

## Limits (in `api/chat.js`)
12 recent messages, 2000 chars per message, 12000 chars total, 2048 output tokens, 25 s upstream timeout.
