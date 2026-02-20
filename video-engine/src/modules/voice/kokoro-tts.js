import * as KokoroJS from 'kokoro-js';
const Kokoro = KokoroJS.Kokoro || KokoroJS.KokoroTTS || KokoroJS.default;
import fs from 'fs/promises';
import path from 'path';

/**
 * Kokoro-82M TTS Provider Module (Self-Hosted)
 * Runs locally using ONNX Runtime.
 */
let kokoroInstance = null;

export default {
    /**
     * Generate Voice Over using local Kokoro model
     * 
     * @param {Object} options 
     * @param {string} options.text - Text to convert to speech
     * @param {string} [options.voice] - Voice ID (default: 'af_heart')
     * @param {string} [options.workDir] - Directory to save the temporary audio file
     * @returns {Promise<Object>} Result containing local file path
     */
    async generateVoiceOver(options) {
        const voice = options.voice || 'af_heart';

        console.log(`[Kokoro TTS] Initializing local model...`);

        try {
            if (!kokoroInstance) {
                kokoroInstance = await Kokoro.from_pretrained('hexgrad/Kokoro-82M', {
                    dtype: 'q8', // Quantized for better performance on CPU
                    device: 'cpu',
                });
            }

            const workDir = options.workDir || path.resolve('tmp');
            const voPath = path.join(workDir, `vo_kokoro_${Date.now()}.wav`);

            console.log(`[Kokoro TTS] Generating speech for: "${options.text.substring(0, 30)}..."`);

            const audio = await kokoroInstance.generate(options.text, {
                voice: voice,
            });

            console.log(`[Kokoro TTS] Generation complete, saving to ${voPath}`);
            await audio.save(voPath);

            return {
                url: voPath,
                timestamps: null, // Kokoro-js doesn't provide word-level timestamps yet
                provider: 'kokoro'
            };
        } catch (err) {
            console.error(`[Kokoro TTS] Error:`, err);
            throw new Error(`Kokoro TTS Error: ${err.message}`);
        }
    }
};
