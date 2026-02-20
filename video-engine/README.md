# FFmpeg Video Engine Server

A production-grade, REST API-controlled video processing engine built with Node.js and Fastify. Designed for high-performance video assembly and complex composition using FFmpeg.

## 🚀 Features

- **Dual-Engine Architecture**:
  - **Assembly Engine**: Extremely fast slicing and concatenation using stream copy (no re-encoding).
  - **Composition Engine**: Complex rendering with templates, subtitles (ASS), transitions, and audio mixing.
- **Job Queue System**: In-memory queue with filesystem persistence for crash recovery.
- **REST API**: Simple, strict JSON contract for job submission and management.
- **Resource Management**: Concurrency limits and automatic workspace cleanup.
- **Observability**: Built-in metrics and status tracking.

## 🛠️ Installation

1.  **Prerequisites**:
    - Node.js >= 18
    - FFmpeg installed and available in system PATH.

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Start Server**:
    ```bash
    npm start
    ```
    Server runs on port `3000` by default.

### 3. S3/R2 Configuration
Create a `.env` file in the root:
```ini
PORT=3000
S3_ENDPOINT=https://<accountid>.r2.cloudflarestorage.com
S3_BUCKET=my-bucket
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=xxx
S3_PUBLIC_URL=https://pub-xxx.r2.dev
```

## 🏃 Quick Start

### Check Health
```bash
curl http://localhost:3000/health
```

### Submit an Assembly Job (Fast Cut & Merge)
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "assembly",
    "assembly": {
      "timeline": [
        { "source_url": "https://example.com/part1.mp4", "start": 0, "end": 10 },
        { "source_url": "https://example.com/part2.mp4", "start": 5, "end": 15 }
      ]
    }
  }'
```

### Submit a Job with Webhook & Templates
```bash
curl -X POST http://localhost:3000/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "composition",
    "webhook_url": "https://n8n.example.com/webhook/video-done",
    "composition": {
      "input": "https://example.com/bg.mp4",
      "template_id": "shorts_modern_v1",
      "template_variables": {
        "title": "My Dynamic Title",
        "color": "&H0000FF"
      },
      "subtitles": [
          { "text": "Hello World", "start": 0, "end": 2 }
      ]
    }
  }'
```

## 📚 Documentation

- [Architecture & Flow](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
