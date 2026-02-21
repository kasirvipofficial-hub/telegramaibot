import fs from 'fs/promises';
import fs_sync from 'fs';
import { fetch, Blob, FormData } from 'undici';

/**
 * Service to interact with Whisper-1 (STT) via Sumopod API
 */
export default {
    /**
     * Transcribe audio file to get word-level timestamps
     * 
     * @param {string} audioPath - Path to the local audio file
     * @returns {Promise<Object>} Object containing text and timestamps
     */
    async transcribe(audioPath) {
        const apiKey = process.env.OPENAI_API_KEY || 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
        const baseUrl = 'https://ai.sumopod.com/v1';

        console.log(`[Whisper STT] Transcribing audio: ${audioPath}`);

        try {
            const fileBuffer = fs_sync.readFileSync(audioPath);
            const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

            const formData = new FormData();
            formData.append('file', blob, 'audio.mp3');
            formData.append('model', 'whisper-1');
            formData.append('response_format', 'verbose_json');
            formData.append('timestamp_granularities[]', 'word');

            const res = await fetch(`${baseUrl}/audio/transcriptions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`
                },
                body: formData
            });

            if (!res.ok) {
                const err = await res.text();
                throw new Error(`Whisper API HTTP ${res.status}: ${err}`);
            }

            const data = await res.json();

            // Extract word-level timestamps if available, otherwise segments
            const words = data.words || data.segments || [];

            console.log(`[Whisper STT] Transcription successful. Captured ${words.length} time-stamped units.`);

            return {
                text: data.text,
                timestamps: words.map(w => ({
                    word: w.word || w.text,
                    start: w.start,
                    end: w.end
                }))
            };
        } catch (err) {
            console.error(`[Whisper STT] Error:`, err.message);
            throw err;
        }
    }
};
