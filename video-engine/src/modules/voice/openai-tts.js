
import { fetch } from 'undici';
import fs from 'fs/promises';
import path from 'path';

/**
 * OpenAI TTS Provider Module
 */
export default {
    /**
     * Generate Voice Over using OpenAI-compatible API
     * 
     * @param {Object} options 
     * @param {string} options.text - Text to convert to speech
     * @param {string} [options.voice] - Voice ID (alloy, echo, fable, onyx, nova, shimmer)
     * @param {string} [options.model] - Model name (tts-1, tts-1-hd)
     * @param {string} [options.workDir] - Directory to save the temporary audio file
     * @returns {Promise<Object>} Result containing local file path
     */
    async generateVoiceOver(options) {
        let apiKey = process.env.OPENAI_TTS_API_KEY;
        let baseUrl = process.env.OPENAI_TTS_BASE_URL || 'https://api.openai.com/v1';

        if (!apiKey) {
            throw new Error('OPENAI_TTS_API_KEY is not configured in .env');
        }

        const model = options.model || 'tts-1';
        const voice = options.voice || 'alloy';
        const input = options.text;

        console.log(`[OpenAI TTS] Generating voice | Model: ${model} | Voice: ${voice}`);

        const response = await fetch(`${baseUrl}/audio/speech`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model,
                input,
                voice
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[OpenAI TTS] API Error: ${response.status} - ${errText}`);
            throw new Error(`OpenAI TTS Error: ${response.status} - ${errText}`);
        }

        // Save response to a temporary file in the workDir if provided, else a global temp
        const workDir = options.workDir || path.resolve('tmp');
        const voPath = path.join(workDir, `vo_openai_${Date.now()}.mp3`);

        console.log(`[OpenAI TTS] Response OK, saving to ${voPath}`);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(voPath, Buffer.from(buffer));

        console.log(`[OpenAI TTS] Voice saved to: ${voPath}`);

        return {
            url: voPath, // Returning local path as "url" for the engine to copy
            timestamps: null, // OpenAI doesn't provide word timestamps out of the box
            provider: 'openai'
        };
    }
};
