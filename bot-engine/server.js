import Fastify from 'fastify';
import dotenv from 'dotenv';
import path from 'path';
import OpenAI from 'openai';

dotenv.config();

const fastify = Fastify({ logger: true });

// Constants from Environment
const TOKEN = process.env.ENV_BOT_TOKEN;
const WEBHOOK_PATH = '/endpoint';
const SECRET = process.env.ENV_BOT_SECRET;
const ENGINE_BASE_URL = (process.env.ENV_ENGINE_URL || 'http://localhost:3000').replace(/\/$/, '');

// LLM Configuration
const openai = new OpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL || 'https://api.openai.com/v1'
});

// User Session Tracking
const userStates = new Map(); // chatId -> { state: string, data: object }

if (!TOKEN) {
    console.error('FATAL: ENV_BOT_TOKEN is missing in .env');
    process.exit(1);
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
    return (await fetch(apiUrl('sendVideo', {
        chat_id: chatId,
        video: videoUrl,
        caption
    }))).json();
}

function escapeMarkdown(str, except = '') {
    const all = '_*[]()~`>#+-=|{}.!\\'.split('').filter(c => !except.includes(c));
    const regExSpecial = '^$*+?.()|{}[]\\';
    const regEx = new RegExp('[' + all.map(c => (regExSpecial.includes(c) ? '\\' + c : c)).join('') + ']', 'gim');
    return str.replace(regEx, '\\$&');
}

/**
 * AI BRAINSTORMING LOGIC
 */
async function brainstormWithAI(topic) {
    console.log(`🧠 AI Brainstorming for topic: ${topic}`);
    const prompt = `You are a creative video producer. Transform the topic "${topic}" into a structured video brief.
Output purely as JSON in this format:
{
  "title": "Short catchy title",
  "description": "Engaging social media description with hashtags",
  "narasi": "Full voice over script (approx 20-30 words for shorts)",
  "cta": "Call to action text",
  "asset_keywords": ["keyword 1", "keyword 2"]
}
Language: Indonesian. Just JSON, no other text.`;

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
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
    console.log(`📩 Incoming Update: ${JSON.stringify(update)}`);
    if ('message' in update) {
        await onMessage(update.message);
    } else if ('callback_query' in update) {
        await onCallbackQuery(update.callback_query);
    }
}

async function onMessage(message) {
    const chatId = message.chat.id;
    const text = message.text || '';
    const state = userStates.get(chatId);

    // 1. Initial Commands
    if (text.startsWith('/start') || text.startsWith('/help')) {
        return sendMarkdownV2Text(chatId, '*🌟 AI Video Studio Portal*\n' +
            escapeMarkdown(
                '/videogenerator - Mulai membuat video (AI Workflow)\n' +
                '/status [id] - Cek status render\n' +
                '/cancel - Batalkan sesi aktif',
                '`'));
    }

    if (text === '/cancel') {
        userStates.delete(chatId);
        return sendMarkdownV2Text(chatId, '❌ Sesi dibatalkan\\. Ketik `/videogenerator` untuk mulai lagi\\.');
    }

    if (text.startsWith('/videogenerator')) {
        userStates.set(chatId, { state: 'AWAITING_TOPIC', data: {} });
        return sendMarkdownV2Text(chatId, '🎬 *Mari buat mahakarya\\!* \n\nApa topik utama video yang ingin Mas buat? \\(Misal: Tips diet sehat, Sejarah Jakarta, atau Motivasi Pagi\\)');
    }

    if (text.startsWith('/status')) {
        const jobId = text.replace('/status', '').trim();
        if (!jobId) return sendMarkdownV2Text(chatId, 'Silakan masukkan ID job.');
        return checkJobStatus(chatId, jobId);
    }

    // 2. State Handling (Conversation Flow)
    if (state) {
        if (state.state === 'AWAITING_TOPIC') {
            return handleTopicInput(chatId, text);
        }
    }

    // Default response for unknown/out of state
    if (!text.startsWith('/')) {
        return sendMarkdownV2Text(chatId, 'Gunakan perintah `/help` untuk melihat daftar perintah, atau `/videogenerator` untuk mulai membuat video\\.');
    }
}

/**
 * STEP HANDLERS
 */

