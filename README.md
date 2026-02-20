# Telegram AI Video Bot (Dr. Affiliate) 🎬🤖

A powerful, interactive Telegram bot for automated AI video generation. This project uses a modular architecture with a dedicated `bot-engine` and a high-performance `video-engine`.

## 🚀 Features
- **Interactive AI Wizard**: Step-by-step video creation via Telegram commands.
- **Multi-TTS Support**: Choose between Kie.ai (ElevenLabs), OpenAI (Sumopod), and Hugging Face voices.
- **Dynamic Asset Selection**: Integration with Pexels for high-quality stock footage.
- **Animated Subtitles**: Word-highlighted subtitles (synced with voice-over).
- **Fastify-based Architecture**: Modern, high-performance Node.js servers.

## 📁 Project Structure
- `bot-engine/`: The Telegram bot logic and state machine.
- `video-engine/`: The FFmpeg-powered composition and rendering engine.
- `video-engine/src/modules/voice/`: Modular TTS providers (Kie, OpenAI, Hugging Face).

## 🛠️ Setup
See `BOT_SETUP.md` for detailed instructions on how to run the bot and engine locally.

## 📄 License
MIT
