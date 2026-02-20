
import { fetch } from 'undici';

const KIE_API_BASE = 'https://api.kie.ai/api/v1';

export default {
    /**
     * Generate Voice Over using Kie.ai (ElevenLabs TTS)
     * 
     * Endpoints:
     *   - POST /api/v1/jobs/createTask (create)
     *   - GET  /api/v1/jobs/recordInfo?taskId=xxx (poll status)
     * 
     * @param {Object} options 
     * @param {string} options.text - Text to convert to speech (max 5000 chars)
     * @param {string} [options.voice] - Voice ID (default: tnSpp4vdxKPjI9w0GnoV / Hope)
     * @param {string} [options.model] - Model name
     * @param {number} [options.stability] - Voice stability (0-1)
     * @param {number} [options.similarity_boost] - Similarity boost (0-1)
     * @param {number} [options.style] - Style exaggeration (0-1)
     * @param {number} [options.speed] - Speech speed (0.7-1.2)
     * @param {boolean} [options.timestamps] - Whether to return word timestamps
     * @param {string} [options.language_code] - Language code, only for Turbo v2.5
     * @param {string} [options.callBackUrl] - Callback URL for async notifications
     * @returns {Promise<Object>} Result containing URL and task details
     */
    async generateVoiceOver(options) {
        let apiKey = process.env.KIE_AI_API_KEY;

        // Fallback: manually parse .env if key is missing
        if (!apiKey || apiKey === 'your_key_here') {
            try {
                const fs = await import('fs');
                const path = await import('path');
                const envPath = path.resolve(process.cwd(), '.env');
                if (fs.existsSync(envPath)) {
                    const content = fs.readFileSync(envPath, 'utf8');
                    const match = content.match(/KIE_AI_API_KEY=([^\s]+)/);
                    if (match && match[1]) {
                        apiKey = match[1].trim();
                        process.env.KIE_AI_API_KEY = apiKey;
                        console.log('[Kie.ai] Loaded API Key from .env');
                    }
                }
            } catch (e) {
                console.error('[Kie.ai] .env load failed:', e.message);
            }
        }

        if (!apiKey || apiKey === 'your_key_here') {
            throw new Error('KIE_AI_API_KEY is not configured in .env');
        }

        // Build input object matching the official API spec
        const input = {
            text: options.text,
            voice: options.voice || 'tnSpp4vdxKPjI9w0GnoV',
            stability: options.stability ?? 0.5,
            similarity_boost: options.similarity_boost ?? 0.75,
            style: options.style ?? 0,
            speed: options.speed ?? 1,
            timestamps: options.timestamps ?? false,
        };

        // language_code only supported by Turbo v2.5 models
        const model = options.model || 'elevenlabs/text-to-speech-multilingual-v2';
        if (options.language_code && model.includes('turbo')) {
            input.language_code = options.language_code;
        }

        const payload = { model, input };
        if (options.callBackUrl) {
            payload.callBackUrl = options.callBackUrl;
        }

        console.log(`[Kie.ai] Creating TTS task | Model: ${model} | Voice: ${input.voice}`);
        console.log(`[Kie.ai] Text: "${options.text.substring(0, 60)}..."`);

        // Step 1: Create Task
        const response = await fetch(`${KIE_API_BASE}/jobs/createTask`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.code !== 200) {
            throw new Error(`Kie.ai createTask Error: ${data.msg || data.message || JSON.stringify(data)}`);
        }

        const taskId = data.data.taskId;
        console.log(`[Kie.ai] Task created: ${taskId}`);

        // Step 2: Poll for completion using /jobs/recordInfo
        const maxRetries = 90; // 90 * 2s = 180s (3 min) max
        for (let i = 0; i < maxRetries; i++) {
            await new Promise(resolve => setTimeout(resolve, 2000));

            try {
                const statusResponse = await fetch(`${KIE_API_BASE}/jobs/recordInfo?taskId=${taskId}`, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                });

                const statusData = await statusResponse.json();

                if (i === 0 || i % 5 === 0) {
                    console.log(`[Kie.ai] Poll #${i + 1} (${(i + 1) * 2}s) | state: ${statusData.data?.state}`);
                }

                if (statusData.code !== 200) {
                    console.warn(`[Kie.ai] Poll error (code ${statusData.code}): ${statusData.msg || statusData.message}`);
                    continue;
                }

                const task = statusData.data;
                const state = (task.state || '').toUpperCase();

                if (state === 'SUCCESS') {
                    console.log(`[Kie.ai] Task ${taskId} completed in ~${(i + 1) * 2}s (cost: ${task.costTime}s)`);
                    const result = JSON.parse(task.resultJson);
                    return {
                        url: result.resultUrls[0],
                        timestamps: result.timestamps, // Pass through timestamps for subtitles
                        taskId: taskId,
                        costTime: task.costTime,
                        state: task.state
                    };
                } else if (state === 'FAIL' || state === 'GENERATE_FAILED' || state === 'CREATE_TASK_FAILED') {
                    throw new Error(`Kie.ai Task Failed: ${task.failMsg || task.failCode || 'Unknown'}`);
                } else if (state === 'SENSITIVE_WORD_ERROR') {
                    throw new Error(`Kie.ai content filtered: sensitive word detected`);
                }
                // Still GENERATING / PENDING, continue polling...
            } catch (pollErr) {
                if (pollErr.message.includes('Kie.ai')) throw pollErr;
                console.warn(`[Kie.ai] Poll network error: ${pollErr.message}`);
            }
        }

        throw new Error(`Kie.ai Task Timed Out after ${maxRetries * 2}s: ${taskId}`);
    }
};