async function handleTopicInput(chatId, topic) {
    await sendMarkdownV2Text(chatId, '🧠 *AI sedang merancang ide kreatif...* Mohon tunggu sebentar.');

    try {
        const brief = await brainstormWithAI(topic);
        console.log(`📝 Constructing brief message for ${chatId}`);
        userStates.set(chatId, {
            state: 'REVIEWING_BRIEF',
            data: { topic, ...brief }
        });

        const message = `✨ *Konsep Kreatif Siap\\!*\n\n` +
            `🏷️ *Judul:* ${escapeMarkdown(brief.title)}\n` +
            `📝 *Narasi:* _"${escapeMarkdown(brief.narasi)}"_\n\n` +
            `📺 *Deskripsi:* ${escapeMarkdown(brief.description)}\n` +
            `🎯 *CTA:* ${escapeMarkdown(brief.cta)}\n\n` +
            `Suka dengan konsep ini?`;

        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Lanjut Pilih Gaya', callback_data: 'brief_ok' }],
                [{ text: '🔄 Ganti Topik', callback_data: 'brief_retry' }]
            ]
        };

        return await sendMarkdownV2Text(chatId, message, keyboard);
    } catch (err) {
        console.error('AI Error:', err);
        return await sendMarkdownV2Text(chatId, '❌ Maaf, AI sedang pusing. Coba lagi atau gunakan topik lain.');
    }
}

async function onCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;
    const state = userStates.get(chatId);

    if (!state) return;

    if (data === 'brief_retry') {
        userStates.set(chatId, { state: 'AWAITING_TOPIC', data: {} });
        return editMessageText(chatId, messageId, 'Oke, mari kita coba topik lain. Apa topik barunya?');
    }

    if (data === 'brief_ok') {
        return askStyle(chatId, messageId);
    }

    // Style Selection
    if (data.startsWith('style_')) {
        state.data.style = data.replace('style_', '');
        return askDuration(chatId, messageId);
    }

    // Duration Selection
    if (data.startsWith('dur_')) {
        state.data.duration = parseInt(data.replace('dur_', ''));
        return askTTS(chatId, messageId);
    }

    // Voice Character Selection
    if (data.startsWith('vox_')) {
        state.data.voice_choice = data.replace('vox_', '');
        return askSource(chatId, messageId);
    }

    // Source Selection
    if (data.startsWith('src_')) {
        state.data.source = data.replace('src_', '');
        return askConfirmation(chatId, messageId);
    }

    // Final Confirmation
    if (data === 'confirm_go') {
        return executeVideoGeneration(chatId, messageId);
    }
}

