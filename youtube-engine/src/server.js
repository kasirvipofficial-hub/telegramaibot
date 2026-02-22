import Fastify from 'fastify';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import youtubeService from './services/youtube.js';
import storageService from './services/storage.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fastify = Fastify({
    logger: {
        transport: {
            target: 'pino-pretty'
        }
    }
});

const TEMP_DIR = path.resolve(__dirname, '../temp');

// Ensure temp directory exists
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Health check
fastify.get('/', async () => {
    return { status: 'online', service: 'youtube-engine' };
});

/**
 * POST /download
 * Payload: { url: string, filename?: string }
 */
fastify.post('/download', async (request, reply) => {
    const { url, filename, chat_id } = request.body;

    if (!url) {
        return reply.code(400).send({ error: 'Missing YouTube URL' });
    }

    try {
        request.log.info(`Processing YouTube download for user ${chat_id || 'guest'}: ${url}`);

        // 1. Get video info
        const info = await youtubeService.getInfo(url);
        request.log.info(`Video found: ${info.title} (${info.duration}s)`);

        // 2. Prepare Final Key
        const safeTitle = info.title.replace(/[^\w\s-]/gi, '').replace(/\s+/g, '_');
        const fileName = filename || `yt_${info.videoId}_${safeTitle}.mp4`;
        const userFolder = chat_id ? `users/${chat_id}` : 'users/guest';
        const r2Key = `${userFolder}/youtube/${fileName}`;

        // Return immediately to avoid timeout
        reply.send({
            status: 'started',
            id: info.videoId,
            title: info.title
        });

        // 3. Process in background
        (async () => {
            let localFilePath = null;
            try {
                request.log.info(`[Background] Downloading via yt-dlp to local disk...`);
                localFilePath = await youtubeService.downloadToFile(url, TEMP_DIR, fileName);

                request.log.info(`[Background] Uploading local file to R2 key: ${r2Key}...`);
                const fileStream = fs.createReadStream(localFilePath);
                const publicUrl = await storageService.uploadStream(fileStream, r2Key, 'video/mp4');

                // 4. Send callback to bot
                const botCallbackUrl = process.env.BOT_CALLBACK_URL || 'http://localhost:3001/callback';

                request.log.info(`[Background] Sending success callback to ${botCallbackUrl}`);
                await fetch(botCallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'youtube_download',
                        id: info.videoId,
                        status: 'done',
                        title: info.title,
                        url: publicUrl,
                        storage_key: r2Key,
                        payload: { meta: { chat_id } }
                    })
                });
            } catch (bgErr) {
                request.log.error(`[Background] YouTube Process Error: ${bgErr.message}`);
                const botCallbackUrl = process.env.BOT_CALLBACK_URL || 'http://localhost:3001/callback';
                await fetch(botCallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'youtube_download',
                        id: info.videoId,
                        status: 'failed',
                        error: bgErr.message,
                        payload: { meta: { chat_id } }
                    })
                }).catch(() => { });
            } finally {
                if (localFilePath && fs.existsSync(localFilePath)) {
                    fs.unlinkSync(localFilePath);
                    request.log.info(`[Background] Cleaned up temporary file: ${localFilePath}`);
                }
            }
        })();

    } catch (err) {
        request.log.error(`YouTube Initial Error: ${err.message}`);
        return reply.code(500).send({
            status: 'failed',
            error: err.message
        });
    }
});

const start = async () => {
    try {
        const port = process.env.PORT || 3002;
        await fastify.listen({ port: parseInt(port), host: '0.0.0.0' });
        console.log(`YouTube Engine running at http://localhost:${port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
