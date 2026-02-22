# Telegram AI Video & Semantic Bot (Dr. Affiliate) 🎬🧠🤖

A powerful, interactive Telegram bot that serves as a unified hub for automated AI video generation and intelligent semantic file management. 

This project uses a modular, 4-engine microservice architecture built on Node.js and Fastify.

## 🚀 Key Features

### 🎬 AI Video Generation
- **Interactive AI Wizard**: Step-by-step video creation via Telegram commands (8-step factory flow).
- **Multi-TTS Support**: Choose between Kie.ai (ElevenLabs), OpenAI (Sumopod), HuggingFace, and Google TTS.
- **Dynamic Asset Selection**: Auto-fetching from Pexels & Pixabay for stock footage and background music.
- **Animated Subtitles**: CapCut-style per-word highlighted subtitles synced precisely with the voice-over.

### 🧠 Semantic Engine & File Manager
- **Multimodal RAG Engine**: Upload any file (PDF, TXT, MP4, MP3, JPG) via Telegram. The engine automatically extracts text, transcribes audio (Whisper), and analyzes video frames (Vision API).
- **Vector Search (Qdrant)**: All extracted content is chunked, embedded via `text-embedding-3-small`, and stored in a Qdrant Vector Database.
- **Natural Language Query**: Use `/search [query]` to find exact moments in videos or specific paragraphs in PDFs. The bot uses an LLM to answer your questions conversationally based on your private files.
- **Cloudflare R2 Storage**: Infinite, S3-compatible cloud storage for all source materials.

### ⚡ Ultra-Fast YouTube Integration
- **Direct-to-Cloud Downloading**: Send a YouTube link via `/yt` or `/ytsave`. The engine downloads the video and streams it directly to your private R2 bucket.
- **Aria2c Acceleration**: Built-in 16-connection multiplexing via `aria2c` to completely bypass YouTube's 60KiB/s bandwidth throttling, achieving multi-megabyte download speeds (requires `aria2` installed on host).
- **Zero-Download Semantic Indexing**: `/ytsave` registers the downloaded YouTube video directly into the Semantic Engine without bouncing the massive video file back through your bot server's RAM.

## 📁 Architecture Structure
- `bot-engine/` — Telegram bot logic, AI wizard, state machine, and user interface.
- `video-engine/` — FFmpeg-powered composition engine, TTS rendering, and stock asset integration.
- `youtube-engine/` — Ultra-fast YouTube downloader utilizing `yt-dlp` + `aria2c` and direct R2 uploading.
- `semantic-engine/` — Document & Media parsing, Embedding pipelines, Qdrant db syncing, and background workers.

## 🛠️ Setup & Installation

### Prerequisites
- Ubuntu/Linux (Recommended) or Windows
- Node.js >= 18
- `ffmpeg` (for video rendering)
- `aria2` (for fast YouTube downloads)

### 1-Click Installation (Ubuntu)
You can use the automated setup script on a fresh Ubuntu server:
```bash
chmod +x setup_ubuntu.sh
./setup_ubuntu.sh
```

### Manual Quick Start
```bash
# Install dependencies for all 4 engines
cd bot-engine && npm install && cd ..
cd video-engine && npm install && cd ..
cd youtube-engine && npm install && cd ..
cd semantic-engine/backend && npm install && cd ../..

# Development (Run in separate terminal tabs)
cd bot-engine && npm run dev                # Port 3001
cd video-engine && npm run dev              # Port 3000
cd youtube-engine && npm run dev            # Port 3002
cd semantic-engine/backend && npm run dev   # Port 3003

# Production
pm2 start ecosystem.config.cjs
pm2 logs
```

## 🔐 Environment Variables
Copy `.env.example` to `.env` in each service directory. Key variables include:

| Variable | Service | Required | Purpose |
|---|---|---|---|
| `ENV_BOT_TOKEN` | bot-engine | ✅ | Telegram Bot Token |
| `LLM_API_KEY` | bot/semantic | ✅ | OpenAI/Sumopod API key |
| `QDRANT_URL` / `API_KEY`| semantic | ✅ | Qdrant Cloud Vector Database |
| `SUPABASE_URL` / `KEY`| semantic | ✅ | PostgreSQL (Users, Folders, Files) |
| `S3_ENDPOINT` | video/yt/semantic | ✅ | Cloudflare R2 / S3 storage |
| `S3_ACCESS_KEY` | video/yt/semantic | ✅ | R2 Credentials |

See each service's `.env` or `.env.example` file for the comprehensive list.

## 📄 License
MIT
