import Fastify from 'fastify';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import OpenAI from 'openai';

dotenv.config();

const fastify = Fastify({ logger: true });

// Constants from Environment
const TOKEN = process.env.ENV_BOT_TOKEN;
const WEBHOOK_PATH = '/endpoint';
const SECRET = process.env.ENV_BOT_SECRET;
const ENGINE_BASE_URL = (process.env.ENV_ENGINE_URL || 'http://localhost:3000').replace(/\/$/, '');
const YOUTUBE_ENGINE_URL = (process.env.ENV_YOUTUBE_ENGINE_URL || 'http://localhost:3002').replace(/\/$/, '');
const SEMANTIC_ENGINE_URL = (process.env.SEMANTIC_ENGINE_URL || 'http://localhost:3003').replace(/\/$/, '');

// LLM Configuration
const openai = new OpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
});

// === SECURITY: User Whitelist ===
const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS
    ? process.env.ALLOWED_CHAT_IDS.split(',').map(id => parseInt(id.trim())).filter(Boolean)
    : [];

function isAuthorized(chatId) {
    if (ALLOWED_CHAT_IDS.length === 0) return true;
    return ALLOWED_CHAT_IDS.includes(chatId);
}

// === SECURITY: Rate Limiter (sliding window) ===
class RateLimiter {
    constructor() { this.windows = new Map(); }
    check(key, limit, windowMs) {
        const now = Date.now();
        if (!this.windows.has(key)) this.windows.set(key, []);
        const stamps = this.windows.get(key).filter(t => now - t < windowMs);
        this.windows.set(key, stamps);
        if (stamps.length >= limit) return false;
        stamps.push(now);
        return true;
    }
}
const rateLimiter = new RateLimiter();

// === Session Store (file-persisted) ===
class SessionStore {
    constructor(filePath) {
        this.filePath = filePath;
        this.sessions = new Map();
        this._load();
        setInterval(() => this._cleanup(), 10 * 60 * 1000); // cleanup every 10 min
    }
    _load() {
        try {
            if (fs.existsSync(this.filePath)) {
                const data = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
                for (const [k, v] of Object.entries(data)) {
                    this.sessions.set(parseInt(k), v);
                }
                console.log(`📂 Loaded ${this.sessions.size} sessions from disk`);
            }
        } catch (e) { console.warn('Session load failed:', e.message); }
    }
    _save() {
        try {
            const obj = Object.fromEntries(this.sessions);
            fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2));
        } catch (e) { console.warn('Session save failed:', e.message); }
    }
    _cleanup(maxAgeMs = 3600000) {
        const now = Date.now();
        let cleaned = 0;
        for (const [k, v] of this.sessions) {
            if (now - (v._ts || 0) > maxAgeMs) { this.sessions.delete(k); cleaned++; }
        }
        if (cleaned > 0) { this._save(); console.log(`🧹 Cleaned ${cleaned} stale sessions`); }
    }
    get(key) { return this.sessions.get(key); }
    set(key, value) { value._ts = Date.now(); this.sessions.set(key, value); this._save(); }
    delete(key) { this.sessions.delete(key); this._save(); }
}

// User Session Tracking (persisted to file)
const userStates = new SessionStore(path.resolve('sessions.json'));

if (!TOKEN) {
    console.error('FATAL: ENV_BOT_TOKEN is missing in .env');
    process.exit(1);
}

// Platforms Constraint Context
const PLATFORMS = {
    tiktok: { ratio: "9:16", resolution: "1080x1920", max_duration: 60, safe_duration: [7, 15, 30, 45, 60] },
    reels: { ratio: "9:16", resolution: "1080x1920", max_duration: 90, safe_duration: [15, 30, 60] },
    shorts: { ratio: "9:16", resolution: "1080x1920", max_duration: 60, safe_duration: [15, 30, 60] },
    youtube: { ratio: "16:9", resolution: "1920x1080", max_duration: 600, safe_duration: [60, 180, 300, 600] }
};

// --- Idempotency: Prevent duplicate delivery ---
const deliveredJobs = new Set();
function isAlreadyDelivered(jobId) {
    return deliveredJobs.has(jobId);
}
function markAsDelivered(jobId) {
    deliveredJobs.add(jobId);
    // Auto-clean after 1 hour to prevent memory leak
    setTimeout(() => deliveredJobs.delete(jobId), 3600000);
}

/**
 * UTILS & TELEGRAM API
 */