async function askStyle(chatId, messageId) {
    const message = '🎨 *Pilih Gaya Visual Video Anda:*';
    const keyboard = {
        inline_keyboard: [
            [{ text: '✨ Aesthetic Vlog', callback_data: 'style_aesthetic_vlog' }],
            [{ text: '🚀 Modern Bold', callback_data: 'style_modern_bold' }],
            [{ text: '🎥 Cinematic Dark', callback_data: 'style_cinematic' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askDuration(chatId, messageId) {
    const message = '⏳ *Berapa lama durasi videonya?*';
    const keyboard = {
        inline_keyboard: [
            [{ text: '15 Detik (Shorts/TikTok)', callback_data: 'dur_15' }],
            [{ text: '30 Detik (Standard)', callback_data: 'dur_30' }],
            [{ text: '60 Detik (Long)', callback_data: 'dur_60' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askTTS(chatId, messageId) {
    const message = '🎤 *Pilih Karakter Suara Narator:*';
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

async function askSource(chatId, messageId) {
    const message = '📂 *Gunakan sumber aset dari mana?*';
    const keyboard = {
        inline_keyboard: [
            [{ text: '🎞️ Pexels (Stock Video)', callback_data: 'src_pexels' }],
            [{ text: '👤 Aset Pribadi (Local)', callback_data: 'src_pribadi' }],
            [{ text: '🔄 Mix (Pexels + Pribadi)', callback_data: 'src_mix' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function askConfirmation(chatId, messageId) {
    const state = userStates.get(chatId);
    const { title, style, duration, source, voice_choice } = state.data;

    let voiceName = 'Suara AI';
    if (voice_choice === 'ardi') voiceName = 'Ardi (Male)';
    else if (voice_choice === 'wibowo') voiceName = 'Wibowo (Male)';
    else if (voice_choice === 'gadis') voiceName = 'Gadis (Female)';
    else if (voice_choice === 'juminten') voiceName = 'Juminten (Jawa)';
    else if (voice_choice === 'asep') voiceName = 'Asep (Sunda)';

    const message = `🚩 *Konfirmasi Pesanan Video*\n\n` +
        `🏷️ *Judul:* ${escapeMarkdown(title)}\n` +
        `🎨 *Style:* \`${style}\`\n` +
        `⏳ *Durasi:* \`${duration} Detik\`\n` +
        `🎤 *Voice:* \`${voiceName}\`\n` +
        `📂 *Sumber:* \`${source}\`\n\n` +
        `Siap untuk produksi sekarang?`;

    const keyboard = {
        inline_keyboard: [
            [{ text: '🚀 GAS PRODUKSI!', callback_data: 'confirm_go' }],
            [{ text: '❌ Batal', callback_data: 'brief_retry' }]
        ]
    };
    return editMessageText(chatId, messageId, message, keyboard);
}

async function executeVideoGeneration(chatId, messageId) {
    const state = userStates.get(chatId);
    const { topic, narasi, style, duration, asset_keywords, source, voice_choice } = state.data;

    await editMessageText(chatId, messageId, '⚙️ *Menghubungi Pabrik Video...* Pesanan Anda sedang diproses\\.');

    // Voice mapping for Hugging Face Gradio Space
    let mappedVoice = 'Juminten - Suara perempuan jawa (bahasa jawa)'; // Default fallback
    if (voice_choice === 'ardi') mappedVoice = 'Ardi - Suara lembut dan hangat';
    else if (voice_choice === 'wibowo') mappedVoice = 'Wibowo - Suara jantan berwibawa';
    else if (voice_choice === 'gadis') mappedVoice = 'Gadis - Suara perempuan yang merdu';
    else if (voice_choice === 'juminten') mappedVoice = 'Juminten - Suara perempuan jawa (bahasa jawa)';
    else if (voice_choice === 'asep') mappedVoice = 'Asep - Suara lelaki sunda (bahasa sunda)';

    // Distribution of clips based on duration
    const numClips = Math.max(3, Math.ceil(duration / 4)); // At least 3 clips, approx 4s each

    // We add 0.5s to each clip (except the last one if we want to be precise, 
    // but adding to all is safer for 'shortest' logic) to account for xfade overlaps.
    const transitionOverlap = 0.5;
    const clipDuration = (duration / numClips) + transitionOverlap;

    // Formulate clips based on source
    let clips = [];
    // User wants to ignore local filesystem for now and will provide an API later.
    // For now, regardless of source, we use the AI-generated keywords to search assets.
    for (let i = 0; i < numClips; i++) {
        const query = asset_keywords[i % asset_keywords.length] || topic;
        clips.push({ query, duration: clipDuration });
    }

    const payload = {
        mode: 'composition',
        webhook_url: `http://localhost:3001/callback`,
        composition: {
            template_id: style,
            output_format: 'shorts',
            meta: { chat_id: chatId },
            clips: clips,
            voice_over: {
                text: narasi,
                provider: 'huggingface', // Hardcode to Custom Space Gradio
                voice: mappedVoice,
                word_highlight: false, // Turn off Kie.ai highlight since we use HF
                language_code: 'id'
            },
            template_overrides: {
                audio_ducking: true,
                music_volume: 0.2
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

        userStates.delete(chatId); // Clear session

        if (res.ok) {
            return sendMarkdownV2Text(chatId, escapeMarkdown(`✅ *ANTRIAN DIMULAI!*\nJob ID: \`${result.job_id}\`\n\nSaya akan kirim videonya ke sini jika sudah matang.`, '*`'));
        } else {
            throw new Error(result.error || 'Engine Error');
        }
    } catch (err) {
        return sendMarkdownV2Text(chatId, `❌ *Gagal Terhubung ke Engine:* ${err.message}`);
    }
}

/**
 * ENGINE CALLS (LEGACY SUPPORT)
 */
async function checkJobStatus(chatId, jobId) {
    try {
        const res = await fetch(`${ENGINE_BASE_URL}/jobs/${jobId}`);
        const result = await res.json();
        if (res.ok) {
            let message = `📊 *Status Job:* \`${result.status}\`\n`;
            if (result.progress) {
                const progressText = typeof result.progress === 'object'
                    ? (result.progress.message || result.progress.stage || 'Processing')
                    : `${result.progress}%`;
                message += `⏳ Progress: \`${progressText}\`\n`;
            }
            if (result.status === 'done' && result.result?.url) {
                message += `🎬 [Tonton Video](${result.result.url})`;
            }
            await sendMarkdownV2Text(chatId, escapeMarkdown(message, '*`[]()'));
        } else {
            throw new Error(result.error);
        }
    } catch (err) {
        await sendMarkdownV2Text(chatId, `❌ *Error:* ${err.message}`);
    }
}

/**
 * ROUTES
 */
fastify.get('/', async () => ({ status: 'online', service: 'bot-engine-interactive' }));


fastify.post(WEBHOOK_PATH, async (request, reply) => {
    try {
        await onUpdate(request.body);
    } catch (err) {
        console.error('Bot Runtime Error:', err);
    }
    return { ok: true };
});

fastify.post('/callback', async (request, reply) => {
    const data = request.body;
    const { id: jobId, status, payload, result, error } = data;
    const chatId = payload?.meta?.chat_id || payload?.composition?.meta?.chat_id;

    if (!chatId) return reply.code(400).send({ error: 'No chatId' });

    if (status === 'done' && result?.url) {
        await sendVideo(chatId, result.url, `✅ Video Anda siap! ID: ${jobId}`);
    } else if (status === 'failed') {
        await sendMarkdownV2Text(chatId, `❌ *Render Gagal:* ${error || 'Unknown'}`);
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
