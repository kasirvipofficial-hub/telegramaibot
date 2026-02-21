# Telegram AI Video Bot (Dr. Affiliate) 🎬🤖

A powerful, interactive Telegram bot for automated AI video generation. This project uses a modular architecture with a dedicated `bot-engine`, a high-performance `video-engine`, and a `youtube-engine`.

## 🚀 Features
- **Interactive AI Wizard**: Step-by-step video creation via Telegram commands (8-step factory flow).
- **Multi-TTS Support**: Choose between Kie.ai (ElevenLabs), OpenAI (Sumopod), HuggingFace, and Google TTS with automatic fallback.
- **Dynamic Asset Selection**: Integration with Pexels & Pixabay for high-quality stock footage and background music.
- **Animated Subtitles**: CapCut-style per-word highlighted subtitles (synced with voice-over).
- **YouTube Downloader**: Download YouTube videos via `/yt` command, streamed directly to R2 storage.
- **Fastify-based Architecture**: Modern, high-performance Node.js servers.

## 🛡️ Security
- **User Whitelist**: Restrict bot access via `ALLOWED_CHAT_IDS` environment variable.
- **Webhook Validation**: Telegram webhook secret verification on every incoming update.
- **Rate Limiting**: 20 messages/minute and 3 job submissions/hour per user.
- **API Key Auth**: Optional Bearer/API key authentication on video-engine endpoints.

## 📁 Project Structure
- `bot-engine/` — Telegram bot logic, AI brainstorming wizard, and state machine.
- `video-engine/` — FFmpeg-powered composition engine with job queue, TTS, stock search, and S3 upload.
- `youtube-engine/` — YouTube downloader (yt-dlp) with R2 streaming upload.

## 🛠️ Setup

### Prerequisites
- Node.js >= 18
- FFmpeg installed and in PATH
- PM2 (for production)

### Quick Start
```bash
# Install dependencies
cd bot-engine && npm install && cd ..
cd video-engine && npm install && cd ..
cd youtube-engine && npm install && cd ..

# Development (with auto-restart)
cd bot-engine && npm run dev      # Port 3001
cd video-engine && npm run dev    # Port 3000
cd youtube-engine && npm run dev  # Port 3002

# Production
pm2 start ecosystem.config.cjs
pm2 logs
```

### Environment Variables
Copy `.env.example` to `.env` in each service directory. Key variables:

| Variable | Service | Required |
|---|---|---|
| `ENV_BOT_TOKEN` | bot-engine | ✅ Telegram Bot Token |
| `ENV_BOT_SECRET` | bot-engine | ✅ Webhook Secret |
| `ALLOWED_CHAT_IDS` | bot-engine | Optional whitelist |
| `LLM_API_KEY` | bot-engine | ✅ OpenAI/LLM API key |
| `KIE_AI_API_KEY` | video-engine | TTS (Kie.ai) |
| `PEXELS_API_KEY` | video-engine | Stock video search |
| `PIXABAY_API_KEY` | video-engine | Stock video + music |
| `S3_ENDPOINT` | video/youtube | ✅ R2/S3 storage |
| `S3_ACCESS_KEY` | video/youtube | ✅ R2/S3 credentials |

See each service's `.env` file for the full list.

## 📄 License
MIT
