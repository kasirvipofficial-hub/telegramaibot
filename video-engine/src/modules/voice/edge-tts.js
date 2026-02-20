import gTTS from 'node-gtts';
import path from 'path';
import fs from 'fs/promises';

export default {
    async generateVoiceOver(options) {
        // gTTS only uses 'id' for Indonesian
        console.log(`[Google TTS] Generating speech for: "${options.text.substring(0, 30)}..."`);
        try {
            const workDir = options.workDir || path.resolve('tmp');
            await fs.mkdir(workDir, { recursive: true });
            const voPath = path.join(workDir, `vo_gtts_${Date.now()}.mp3`);
            
            return new Promise((resolve, reject) => {
                const gtts = new gTTS('id');
                gtts.save(voPath, options.text, function(err, result) {
                    if (err) {
                        return reject(err);
                    }
                    console.log(`[Google TTS] Generation complete, saving to ${voPath}`);
                    resolve({
                        url: voPath,
                        timestamps: null,
                        provider: 'edge' // kept as 'edge' internally to avoid editing composition engine again
                    });
                });
            });
        } catch (err) {
            console.error(`[Google TTS] Error:`, err);
            throw new Error(`Google TTS Error: ${err.message}`);
        }
    }
};
