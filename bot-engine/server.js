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
    if (deliveredJobs.has(jobId)) return true;
    deliveredJobs.add(jobId);
    // Auto-clean after 1 hour to prevent memory leak
    setTimeout(() => deliveredJobs.delete(jobId), 3600000);
    return false;
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

async function deliverJobResult(chatId, jobId, result, status, error) {
    if (isAlreadyDelivered(jobId)) {
        console.log(`[Delivery] skipping already delivered job: ${jobId}`);
        return;
    }

    if (status === 'done' && result?.url) {
        try {
            const caption = escapeMarkdown('✅ Video Anda siap! Job: ' + jobId);
            const res = await sendVideo(chatId, result.url, caption);
            if (!res.ok) throw new Error(res.error || 'Upload failed');
        } catch (sendErr) {
            // Fallback: send link instead
            const safeLink = escapeMarkdown(result.url, '()[]');
            await sendMarkdownV2Text(chatId, '✅ *Video siap\\!*\\n\\n🎬 [Download Video](' + safeLink + ')');
        }
    } else if (status === 'failed') {
        await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Render Gagal:* ${error || 'Unknown'}`, '*'));
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
    const prompt = `You are a strict internal AI Video Factory Engine.
DO NOT OUTPUT ANYTHING EXCEPT THE JSON MATCHING THE EXACT STRUCTURE BELOW.
Ensure each asset (visual, music) has clear timing and roles synced with the Voice Over script.
Strict adherence to duration (${data.duration} seconds) is required.

Input Variables:
- Purpose: ${data.purpose}
- Platform: ${data.platform} (Ratio: ${PLATFORMS[data.platform].ratio}, Resolution: ${PLATFORMS[data.platform].resolution})
- Duration: ${data.duration} seconds
- Emotion: ${data.emotion}
- Music Genre: ${data.music_genre}
- Visual Style: ${data.style}
- Topic: ${data.topic}

Calculate max words based on duration (assume avg speaking rate of 2.5 words/sec).
Output Structure:
{
  "meta": {
    "title": "Short catchy title",
    "description": "Engaging social media description with hashtags",
    "platform": "${data.platform}",
    "duration": ${data.duration},
    "resolution": "${PLATFORMS[data.platform].resolution}",
    "emotion": "${data.emotion}",
    "music_genre": "${data.music_genre}"
  },
  "script": {
    "total_words": <calculate_this>,
    "segments": [
      { "type": "hook", "start": 0, "end": 3, "text": "Hook text..." },
      { "type": "body", "start": 3, "end": <calc_end>, "text": "Body text..." },
      { "type": "cta", "start": <calc_start>, "end": ${data.duration}, "text": "CTA text..." }
    ]
  },
  "visual_plan": [
    { "scene": 1, "start": 0, "end": <scene_end>, "duration": <calc_duration>, "keywords": ["kw1", "kw2"], "motion": "<slow_zoom|pan_left|pan_right|zoom_out>", "lut": "warm" },
    ...
  ],
  "music_plan": {
    "bpm": <calc_bpm>,
    "curve": [
      { "time": 0, "intensity": 0.3 },
      { "time": <mid>, "intensity": 0.6 },
      { "time": ${data.duration}, "intensity": 0.8 }
    ]
  },
  "subtitle_style": {
    "font": "Montserrat",
    "weight": "bold",
    "color": "#FFFFFF",
    "highlight": true
  }
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
        await onMessage(update.message);
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
                '/status [id] - Cek status render\n' +
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

    if (text.startsWith('/yt')) {
        const url = text.replace('/yt', '').trim();
        if (!url) return sendMarkdownV2Text(chatId, 'Silakan masukkan link YouTube\\. Contoh: `/yt https://youtu.be/xxx`');
        return handleYoutubeDownload(chatId, url);
    }

    if (state) {
        if (state.state === 'INPUT_TOPIC') {
            state.data.topic = text;
            userStates.set(chatId, state);
            return handleTopicInput(chatId, state.data);
        }
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
    if (ai_blueprint.visual_plan) {
        mappedVisualPlan = ai_blueprint.visual_plan.map(scene => ({
            query: scene.keywords.join(' '),
            duration: scene.duration, // specific duration
            transition: { type: 'fade', duration: 0.5 } // Standard
        }));
    }

    const payload = {
        mode: 'composition',
        webhook_url: `http://localhost:3001/callback`,
        composition: {
            template_id: 'shorts_modern_v1', // standard template override
            output_format: platform,
            meta: { chat_id: chatId, title: ai_blueprint.meta?.title },
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

async function handleYoutubeDownload(chatId, url) {
    try {
        console.log(`[YouTube] Requesting download for: ${url}`);
        await sendMarkdownV2Text(chatId, '🚀 *Sedang memproses link YouTube\\.\\.\\.* Mohon tunggu, video sedang dialirkan ke R2\\.');

        const res = await fetch(`${YOUTUBE_ENGINE_URL}/download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, chat_id: chatId })
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
                await deliverJobResult(chatId, jobId, job.result, job.status, job.error);
                break;
            }
        } catch (e) { /* ignore polling errors */ }
    }
}

fastify.get('/', async () => ({ status: 'online', service: 'bot-engine-factory' }));

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
    const { type, id: jobId, status, payload, result, error, title, url } = data;
    const chatId = payload?.meta?.chat_id || payload?.composition?.meta?.chat_id;

    if (!chatId) return reply.code(400).send({ error: 'No chatId' });

    if (type === 'youtube_download') {
        if (status === 'done' && url) {
            const caption = `🎬 *${escapeMarkdown(title)}*\n\n✅ Berhasil didownload dari YouTube\\!`;
            const videoResult = await sendVideo(chatId, url, caption);
            if (!videoResult.ok) {
                let message = `✅ *Download Selesai\\!*\n\n` +
                    `🎬 *Judul:* ${escapeMarkdown(title)}\n` +
                    `📺 [Tonton/Download Video](${escapeMarkdown(url, '()[]')})`;
                await sendMarkdownV2Text(chatId, message);
            }
        } else if (status === 'failed') {
            await sendMarkdownV2Text(chatId, escapeMarkdown(`❌ *Gagal Download YouTube:* ${error || 'Unknown'}`, '*'));
        }
    } else {
        // Standard video composition callback
        await deliverJobResult(chatId, jobId, result, status, error);
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
