# API Reference

## Base URL
`http://localhost:3000`

## Endpoints

### 1. Check Server Status
**GET** `/health`

Returns server uptime and metrics.

**Response:**
```json
{
  "status": "ok",
  "uptime": 1245.5,
  "metrics": {
    "active_jobs": 1,
    "completed_jobs": 42,
    "failed_jobs": 0,
    "average_time_ms": 5400
  }
}
```

---

### 2. Submit Job
**POST** `/jobs`

Queues a new video processing job.

**Headers:**
- `Content-Type: application/json`

**Body (Assembly Mode):**
```json
{
  "mode": "assembly",
  "assembly": {
    "timeline": [
      {
        "source_url": "https://example.com/clip1.mp4",
        "start": 0,
        "end": 5.5
      }
    ]
  }
}
```

**Body (Composition Mode - Full Options):**
```json
{
  "mode": "composition",
  "webhook_url": "https://callback.com/hook",
  "composition": {
    "template_id": "shorts_modern_v1",
    "output_format": "shorts",
    "quality": "draft",
    "progress_bar": true,
    "progress_bar_color": "white@0.8",
    
    "clips": [
      {
        "url": "https://example.com/video.mp4",
        "speed": 1.2,
        "duration": 5,
        "transition": { "type": "fade", "duration": 0.5 }
      },
      {
        "query": "nature forest",
        "duration": 5,
        "orientation": "portrait",
        "blur_background": true
      },
      {
        "url": "https://example.com/photo.jpg",
        "type": "image",
        "duration": 5,
        "effect": "ken_burns_zoom_in"
      }
    ],

    "voice_over": {
      "text": "Your narration text here.",
      "voice": "id-ID-Standard-A",
      "word_highlight": true,
      "highlight_color": "&H0000FFFF"
    },

    "srt_content": "1\n00:00:01,000 --> 00:00:03,000\nHello World",
    
    "overlays": [
      {
        "url": "https://example.com/logo.png",
        "position": "top-right",
        "opacity": 0.5,
        "start": 0,
        "end": 10
      }
    ],

    "thumbnail": { "time": 2.5 }
  }
}
```

#### Fields Reference (Composition):

| Field | Type | Description |
|---|---|---|
| `template_id` | String | Template to use (e.g. `motivational`, `aesthetic_vlog`) |
| `output_format` | String | Resolution preset: `shorts`, `landscape`, `square`, `portrait_4_5` |
| `quality` | String | `draft` (fast, low res) or `full` (production) |
| `clips[]` | Array | List of video/image inputs |
| `clips[].url` | String | Direct URL to asset |
| `clips[].query` | String | Search keyword for Pexels/Pixabay |
| `clips[].speed` | Number | Playback speed (0.25 to 4.0) |
| `clips[].transition` | Object | `{ type, duration }` - 25+ types (fade, slide, etc.) |
| `clips[].effect` | String | Image effect: `ken_burns_zoom_in`, `ken_burns_pan_right`, etc. |
| `clips[].blur_background` | Boolean | Enable background blur for aspect ratio mismatch |
| `progress_bar` | Boolean | Enable filling progress bar at bottom |
| `voice_over` | Object/String| URL or TTS object with `text` and `word_highlight` |
| `srt_content` | String | Raw SRT text to be converted to ASS subtitles |

**Response:**
```json
{
  "job_id": "b3f02890-...",
  "status": "queued"
}
```

---

### 3. SSE Progress Stream
**GET** `/jobs/:job_id/stream`

Real-time progress updates using Server-Sent Events.

**Events:**
- `progress`: Basic progress info (stage, message, clip index)
- `done`: Final result metadata
- `error`: Error details if failed

**Example Client:**
```javascript
const es = new EventSource('/jobs/JOB_ID/stream');
es.addEventListener('progress', e => console.log(JSON.parse(e.data)));
```

---

### 4. Get Job Status
**GET** `/jobs/:job_id`

Returns job metadata and current state.

**Response:**
```json
{
  "id": "b3f02890-...",
  "status": "processing",
  "created_at": "2024-02-19T10:00:00Z",
  "payload": { ... },
  "result": null
}
```

**Response (When Done):**
```json
{
  "id": "b3f02890-...",
  "status": "done",
  "result": {
    "outputFile": "/path/to/server/tmp/b3f0.../output.mp4"
  }
}
```

---

### 5. Get Job Result
**GET** `/jobs/:job_id/result`

Returns final video URL and thumbnail metadata.

---

### 6. Cancel Job
**DELETE** `/jobs/:job_id`

Stop processing and cleanup.

**Response:**
```json
{
  "status": "cancelled"
}
```
