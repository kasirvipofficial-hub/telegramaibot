
import { fetch } from 'undici';
import fs from 'fs/promises';
import path from 'path';

/**
 * Hugging Face TTS Provider Module
 * Uses the Inference API to generate speech.
 */
export default {
    /**
     * Generate Voice Over using Hugging Face Inference API
     * 
     * @param {Object} options 
     * @param {string} options.text - Text to convert to speech
     * @param {string} [options.model] - Model ID (e.g., 'facebook/mms-tts-ind')
     * @param {string} [options.workDir] - Directory to save the temporary audio file
     * @returns {Promise<Object>} Result containing local file path
     */
    async generateVoiceOver(options) {
        let apiKey = process.env.HF_API_KEY;
        const model = options.model || 'facebook/mms-tts-ind';
        const baseUrl = `https://api-inference.huggingface.co/models/${model}`;

        if (!apiKey || apiKey === 'your_huggingface_token_here') {
            throw new Error('HF_API_KEY is not configured in .env');
        }

        console.log(`[Hugging Face TTS] Generating voice | Model: ${model}`);

        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                inputs: options.text
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[Hugging Face TTS] API Error: ${response.status} - ${errText}`);
            throw new Error(`Hugging Face TTS Error: ${response.status} - ${errText}`);
        }

        // Save response to a temporary file in the workDir if provided, else a global temp
        const workDir = options.workDir || path.resolve('tmp');
        const voPath = path.join(workDir, `vo_hf_${Date.now()}.wav`);

        console.log(`[Hugging Face TTS] Response OK, saving to ${voPath}`);
        const buffer = await response.arrayBuffer();
        await fs.writeFile(voPath, Buffer.from(buffer));

        return {
            url: voPath,
            timestamps: null, // Basic HF Inference API doesn't provide word timestamps
            provider: 'huggingface'
        };
    }
};
