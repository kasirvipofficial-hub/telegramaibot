import fs from 'fs/promises';
import path from 'path';

/**
 * Service untuk memanggil API TTS Hugging Face
 */
const TTS_CONFIG = {
    // Gunakan URL utama atau URL replica jika ingin lebih cepat
    baseUrl: "https://kasirvipofficial-tts-indonesia.hf.space",
    fnIndex: 1
};

export default {
    /**
     * Generate Voice Over using Custom Gradio Space
     * 
     * @param {Object} options 
     * @param {string} options.text - Text to convert to speech
     * @param {string} [options.voice] - Speaker name e.g. "Gadis - ..."
     * @param {number} [options.speed] - 0.1 to 1.99
     * @param {string} [options.workDir] - Directory to save the audio
     * @returns {Promise<Object>} Result containing local file path
     */
    async generateVoiceOver(options) {
        // Use the exact string name for the speaker dropdown
        let speaker = options.voice || 'Juminten - Suara perempuan jawa (bahasa jawa)';
        let speed = options.speed || 1.0;
        let language = "Indonesian";

        console.log(`[Custom Gradio TTS] Generating voice | Speaker: ${speaker.split(',')[0]} | Text: "${options.text.substring(0, 30)}..."`);

        try {
            const gradioUrl = `${TTS_CONFIG.baseUrl}/run/predict`;

            // 1. Post request asking for prediction targeting /run/predict
            const postRes = await fetch(gradioUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    fn_index: TTS_CONFIG.fnIndex,
                    data: [
                        options.text,
                        speaker,
                        speed,
                        language
                    ]
                })
            });

            if (!postRes.ok) throw new Error(`Failed to initiate Gradio task: ${postRes.status} ${postRes.statusText}`);
            const responseData = await postRes.json();

            if (!responseData.data || !responseData.data[0]) {
                throw new Error("Invalid response from Gradio API: missing data array.");
            }

            const fileData = responseData.data[0];
            const resultDataUrl = `${TTS_CONFIG.baseUrl}/file=${fileData.name}`;

            console.log(`[Custom Gradio TTS] Task complete. Downloading from URL: ${resultDataUrl}`);

            // 3. Download the finished audio file
            const fileRes = await fetch(resultDataUrl);
            if (!fileRes.ok) throw new Error(`Failed to download audio from Gradio. Status: ${fileRes.status}`);

            const workDir = options.workDir || path.resolve('tmp');
            await fs.mkdir(workDir, { recursive: true });

            // Generate valid file extension
            const ext = fileData.orig_name ? path.extname(fileData.orig_name) : '.wav';
            const voPath = path.join(workDir, `vo_gradio_${Date.now()}${ext}`);

            const buffer = await fileRes.arrayBuffer();
            await fs.writeFile(voPath, Buffer.from(buffer));

            console.log(`[Custom Gradio TTS] Download complete, saved to ${voPath}`);

            return {
                url: voPath,
                timestamps: null,
                provider: 'huggingface'
            };
        } catch (err) {
            console.error(`[Custom Gradio TTS] API Error:`, err);
            throw new Error(`Custom Gradio TTS Error: ${err.message}`);
        }
    }
};