function apiUrl(methodName, params = null) {
    let query = '';
    if (params) {
        query = '?' + new URLSearchParams(params).toString();
    }
    return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

async function sendMarkdownV2Text(chatId, text, replyMarkup = null) {
    const payload = {
        chat_id: chatId,
        text,
        parse_mode: 'MarkdownV2'
    };
    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    }
    const res = await fetch(apiUrl('sendMessage'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!result.ok) {
        console.error('❌ Telegram Send Error:', JSON.stringify(result));
    } else {
        console.log(`✅ Message sent to ${chatId}`);
    }
    return result;
}

async function editMessageText(chatId, messageId, text, replyMarkup = null) {
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text,
        parse_mode: 'MarkdownV2'
    };
    if (replyMarkup) {
        payload.reply_markup = JSON.stringify(replyMarkup);
    }
    const res = await fetch(apiUrl('editMessageText'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (!result.ok) {
        console.error('❌ Telegram Edit Error:', JSON.stringify(result));
    }
    return result;
}

async function sendVideo(chatId, videoUrl, caption = '') {
    try {
        console.log(`[Telegram] Fetching video from R2 for direct upload: ${videoUrl}`);
        const videoRes = await fetch(videoUrl);
        if (!videoRes.ok) throw new Error(`R2 Fetch Failed: ${videoRes.statusText}`);

        const blob = await videoRes.blob();
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('caption', caption);
        formData.append('parse_mode', 'MarkdownV2');
        formData.append('video', blob, 'video.mp4');

        const res = await fetch(apiUrl('sendVideo'), {
            method: 'POST',
            body: formData
        });

        const result = await res.json();
        console.log(`[Telegram] sendVideo result for ${chatId}:`, JSON.stringify(result));
        return result;
    } catch (err) {
        console.error(`[Telegram] Direct upload failed:`, err.message);
        return { ok: false, error: err.message };
    }
}

async function deliverJobResult(chatId, jobId, result, status, error, queuePosition = 0, fullJob = null) {
    if (status === 'done' || status === 'failed') {
        if (isAlreadyDelivered(jobId)) {
            console.log(`[Delivery] skipping already delivered job: ${jobId}`);
            return;
        }
    }

    if (status === 'queued') {
        const msg = `⏳ *Masuk Antrian\\!*\nVideo Anda berada di posisi ke\\-${queuePosition} dalam antrian\\. Mohon ditunggu ya\\.`;
        await sendMarkdownV2Text(chatId, msg);
    } else if (status === 'preparing') {
        const msg = `🚀 *Giliran Anda\\!*\nAntrian selesai, video Anda mulai dirakit sekarang\\.`;
        await sendMarkdownV2Text(chatId, msg);
    } else if (status === 'done' && result?.url) {
        try {
            // Priority: result.meta > fullJob.payload.composition.meta > fullJob.payload.meta
            const meta = result?.meta ||
                fullJob?.payload?.composition?.meta ||
                fullJob?.payload?.meta || {};

            const title = meta.title || '';
            const description = meta.description || '';
            const hashtags = Array.isArray(meta.hashtags) ?
                meta.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ') : '';

            let captionText = `✅ *Video Anda siap\\!*\nJob: \`${jobId}\`\n\n`;
            if (title) captionText += `🎬 *Judul:*\n\`${escapeMarkdown(title)}\`\n\n`;
            if (description) captionText += `📝 *Deskripsi:*\n\`${escapeMarkdown(description)}\`\n\n`;
            if (hashtags) captionText += `🏷️ *Hashtags:*\n\`${escapeMarkdown(hashtags)}\``;

            const res = await sendVideo(chatId, result.url, captionText);
            if (!res.ok) throw new Error(res.error || 'Upload failed');
            markAsDelivered(jobId);
        } catch (sendErr) {
            console.error(`[Delivery] Video upload failed, falling back to link:`, sendErr.message);
            // Fallback: send link + metadata information
            const meta = result?.meta ||
                fullJob?.payload?.composition?.meta ||
                fullJob?.payload?.meta || {};

            const title = meta.title || '';
            const hashtags = Array.isArray(meta.hashtags) ?
                meta.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ') : '';

            const safeLink = escapeMarkdown(result.url, '()[]');
            let fallbackMsg = `✅ *Video siap\\!*\n\n🎬 [Download Video](${safeLink})\n\n`;
            if (title) fallbackMsg += `📌 *${escapeMarkdown(title)}*\n`;
            if (hashtags) fallbackMsg += `🏷️ ${escapeMarkdown(hashtags)}`;

            const res = await sendMarkdownV2Text(chatId, fallbackMsg);
            if (res.ok) markAsDelivered(jobId);
        }
    } else if (status === 'failed') {
        const res = await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Render Gagal:* ${error || 'Unknown'}`, '*'));
        if (res.ok) markAsDelivered(jobId);
    }
}

function escapeMarkdown(text, except = '') {
    if (!text) return '';
    const reservedChars = [
        '_', '*', '[', ']', '(', ')', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}', '.', '!'
    ];
    let escapedText = String(text);
    reservedChars.forEach(char => {
        if (!except.includes(char)) {
            // Escape special regex characters in the reserve list
            const regexChar = ['[', ']', '(', ')', '{', '}', '.', '+', '*', '?', '|', '^', '$', '\\'].includes(char) ? '\\' + char : char;
            const regex = new RegExp(`(${regexChar})`, 'g');
            escapedText = escapedText.replace(regex, '\\$1');
        }
    });
    return escapedText;
}

/**
 * MUSIC SEARCH (Deezer API)
 */
async function findMusicDeezer(genre) {
    console.log(`[Music] Searching Deezer for: ${genre}`);
    try {
        const query = encodeURIComponent(genre);
        const res = await fetch(`https://api.deezer.com/search/track?q=${query}&limit=10`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (!data.data || data.data.length === 0) return null;

        // Pick random track from top results
        const track = data.data[Math.floor(Math.random() * data.data.length)];

        return {
            url: track.preview,
            title: track.title,
            artist: track.artist?.name || 'Unknown'
        };
    } catch (err) {
        console.error('[Music] Deezer Error:', err.message);
        return null;
    }
}

/**
 * AI BRAINSTORMING LOGIC
 */
async function brainstormWithAI(data) {
    console.log(`🧠 AI Brainstorming for topic: ${data.topic}`);
    const prompt = `
You are an internal deterministic AI Video Composition Engine for Indonesian content.

Your task is to generate ONE valid JSON blueprint.
Output MUST be raw JSON only.
No markdown, No commentary, No explanation.

====================================================
GLOBAL HARD RULES (CRITICAL)
====================================================
1. Total duration MUST be exactly ${data.duration} seconds.
2. No time overlap. No time gaps. Sequential timing only.
3. hook + body + cta MUST fully cover the entire timeline.
4. All visible text (title, description, script) MUST be in BAHASA INDONESIA.
5. All numbers in narration text MUST be written in words (e.g., "dua puluh", NOT "20").
6. visual_plan.keywords MUST be in English (for Pexels API).
7. Each visual scene must contain segment_type: "hook" | "body" | "cta".
8. AVAILABLE LUTs: "AmberLight", "Filmmaker". Choose one for each scene.
9. DESCRIPTION DISTINCTNESS: The "description" in meta MUST be an engaging summary for social media captions. It MUST be distinct and NOT a copy of the narration script.

====================================================
VISUAL VARIETY & PACING RULES (THE CORE)
====================================================
1. CRITICAL: visual_plan MUST NOT BE EMPTY.
2. MINIMUM SCENES: 
   - For 15-30s: Min 6 scenes.
   - For 31-60s: Min 10 scenes.
   - For 61s+: Min 15 scenes.
3. SCENE DURATION: Each scene should ideally last 3 - 6 seconds. NEVER make one scene longer than 10 seconds.
4. KEYWORD QUALITY: Provide 3-5 specific, cinematic, and high-quality English keywords per scene. Mix "subject", "action", and "environment" (e.g., "man running forest sunset cinematic").
5. ALIGNMENT: Visual scenes MUST follow script timing exactly. 
   - If HOOK is 0-3s, the first visual scene(s) MUST also cover exactly 0-3s with segment_type="hook".

====================================================
INPUT PARAMETERS
====================================================
Purpose: ${data.purpose}
Platform: ${data.platform}
Duration: ${data.duration}s
Emotion: ${data.emotion}
Visual Style: ${data.style}
Topic: ${data.topic}

====================================================
SCRIPT STRUCTURE
====================================================
HOOK (0-3s): Pattern interrupt.
BODY (3s to [Total-${data.duration < 30 ? 3 : 5}]s): Main content.
CTA (Final 3-5s): Call to action. End must be ${data.duration}.
Speaking rate: 2.5 words/sec.

====================================================
OUTPUT STRUCTURE (STRICT JSON)
====================================================
{
  "meta": {
    "title": "Indonesian title",
    "description": "Indonesian description",
    "hashtags": ["list", "of", "tags"],
    "platform": "${data.platform}",
    "duration": ${data.duration},
    "emotion": "${data.emotion}"
  },
  "script": {
    "total_words": 0,
    "segments": [
      { "type": "hook", "start": 0, "end": 3, "duration": 3, "text": "" },
      { "type": "body", "start": 3, "end": 0, "duration": 0, "text": "" },
      { "type": "cta", "start": 0, "end": ${data.duration}, "duration": 0, "text": "" }
    ]
  },
  "visual_plan": [
    {
      "scene": 1,
      "segment_type": "hook",
      "start": 0,
      "end": 0,
      "duration": 0,
      "keywords": ["cinematic", "high quality"],
      "motion": "slow_zoom",
      "lut": "AmberLight"
    }
  ],
  "music_plan": {
    "genre": "${data.music_genre}",
    "bpm": 0,
    "curve": [
      { "time": 0, "intensity": 0.3 },
      { "time": ${data.duration}, "intensity": 0.85 }
    ]
  },
  "subtitle_style": { "font": "Montserrat", "weight": "bold", "color": "#FFFFFF", "highlight": true }
}
`;

    try {
        const model = process.env.LLM_MODEL || "gpt-4o";
        console.log(`🤖 Using LLM Model: ${model}`);
        const completion = await openai.chat.completions.create({
            model: model,
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" }
        });

        console.log(`✅ AI Response received: ${completion.choices[0].message.content}`);
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        console.error('LLM API Error:', err.message);
        throw err;
    }
}

/**
 * BOT LOGIC & STATE MACHINE
 */
async function onUpdate(update) {
    if ('message' in update) {
        const message = update.message;
        // Check if this is a file upload (document, photo, video, audio)
        const state = userStates.get(message.chat.id);
        if (state && state.state === 'AWAITING_SAVE_FILE' && !message.text) {
            return handleSaveFile(message);
        }
        await onMessage(message);
    } else if ('callback_query' in update) {
        await onCallbackQuery(update.callback_query);
    }
}

async function onMessage(message) {
    const chatId = message.chat.id;
    const text = message.text || '';

    // Security: Whitelist check
    if (!isAuthorized(chatId)) {
        return sendMarkdownV2Text(chatId, '🚫 Maaf, Anda tidak memiliki akses ke bot ini\\.');
    }

    // Security: Rate limiting (20 messages/minute)
    if (!rateLimiter.check(`msg:${chatId}`, 20, 60000)) {
        return sendMarkdownV2Text(chatId, '⏳ Terlalu banyak pesan\\. Coba lagi dalam 1 menit\\.');
    }

    const state = userStates.get(chatId);

    if (text.startsWith('/start') || text.startsWith('/help')) {
        return sendMarkdownV2Text(chatId, '*🌟 AI Video Factory Portal*\n' +
            escapeMarkdown(
                '/factory - Mulai proses Factory Workflow\n' +
                '/yt [link] - Download video dari YouTube\n' +
                '/ytsave [link] - Download & simpan video YouTube ke Semantic Engine\n' +
                '/status [id] - Cek status render\n' +
                '/save - Simpan file ke Semantic Engine\n' +
                '/search [query] - Pencarian semantik\n' +
                '/myfiles - Lihat daftar file tersimpan\n' +
                '/folders - Lihat daftar folder\n' +
                '/cancel - Batalkan sesi aktif',
                '`'));
    }

    if (text === '/cancel') {
        userStates.delete(chatId);
        return sendMarkdownV2Text(chatId, '❌ Sesi dibatalkan\\. Ketik `/factory` untuk mulai lagi\\.');
    }

    if (text.startsWith('/factory') || text.startsWith('/videogenerator')) {
        userStates.set(chatId, { state: 'SELECT_PURPOSE', data: {} });
        return askPurpose(chatId);
    }

    if (text.startsWith('/status')) {
        const jobId = text.replace('/status', '').trim();
        if (!jobId) return sendMarkdownV2Text(chatId, 'Silakan masukkan ID job\\.');
        return checkJobStatus(chatId, jobId);
    }

    if (text.startsWith('/yt ')) {
        const url = text.replace('/yt', '').trim();
        if (!url) return sendMarkdownV2Text(chatId, 'Silakan masukkan link YouTube\\. Contoh: `/yt https://youtu.be/xxx`');
        return handleYoutubeDownload(chatId, url);
    }

    if (text.startsWith('/ytsave ')) {
        const url = text.replace('/ytsave', '').trim();
        if (!url) return sendMarkdownV2Text(chatId, 'Silakan masukkan link YouTube\\. Contoh: `/ytsave https://youtu.be/xxx`');
        return handleYoutubeDownload(chatId, url, true); // true = semantic save
    }

    // ── Semantic Engine Commands ────────────────────────────
    if (text === '/save') {
        userStates.set(chatId, { state: 'AWAITING_SAVE_FILE', data: {} });
        return sendMarkdownV2Text(chatId, '📁 *Simpan ke Semantic Engine*\n\nKirim file yang ingin disimpan \\(PDF, foto, video, audio, atau dokumen teks\\)\\.');
    }

    if (text.startsWith('/search')) {
        const query = text.replace('/search', '').trim();
        if (!query) return sendMarkdownV2Text(chatId, 'Masukkan kata kunci pencarian\\. Contoh: `/search machine learning`');
        return handleSemanticSearch(chatId, query);
    }

    if (text === '/myfiles') {
        return handleListFiles(chatId);
    }

    if (text === '/folders') {
        return handleListFolders(chatId);
    }

    if (state) {
        if (state.state === 'INPUT_TOPIC') {
            state.data.topic = text;
            userStates.set(chatId, state);
            return handleTopicInput(chatId, state.data);
        }
    }

    // ── Handle file uploads when awaiting save ─────────────
    if (state && state.state === 'AWAITING_SAVE_FILE') {
        // No text expected in this state
        return sendMarkdownV2Text(chatId, '📎 Kirim file, bukan teks\\. Atau ketik `/cancel` untuk membatalkan\\.');
    }

    if (!text.startsWith('/')) {
        return sendMarkdownV2Text(chatId, 'Gunakan perintah `/help` untuk melihat daftar perintah, atau `/factory` untuk mulai membuat video\\.');
    }
}

/**
 * NEW FACTORY FLOW HANDLERS
 */

async function askPurpose(chatId, editMessageId = null) {
    const message = escapeMarkdown('🎯 *1. Pilih Tujuan Utama Video (Purpose):*', '*');
    const keyboard = {
        inline_keyboard: [
            [{ text: '🛒 Affiliate / Jualan', callback_data: 'pur_affiliate' }],
            [{ text: '📚 Edukasi / Tutorial', callback_data: 'pur_education' }],
            [{ text: '✨ Branding / Profil', callback_data: 'pur_branding' }],
            [{ text: '🔥 Motivasi', callback_data: 'pur_motivation' }],
            [{ text: '📖 Storytelling', callback_data: 'pur_story' }]
        ]
    };
    if (editMessageId) return editMessageText(chatId, editMessageId, message, keyboard);
    return sendMarkdownV2Text(chatId, message, keyboard);
}

async function askPlatform(chatId, messageId) {
    const message = escapeMarkdown('📱 *2. Pilih Platform Target:*', '*');
    const keyboard = {
        inline_keyboard: [
            [{ text: '🎵 TikTok', callback_data: 'plat_tiktok' }],
            [{ text: '📸 Instagram Reels', callback_data: 'plat_reels' }],
            [{ text: '📱 YouTube Shorts', callback_data: 'plat_shorts' }],
            [{ text: '📺 YouTube Landscape', callback_data: 'plat_youtube' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askDuration(chatId, messageId, platform) {
    const message = escapeMarkdown(`⏳ *3. Pilih Durasi Ideal untuk ${platform}:*`, '*') + '\n' +
        escapeMarkdown('(_Berdasarkan safe duration platform_)', '_');
    const safeDurations = PLATFORMS[platform].safe_duration;

    // Group buttons into rows of 2
    const buttons = [];
    for (let i = 0; i < safeDurations.length; i += 2) {
        const row = [];
        row.push({ text: `${safeDurations[i]} Detik`, callback_data: `dur_${safeDurations[i]}` });
        if (i + 1 < safeDurations.length) {
            row.push({ text: `${safeDurations[i + 1]} Detik`, callback_data: `dur_${safeDurations[i + 1]}` });
        }
        buttons.push(row);
    }

    const keyboard = { inline_keyboard: buttons };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askEmotion(chatId, messageId) {
    const message = escapeMarkdown('🎭 *4. Pilih Emosi / Vibe Video:*', '*');
    const keyboard = {
        inline_keyboard: [
            [{ text: '😊 Happy / Positif', callback_data: 'emo_happy' }, { text: '😌 Calm / Santai', callback_data: 'emo_calm' }],
            [{ text: '🔥 Epic / Megah', callback_data: 'emo_epic' }, { text: '🚀 Inspirational', callback_data: 'emo_inspirational' }],
            [{ text: '⚠️ Urgent / Cepat', callback_data: 'emo_urgent' }, { text: '😢 Sad / Haru', callback_data: 'emo_sad' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askMusic(chatId, messageId) {
    const message = escapeMarkdown('🎵 *5. Pilih Genre Musik:*', '*');
    const keyboard = {
        inline_keyboard: [
            [{ text: '🎻 Cinematic', callback_data: 'mus_cinematic' }, { text: '☕ Lo-fi', callback_data: 'mus_lofi' }],
            [{ text: '🎧 Pop / Upbeat', callback_data: 'mus_pop' }, { text: '☁️ Ambient', callback_data: 'mus_ambient' }],
            [{ text: '💥 Dramatic', callback_data: 'mus_dramatic' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askStyle(chatId, messageId) {
    const message = escapeMarkdown('🎨 *6. Pilih Gaya Visual:*', '*');
    const keyboard = {
        inline_keyboard: [
            [{ text: '✨ Aesthetic Vlog', callback_data: 'sty_aesthetic' }],
            [{ text: '🚀 Modern Bold', callback_data: 'sty_modern' }],
            [{ text: '🎥 Cinematic Dark', callback_data: 'sty_cinematic' }],
            [{ text: '⬜ Minimalist', callback_data: 'sty_minimal' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askVoice(chatId, messageId) {
    const message = escapeMarkdown('🎤 *7. Pilih Karakter Suara Narator:*', '*');
    const keyboard = {
        inline_keyboard: [
            [{ text: '👨 Ardi (Lembut & Hangat)', callback_data: 'vox_ardi' }],
            [{ text: '👨 Wibowo (Jantan Berwibawa)', callback_data: 'vox_wibowo' }],
            [{ text: '👩 Gadis (Perempuan Merdu)', callback_data: 'vox_gadis' }],
            [{ text: '👩 Juminten (Jawa)', callback_data: 'vox_juminten' }],
            [{ text: '👨 Asep (Sunda)', callback_data: 'vox_asep' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askTopic(chatId, messageId) {
    const message = escapeMarkdown('📝 *8. Masukkan Topik atau Brief Anda*', '*') + '\n\n' +
        escapeMarkdown('Silakan ketik brief spesifik atau topik video ini. \nContoh: _"Cara sukses jualan di usia 20-an walau tanpa modal"_', '_');
    userStates.get(chatId).state = 'INPUT_TOPIC';
    return editMessageText(chatId, messageId, message);
}

async function onCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Security: Whitelist check
    if (!isAuthorized(chatId)) return;

    const state = userStates.get(chatId);

    if (!state) return;

    if (data.startsWith('pur_')) {
        state.data.purpose = data.replace('pur_', '');
        state.state = 'SELECT_PLATFORM';
        return askPlatform(chatId, messageId);
    }

    if (data.startsWith('plat_')) {
        state.data.platform = data.replace('plat_', '');
        state.state = 'SELECT_DURATION';
        return askDuration(chatId, messageId, state.data.platform);
    }

    if (data.startsWith('dur_')) {
        state.data.duration = parseInt(data.replace('dur_', ''));
        state.state = 'SELECT_EMOTION';
        return askEmotion(chatId, messageId);
    }

    if (data.startsWith('emo_')) {
        state.data.emotion = data.replace('emo_', '');
        state.state = 'SELECT_MUSIC';
        return askMusic(chatId, messageId);
    }

    if (data.startsWith('mus_')) {
        state.data.music_genre = data.replace('mus_', '');
        state.state = 'SELECT_STYLE';
        return askStyle(chatId, messageId);
    }

    if (data.startsWith('sty_')) {
        state.data.style = data.replace('sty_', '');
        state.state = 'SELECT_VOICE';
        return askVoice(chatId, messageId);
    }

    if (data.startsWith('vox_')) {
        state.data.voice_choice = data.replace('vox_', '');
        return askTopic(chatId, messageId);
    }

    // Regeneration options
    if (data === 'regen_all') {
        state.state = 'INPUT_TOPIC';
        return handleTopicInput(chatId, state.data, 'regenerate all');
    }

    if (data === 'confirm_go') {
        return executeVideoGeneration(chatId, messageId);
    }
}

async function handleTopicInput(chatId, data, instruction = null) {
    await sendMarkdownV2Text(chatId, '⚙️ *AI Factory sedang memproduksi Skrip & Blueprint\\.\\.\\.* Mohon tunggu\\.');

    try {
        const blueprint = await brainstormWithAI(data);

        // Auto-search music based on blueprint music plan
        const mGenre = blueprint.music_plan?.genre || data.music_genre || 'cinematic';
        blueprint.music_track = await findMusicDeezer(mGenre);

        console.log(`📝 Constructing preview message for ${chatId}`);
        userStates.set(chatId, {
            state: 'REVIEWING_BLUEPRINT',
            data: { ...data, ai_blueprint: blueprint }
        });

        // Safe extract parts
        // Using optional chaining safely here
        let hook_text = "N/A";
        let body_text = "N/A";
        let cta_text = "N/A";
        if (blueprint.script && blueprint.script.segments) {
            hook_text = blueprint.script.segments.find(s => s.type === 'hook')?.text || "N/A";
            body_text = blueprint.script.segments.find(s => s.type === 'body')?.text || "N/A";
            cta_text = blueprint.script.segments.find(s => s.type === 'cta')?.text || "N/A";
        }

        let visualCount = blueprint.visual_plan ? blueprint.visual_plan.length : 0;
        let musicInfo = blueprint.music_track
            ? `${blueprint.music_track.title} - ${blueprint.music_track.artist}`
            : (blueprint.music_plan?.genre || 'Auto');
        let totalWords = blueprint.script ? blueprint.script.total_words : 'Auto';

        const message = `✨ *FACTORY BLUEPRINT APPROVED\\!*\n\n` +
            `🏷️ *Judul:* ${escapeMarkdown(blueprint.meta?.title)}\n` +
            `⏱ *Durasi Target:* \`${blueprint.meta?.duration}s\` \\| 📝 *Kata:* \`${totalWords}\`\n\n` +
            `🎙 *Script VO \\(Master Timeline\\):*\n_Hook:_ ${escapeMarkdown(hook_text)}\n` +
            `_Body:_ ${escapeMarkdown(body_text)}\n` +
            `_CTA:_ ${escapeMarkdown(cta_text)}\n\n` +
            `🎬 *Visual Plan:* \`${visualCount} Scene dipetakan\`\n` +
            `🎵 *Musik:* \`${escapeMarkdown(musicInfo)}\` \n\n` +
            `Siap dirakit oleh Render Engine?`;

        // Format is critical for telegram: MarkdownV2 requires escaping properly.
        const keyboard = {
            inline_keyboard: [
                [{ text: '🚀 PRODUKSI SEKARANG', callback_data: 'confirm_go' }],
                [{ text: '🔄 Regenerate Total', callback_data: 'regen_all' }]
            ]
        };

        return await sendMarkdownV2Text(chatId, message, keyboard);
    } catch (err) {
        console.error('AI Error:', err);
        return await sendMarkdownV2Text(chatId, '❌ Maaf, Mesin AI sedang Overload. Coba lagi.');
    }
}

async function executeVideoGeneration(chatId, messageId) {
    const state = userStates.get(chatId);
    const { ai_blueprint, voice_choice, platform } = state.data;

    // Rate limit: max 3 job submissions per hour
    if (!rateLimiter.check(`job:${chatId}`, 3, 3600000)) {
        return sendMarkdownV2Text(chatId, '⏳ Anda sudah submit 3 video dalam 1 jam\\. Coba lagi nanti\\.');
    }

    await editMessageText(chatId, messageId, '⚙️ *Merakit Composition Final\\.\\.\\.* Transmitting ke Video Engine\\.');

    // Voice mapping for HF
    const voiceMapping = {
        'ardi': 'Ardi - Suara lembut dan hangat',
        'wibowo': 'Wibowo - Suara jantan berwibawa',
        'gadis': 'Gadis - Suara perempuan yang merdu',
        'juminten': 'Juminten - Suara perempuan jawa (bahasa jawa)',
        'asep': 'Asep - Suara lelaki sunda (bahasa sunda)'
    };
    const mappedVoice = voiceMapping[voice_choice] || voiceMapping['juminten'];

    // Combine segments to single text
    let fullText = "";
    if (ai_blueprint.script && ai_blueprint.script.segments) {
        fullText = ai_blueprint.script.segments.map(s => s.text).join(' ');
    }

    let mappedVisualPlan = [];
    if (ai_blueprint.visual_plan && Array.isArray(ai_blueprint.visual_plan) && ai_blueprint.visual_plan.length > 0) {
        mappedVisualPlan = ai_blueprint.visual_plan.map(scene => ({
            query: (scene.keywords && Array.isArray(scene.keywords) && scene.keywords.length > 0)
                ? scene.keywords.join(' ')
                : (ai_blueprint.meta?.title || "scenic background"),
            duration: scene.duration || 5, // fallback 5s
            transition: { type: 'fade', duration: 0.5 }
        }));
    } else {
        // Fallback: at least one clip if AI fails
        console.warn(`[Warning] No visual_plan found in blueprint for ${chatId}, using fallback.`);
        mappedVisualPlan = [{
            query: ai_blueprint.meta?.title || "inspiring background",
            duration: data.duration || 30,
            transition: { type: 'fade', duration: 0.5 }
        }];
    }

    const payload = {
        mode: 'composition',
        webhook_url: `http://localhost:3001/callback`,
        composition: {
            template_id: 'shorts_modern_v1', // standard template override
            output_format: platform,
            meta: {
                chat_id: chatId,
                title: ai_blueprint.meta?.title,
                description: ai_blueprint.meta?.description,
                hashtags: ai_blueprint.meta?.hashtags
            },
            // Parse AI Visual Plan precisely to clips
            clips: mappedVisualPlan,
            // Blueprint 5 specifications mapped to our engine compatible json schema
            audio: {
                voice: {
                    duck_music: true
                },
                music: {
                    fade_in: 1,
                    fade_out: 2
                }
            },
            visual: {
                aspect_ratio: ai_blueprint.meta?.resolution || "1080x1920", // Ensure ratio matches
                scene_based: true
            },
            text: {
                subtitle_engine: "ass",
                sync: "voice"
            },
            // Legacy mapping properties so engine backwards compatibility isn't lost
            voice_over: {
                text: fullText,
                provider: 'huggingface',
                voice: mappedVoice,
                word_highlight: true,
                language_code: 'id'
            },
            music: {
                url: ai_blueprint.music_track?.url,
                query: ai_blueprint.music_plan?.genre || ai_blueprint.meta?.music_genre || 'cinematic'
            },
            template_overrides: {
                audio_ducking: true, // Keep backwards compatible
                music_volume: 0.15,
                color_grade: ai_blueprint.meta?.emotion === 'happy' ? 'warm' : 'cinematic_dark'
            }
        }
    };

    try {
        console.log(`📡 Transmitting Job to Engine: ${ENGINE_BASE_URL}/jobs`);
        console.log(`📦 Payload Preview: ${JSON.stringify(payload).substring(0, 500)}...`);

        const res = await fetch(`${ENGINE_BASE_URL}/jobs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await res.json();

        userStates.delete(chatId);

        if (res.ok) {
            await sendMarkdownV2Text(chatId, escapeMarkdown(`✅ *PRODUKSI DIMULAI!*\nJob ID: \`${result.job_id}\`\n\nMenunggu render selesai.`, '*`'));
            // Start background progress polling (fire-and-forget)
            pollJobProgress(chatId, result.job_id);
        } else {
            throw new Error(result.error || 'Engine Error');
        }
    } catch (err) {
        return sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal Terhubung ke Engine:* ${err.message}`, '*'));
    }
}

async function checkJobStatus(chatId, jobId) {
    try {
        console.log(`[Status] Checking status for Job ID: ${jobId}`);
        const res = await fetch(`${ENGINE_BASE_URL}/jobs/${jobId}`);
        const result = await res.json();

        console.log(`[Status] Engine response for ${jobId}:`, JSON.stringify(result).substring(0, 200));

        if (res.ok) {
            let message = `📊 *Status Job:* \`${result.status || 'unknown'}\`\n`;

            if (result.progress) {
                const progressText = typeof result.progress === 'object'
                    ? (result.progress.message || result.progress.stage || 'Processing')
                    : `${result.progress}%`;
                message += `⏳ Progress: \`${progressText}\`\n`;
            }

            if (result.status === 'done' && result.result && result.result.url) {
                message += `🎬 [Tonton Video](${escapeMarkdown(result.result.url, '()[]')})`;
            } else if (result.status === 'failed') {
                message += `❌ *Error:* ${escapeMarkdown(result.error || 'Unknown error')}`;
            } else {
                message += `\n_Silakan cek kembali beberapa saat lagi\\._`;
            }

            await sendMarkdownV2Text(chatId, message);
        } else {
            console.error(`[Status] Engine error ${res.status}:`, result);
            throw new Error(result.error || `Engine returned ${res.status}`);
        }
    } catch (err) {
        console.error(`[Status] Bot-side error:`, err);
        await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Error:* ${err.message}`, '*'));
    }
}

async function handleYoutubeDownload(chatId, url, isSemanticSave = false) {
    try {
        console.log(`[YouTube] Requesting download for: ${url}`);
        const actionMsg = isSemanticSave ? 'menyimpan ke Semantic Engine' : 'dialirkan ke R2';
        await sendMarkdownV2Text(chatId, `🚀 *Sedang memproses link YouTube\\.\\.\\.* Mohon tunggu, video sedang ${actionMsg}\\.`);

        // Determine destination folder (if user is in a state with a folder_id, use it)
        const state = userStates.get(chatId);
        const folder_id = state?.data?.folder_id;

        const requestBody = { url, chat_id: chatId };
        // We pass the semantic_save flag and optional folder_id through the webhook by abusing youtube-engine's transparency.
        // Wait, youtube-engine currently hardcodes payload: { meta: { chat_id } }.
        // Let's modify bot-engine's call and youtube-engine's handling.
        // Since we didn't modify youtube-engine to pass arbitrary meta, we must use what we have.
        // Actually, youtube-engine uses `request.body.chat_id` and then explicitly builds the payload:
        // `payload: { meta: { chat_id } }`.
        // Let's modify youtube-engine to pass along all meta, or at least semantic_save.
        // For now, let's just use `semantic_save: true` in the DB or state? No, webhook needs it statelessly.
        // Let's send it in chat_id as a string trick? E.g., `${chatId}|semantic` - NO, that breaks R2 paths.
        // I'll go back and modify youtube-engine to accept `meta` object and pass it through.

        requestBody.meta = {
            semantic_save: isSemanticSave,
            folder_id: folder_id
        };

        const res = await fetch(`${YOUTUBE_ENGINE_URL}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        const result = await res.json();

        if (res.ok) {
            if (result.status === 'started') {
                // Background process started, wait for callback
                return;
            }
            const caption = `🎬 *${escapeMarkdown(result.title)}*\n\n✅ Berhasil didownload dari YouTube\\!`;
            const videoResult = await sendVideo(chatId, result.url, caption);

            if (!videoResult.ok) {
                // Fallback to link if internal telegram upload fails
                let message = `✅ *Download Selesai\\!*\n\n` +
                    `🎬 *Judul:* ${escapeMarkdown(result.title)}\n` +
                    `📺 [Tonton/Download Video](${escapeMarkdown(result.url, '()[]')})`;
                await sendMarkdownV2Text(chatId, message);
            }
        } else {
            throw new Error(result.error || 'Terjadi kesalahan pada engine YouTube');
        }
    } catch (err) {
        console.error(`[YouTube] Error:`, err.message);
        await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal Download YouTube:* ${err.message}`, '*'));
    }
}

/**
 * SEMANTIC ENGINE HANDLERS
 */

/**
 * Download a file from Telegram servers and return { buffer, filename, mimeType }
 */
async function downloadTelegramFile(fileId) {
    // Step 1: Get file path from Telegram
    const fileInfoRes = await fetch(apiUrl('getFile', { file_id: fileId }));
    const fileInfo = await fileInfoRes.json();
    if (!fileInfo.ok || !fileInfo.result.file_path) {
        throw new Error('Failed to get file path from Telegram');
    }

    const filePath = fileInfo.result.file_path;
    const downloadUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;

    // Step 2: Download the file
    const res = await fetch(downloadUrl);
    if (!res.ok) throw new Error(`Failed to download file: ${res.statusText}`);

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const filename = filePath.split('/').pop() || 'file';

    return { buffer, filename, filePath };
}

/**
 * Handle file save to semantic engine.
 * Triggered when user sends a file while in AWAITING_SAVE_FILE state.
 */
async function handleSaveFile(message) {
    const chatId = message.chat.id;

    try {
        let fileId, fileName, mimeType;

        if (message.document) {
            fileId = message.document.file_id;
            fileName = message.document.file_name || 'document';
            mimeType = message.document.mime_type || 'application/octet-stream';
        } else if (message.photo) {
            // Get highest resolution photo
            const photo = message.photo[message.photo.length - 1];
            fileId = photo.file_id;
            fileName = `photo_${Date.now()}.jpg`;
            mimeType = 'image/jpeg';
        } else if (message.video) {
            fileId = message.video.file_id;
            fileName = message.video.file_name || `video_${Date.now()}.mp4`;
            mimeType = message.video.mime_type || 'video/mp4';
        } else if (message.audio) {
            fileId = message.audio.file_id;
            fileName = message.audio.file_name || `audio_${Date.now()}.mp3`;
            mimeType = message.audio.mime_type || 'audio/mpeg';
        } else if (message.voice) {
            fileId = message.voice.file_id;
            fileName = `voice_${Date.now()}.ogg`;
            mimeType = message.voice.mime_type || 'audio/ogg';
        } else {
            return sendMarkdownV2Text(chatId, '❌ Tipe file tidak didukung\\. Kirim dokumen, foto, video, atau audio\\.');
        }

        await sendMarkdownV2Text(chatId, `📤 *Mengupload* \`${escapeMarkdown(fileName)}\` *ke Semantic Engine\\.\\.\\.*`);

        // Download from Telegram
        const { buffer } = await downloadTelegramFile(fileId);

        // Upload to semantic engine
        const formData = new FormData();
        formData.append('user_id', String(chatId));
        formData.append('file', new Blob([buffer], { type: mimeType }), fileName);

        // Check if user specified a folder_id
        const state = userStates.get(chatId);
        if (state?.data?.folder_id) {
            formData.append('folder_id', state.data.folder_id);
        }

        const res = await fetch(`${SEMANTIC_ENGINE_URL}/upload`, {
            method: 'POST',
            body: formData,
        });

        const result = await res.json();

        userStates.delete(chatId);

        if (res.ok) {
            const msg = `✅ *File Tersimpan\\!*\n\n` +
                `📄 *Nama:* \`${escapeMarkdown(fileName)}\`\n` +
                `📁 *Folder:* \`${escapeMarkdown(result.folder_id || 'auto')}\`\n` +
                `🔖 *ID:* \`${escapeMarkdown(result.id)}\`\n\n` +
                `⏳ Sedang dianalisis\\.\\.\\. Ringkasan akan dikirim setelah selesai\\.`;
            await sendMarkdownV2Text(chatId, msg);

            // Fire-and-forget: poll until indexed, then send summary
            pollFileAndSummarize(chatId, result.id, fileName);
        } else {
            throw new Error(result.error || 'Upload failed');
        }
    } catch (err) {
        console.error('[Semantic] Save error:', err.message);
        userStates.delete(chatId);
        await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal menyimpan file:* ${err.message}`, '*'));
    }
}

/**
 * Poll file status until indexed, then send content summary to user.
 * Runs in background (fire-and-forget).
 */
async function pollFileAndSummarize(chatId, fileId, fileName) {
    const MAX_POLLS = 60; // 5 minutes max (60 × 5s)
    const POLL_INTERVAL = 5000;

    for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_INTERVAL));

        try {
            const res = await fetch(`${SEMANTIC_ENGINE_URL}/files/${fileId}`);
            if (!res.ok) continue;

            const data = await res.json();
            const status = data.file?.status;

            if (status === 'indexed') {
                const chunks = data.chunks || [];

                if (chunks.length === 0) {
                    await sendMarkdownV2Text(chatId,
                        `📋 *Selesai diproses\\!*\n\n` +
                        `📄 \`${escapeMarkdown(fileName)}\`\n` +
                        `Tidak ada konten teks yang bisa diekstrak\\.`);
                    return;
                }

                // Combine chunk texts for summary (max ~500 chars)
                const allText = chunks.map(c => c.text).join(' ');
                const preview = allText.length > 500
                    ? allText.substring(0, 500) + '...'
                    : allText;

                const safePreview = escapeMarkdown(preview);
                const safeName = escapeMarkdown(fileName);

                const summaryMsg =
                    `📋 *File Selesai Dianalisis\\!*\n\n` +
                    `📄 *File:* \`${safeName}\`\n` +
                    `📊 *Jumlah Chunk:* \`${chunks.length}\`\n\n` +
                    `📝 *Ringkasan Isi:*\n\`${safePreview}\`\n\n` +
                    `✅ Gunakan \`/search\` untuk mencari konten di dalam file ini\\.`;

                await sendMarkdownV2Text(chatId, summaryMsg);
                return;
            }

            if (status === 'failed') {
                await sendMarkdownV2Text(chatId,
                    `❌ *Gagal memproses file* \`${escapeMarkdown(fileName)}\`\\.\n` +
                    `Silakan coba upload ulang dengan \`/save\`\\.`);
                return;
            }

            // Still processing — continue polling
        } catch (err) {
            console.error('[Semantic] Poll error:', err.message);
        }
    }

    // Timeout
    await sendMarkdownV2Text(chatId,
        `⚠️ *Timeout* memproses \`${escapeMarkdown(fileName)}\`\\.\n` +
        `Gunakan \`/myfiles\` untuk cek status nanti\\.`);
}

/**
 * Handle /search [query]
 */
async function handleSemanticSearch(chatId, query) {
    try {
        await sendMarkdownV2Text(chatId, `🔍 *Mencari:* \`${escapeMarkdown(query)}\`\n\n⏳ Mohon tunggu\\.\\.\\.`);

        const res = await fetch(`${SEMANTIC_ENGINE_URL}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, user_id: chatId, limit: 5 }),
        });

        const data = await res.json();

        if (!res.ok) throw new Error(data.detail || data.error || 'Search failed');

        const results = data.results || [];

        if (results.length === 0) {
            return sendMarkdownV2Text(chatId, '📭 *Tidak ada hasil ditemukan\\.*\n\nCoba kata kunci lain atau upload file terlebih dahulu dengan `/save`\\.');
        }

        // Build context from raw chunks for the LLM
        const r2PublicUrl = process.env.R2_PUBLIC_URL || 'https://data.sarungtambalan.my.id';
        const chunksContext = results.map((r, i) => {
            const time = r.start_time !== null ? ` [waktu: ${r.start_time}s - ${r.end_time}s]` : '';
            const page = r.page !== null ? ` [halaman: ${r.page}]` : '';
            const fileUrl = `${r2PublicUrl}/${r.storage_key}`;
            return `[Sumber ${i + 1}: "${r.file_name}" (URL: ${fileUrl}) (relevansi: ${(r.score * 100).toFixed(0)}%)${time}${page}]\n${r.text}`;
        }).join('\n\n');

        // Send to LLM for natural Indonesian summarization
        try {
            const model = process.env.LLM_MODEL || 'seed-2-0-mini-free';
            const completion = await openai.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: `Kamu adalah asisten pencarian cerdas berbahasa Indonesia. 
Tugasmu: menjawab pertanyaan pengguna berdasarkan potongan data yang ditemukan dari file mereka.

ATURAN:
1. Jawab SELALU dalam Bahasa Indonesia yang natural dan mudah dipahami.
2. WAJIB jadikan setiap nama file yang kamu sebutkan sebagai TAUTAN (Hyperlink Markdown) ke URL sumbernya.
   Contoh format: [nama_file.pdf](https://data.sarungtambalan.my.id/...)
3. Sebutkan timestamp/halaman jika tersedia di data.
4. Jika data berisi deskripsi visual (dari video/foto), ceritakan kembali secara naratif.
5. Jangan mengarang informasi — hanya gunakan data yang diberikan.
6. Format jawaban dengan ringkas dan jelas.`
                    },
                    {
                        role: 'user',
                        content: `Pertanyaan: "${query}"\n\nData yang ditemukan:\n\n${chunksContext}`
                    }
                ],
                max_tokens: 1024,
            });

            const answer = completion.choices[0]?.message?.content || '';

            if (answer) {
                // LLM output might have normal markdown links, we need to respect them but escape other chars around them
                // However, Telegram MarkdownV2 requires careful escaping of links. Let's send it as plain Markdown (V1) or HTML, 
                // but since we rely on MarkdownV2, we need to make sure the LLM's links don't break. 
                // The safest way is to use parse_mode: 'Markdown' (V1) for this specific message 
                // because escaping MarkdownV2 dynamic LLM output with links is notoriously error-prone.

                // Let's fallback to standard unescaped Markdown (V1) for the LLM answer
                const uniqueFilesCount = [...new Set(results.map(r => r.file_name))].length;
                const msg = `📊 *Hasil Pencarian*\n\n${answer}\n\n_${results.length} sumber ditemukan dari ${uniqueFilesCount} file_`;

                const resV1 = await fetch(apiUrl('sendMessage'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: chatId,
                        text: msg,
                        parse_mode: 'Markdown',
                        disable_web_page_preview: true
                    })
                });

                if (!resV1.ok) {
                    console.error("Markdown V1 failed, trying HTML...", await resV1.text());
                    await fetch(apiUrl('sendMessage'), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            chat_id: chatId,
                            text: msg,
                            disable_web_page_preview: true
                        })
                    });
                }
                return;
            }
        } catch (llmErr) {
            console.error('[Semantic] LLM summarization failed, falling back to raw:', llmErr.message);
        }

        // Fallback: show raw results if LLM fails
        let msg = `📊 *Hasil Pencarian* \\(${results.length} ditemukan\\):\n\n`;

        results.forEach((r, i) => {
            const score = (r.score * 100).toFixed(1);
            const snippet = r.text.length > 100 ? r.text.substring(0, 100) + '...' : r.text;
            msg += `*${i + 1}\\. ${escapeMarkdown(r.file_name)}* \\(${escapeMarkdown(score)}%\\)\n`;
            msg += `\`${escapeMarkdown(snippet)}\`\n\n`;
        });

        return sendMarkdownV2Text(chatId, msg);
    } catch (err) {
        console.error('[Semantic] Search error:', err.message);
        return sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal mencari:* ${err.message}`, '*'));
    }
}

/**
 * Handle /myfiles
 */
async function handleListFiles(chatId) {
    try {
        const res = await fetch(`${SEMANTIC_ENGINE_URL}/files?user_id=${chatId}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to list files');

        const files = data.files || [];

        if (files.length === 0) {
            return sendMarkdownV2Text(chatId, '📭 *Belum ada file tersimpan\\.*\n\nGunakan `/save` untuk menyimpan file pertama Anda\\.');
        }

        let msg = `📁 *File Anda* \\(${files.length}\\):\n\n`;

        files.slice(0, 20).forEach((f, i) => {
            const statusIcon = f.status === 'indexed' ? '✅' : f.status === 'processing' ? '⏳' : f.status === 'failed' ? '❌' : '🔄';
            msg += `${i + 1}\\. ${statusIcon} \`${escapeMarkdown(f.name)}\`\n`;
        });

        if (files.length > 20) {
            msg += `\n_\\.\\.\\. dan ${files.length - 20} file lainnya_`;
        }

        return sendMarkdownV2Text(chatId, msg);
    } catch (err) {
        console.error('[Semantic] List files error:', err.message);
        return sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal memuat file:* ${err.message}`, '*'));
    }
}

/**
 * Handle /folders
 */
async function handleListFolders(chatId) {
    try {
        const res = await fetch(`${SEMANTIC_ENGINE_URL}/folders?user_id=${chatId}`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Failed to list folders');

        const folders = data.folders || [];

        if (folders.length === 0) {
            return sendMarkdownV2Text(chatId, '📭 *Belum ada folder\\.*\n\nFolder otomatis dibuat saat Anda upload file dengan `/save`\\.');
        }

        let msg = `📂 *Folder Anda* \\(${folders.length}\\):\n\n`;

        folders.forEach((f, i) => {
            const typeIcon = f.type === 'job' ? '💼' : '📁';
            const fileCount = f.files?.[0]?.count ?? 0;
            msg += `${i + 1}\\. ${typeIcon} *${escapeMarkdown(f.name)}* \\(${fileCount} file\\)\n`;
            msg += `   Tipe: \`${escapeMarkdown(f.type)}\`${f.category ? ` \\| Kategori: \`${escapeMarkdown(f.category)}\`` : ''}\n\n`;
        });

        return sendMarkdownV2Text(chatId, msg);
    } catch (err) {
        console.error('[Semantic] List folders error:', err.message);
        return sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal memuat folder:* ${err.message}`, '*'));
    }
}

/**
 * Background progress polling — sends stage updates to user
 */
async function pollJobProgress(chatId, jobId) {
    const stageEmojis = {
        'preparing': '📦 Mempersiapkan workspace\\.\\.\\.',
        'stock_search': '🔍 Mencari stock footage\\.\\.\\.',
        'downloading': '⬇️ Mengunduh aset\\.\\.\\.',
        'tts': '🎤 Membuat voice\\-over\\.\\.\\.',
        'music': '🎵 Memproses musik\\.\\.\\.',
        'building_filters': '⚙️ Menyusun filter video\\.\\.\\.',
        'rendering': '🎬 Merender video \\(bisa 1\\-5 menit\\)\\.\\.\\.',
        'post_processing': '✨ Post\\-processing\\.\\.\\.',
    };
    let lastStage = '';
    for (let i = 0; i < 240; i++) { // max 20 minutes
        await new Promise(r => setTimeout(r, 5000));
        try {
            const res = await fetch(`${ENGINE_BASE_URL}/jobs/${jobId}`);
            if (!res.ok) continue;
            const job = await res.json();
            const stage = job.progress?.stage || job.status;
            if (stage && stage !== lastStage && !['done', 'failed', 'cancelled'].includes(stage)) {
                lastStage = stage;
                const msg = stageEmojis[stage] || `⏳ ${escapeMarkdown(stage)}`;
                await sendMarkdownV2Text(chatId, msg);
            }
            if (['done', 'failed', 'cancelled'].includes(job.status)) {
                await deliverJobResult(chatId, jobId, job.result, job.status, job.error, 0, job);
                break;
            }
        } catch (e) { /* ignore polling errors */ }
    }
}

fastify.get('/health', async () => ({ status: 'ok' }));
fastify.get('/', async () => ({ status: 'ok', service: 'bot-engine-factory' }));

fastify.post(WEBHOOK_PATH, async (request, reply) => {
    // Security: Validate Telegram webhook secret
    const headerSecret = request.headers['x-telegram-bot-api-secret-token'];
    if (SECRET && headerSecret !== SECRET) {
        console.warn(`⚠️ Unauthorized webhook attempt from ${request.ip}`);
        return reply.code(403).send({ error: 'Forbidden' });
    }

    try {
        await onUpdate(request.body);
    } catch (err) {
        console.error('Bot Runtime Error:', err);
    }
    return { ok: true };
});

fastify.post('/callback', async (request, reply) => {
    const data = request.body;
    console.log(`📩 Webhook received: Job=${data.id}, Status=${data.status}, Pos=${data.queue_position}`);

    const { type, id: jobId, status, payload, result, error, title, url, storage_key } = data;
    const chatId = payload?.meta?.chat_id || payload?.composition?.meta?.chat_id;

    if (!chatId) return reply.code(400).send({ error: 'No chatId' });

    if (type === 'youtube_download') {
        const isSemanticSave = payload?.meta?.semantic_save === true;

        if (status === 'done' && url) {
            if (isSemanticSave && storage_key) {
                // Call semantic engine to register the remote file
                try {
                    await sendMarkdownV2Text(chatId, `✅ *Download YouTube Selesai\\!*\n\n` +
                        `🎬 *Judul:* ${escapeMarkdown(title)}\n\n` +
                        `🔄 Mulai mentransfer ke Semantic Engine\\.\\.\\.`);

                    const remoteRes = await fetch(`${SEMANTIC_ENGINE_URL}/upload/remote`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            name: title + '.mp4',
                            storage_key: storage_key,
                            user_id: chatId,
                            type: 'video/mp4',
                            folder_id: payload?.meta?.folder_id
                        })
                    });

                    const remoteData = await remoteRes.json();

                    if (remoteRes.ok) {
                        await sendMarkdownV2Text(chatId, `✅ *Video YouTube Tersimpan di Semantic Engine\\!*\n\n` +
                            `📄 *Nama:* \`${escapeMarkdown(title)}\`\n` +
                            `🔖 *ID:* \`${escapeMarkdown(remoteData.id)}\`\n\n` +
                            `⏳ Sedang dianalisis\\.\\.\\. Ringkasan akan dikirim setelah selesai\\.`);

                        pollFileAndSummarize(chatId, remoteData.id, title);
                    } else {
                        throw new Error(remoteData.error || 'Failed to register remote file');
                    }
                } catch (err) {
                    console.error('[Semantic] Remote save error:', err.message);
                    await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal menyimpan video YouTube ke Semantic Engine:* ${err.message}`, '*'));
                }
            } else {
                // Normal download - send video directly to user
                const caption = `🎬 *${escapeMarkdown(title)}*\n\n✅ Berhasil didownload dari YouTube\\!`;
                const videoResult = await sendVideo(chatId, url, caption);
                if (!videoResult.ok) {
                    let message = `✅ *Download Selesai\\!*\n\n` +
                        `🎬 *Judul:* ${escapeMarkdown(title)}\n` +
                        `📺 [Tonton/Download Video](${escapeMarkdown(url, '()[]')})`;
                    await sendMarkdownV2Text(chatId, message);
                }
            }
        } else if (status === 'failed') {
            await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal Download YouTube:* ${error || 'Unknown'}`, '*'));
        }
    } else {
        // Standard video composition callback
        await deliverJobResult(chatId, jobId, result, status, error, data.queue_position, data);
    }
    return { ok: true };
});

fastify.get('/status/:id', async (request) => {
    const res = await fetch(`${ENGINE_BASE_URL}/jobs/${request.params.id}`);
    return await res.json();
});

fastify.get('/register', async (request) => {
    const host = request.hostname;
    const webhookUrl = `https://${host}${WEBHOOK_PATH}`;
    const res = await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: SECRET }));
    return await res.json();
});

const start = async () => {
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' });
        console.log(`Bot Server running at http://localhost:3001`);
    } catch (err) {
        process.exit(1);
    }
};
start();
