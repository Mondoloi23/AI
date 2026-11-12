# My First AI

A mobile-friendly AI chat app with its own backend. Your API token stays on the server, never in the browser. Works with any OpenAI-compatible provider (OpenAI, routers like AgentRouter, and others).

**Features:** streaming replies, conversation memory, chat history (saved in the browser), PDF upload and summaries, image generation (toggle "Image" in the header), voice input, text-to-speech, light and dark mode.

## Run it

```bash
npm install
cp .env.example .env     # then fill in API_KEY and API_BASE_URL
npm start
```

Open http://localhost:3000.

## Structure

```
server.js          Express backend: /api/chat streams replies from your provider
public/index.html  The whole frontend (HTML, CSS, JS in one file)
.env.example       Settings template (copy to .env)
```

## Settings (.env)

| Variable | What it does |
|---|---|
| `API_KEY` | Your provider token. Required. |
| `API_BASE_URL` | Provider's OpenAI-compatible URL, usually ending in `/v1`. |
| `MODEL` | Model ID. Default `gpt-6-astra`. `gpt-6.1-sol` is a cheaper option. |
| `PORT` | Server port. Default `3000`. |
| `ACCESS_CODE` | Optional. If set, users must enter it before chatting. |
| `DAILY_LIMIT` | Messages each visitor can send per day. Default `15`. |
| `GLOBAL_DAILY_LIMIT` | Total messages per day across all visitors. Default `1000`. |
| `MAX_HISTORY` | Past messages sent with each request. Default `10`. |
| `IMAGE_MODEL` | Image model ID on your provider. Default `gpt-image-1`. |
| `IMAGE_DAILY_LIMIT` | Images per visitor per day. Default `3`. |
| `IMAGE_GLOBAL_DAILY_LIMIT` | Images per day for everyone. Default `50`. |
| `MAX_TOKENS` | Optional reply length cap. Off by default. |

## Deploy

Works on any Node host (Render, Railway, Fly.io). Start command: `npm start`. Add the environment variables in the host's dashboard. **Never commit `.env`.**

Before sharing the link publicly, set `ACCESS_CODE`. Without it, anyone with the link can spend your credits. The server also limits each IP to 20 requests per minute.

## Notes and limits

- Limits are stored in memory, so they reset when the server restarts. Use a database for permanent limits.
- PDFs are read on the server (text only, first 30,000 characters, up to 10 MB). Scanned PDFs have no text and are not supported yet.
- The PDF stays in memory for the current session. After a refresh the chat text is kept but the file is not.
- Image generation only works if your provider offers an image model. Generated images are not saved after a refresh, so tap "Save image" to keep them.
- Web search is not included in this version.

## Ideas for next steps

- OCR for scanned PDFs
- User accounts and a database so history syncs across devices
- Web search, and a model picker in the UI
