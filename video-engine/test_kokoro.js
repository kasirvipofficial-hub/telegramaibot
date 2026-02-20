
import KokoroTTS from './src/modules/voice/kokoro-tts.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function test() {
    console.log('--- KOKORO STANDALONE TEST START ---');
    try {
        const testWorkDir = path.join(__dirname, 'tmp_test');
        await fs.mkdir(testWorkDir, { recursive: true });

        const result = await KokoroTTS.generateVoiceOver({
            text: 'Halo Mas Jack! Ini adalah tes suara mandiri dari Kokoro-82M yang berjalan langsung di VPS Mas. Suaranya jernih dan mantap!',
            voice: 'af_heart',
            workDir: testWorkDir
        });

        console.log('--- TEST SUCCESS ---');
        console.log('Result:', result);

        const stats = await fs.stat(result.url);
        console.log(`File Size: ${(stats.size / 1024).toFixed(2)} KB`);

        // Cleanup test file
        // await fs.unlink(result.url);
        console.log('Test file preserved at:', result.url);
    } catch (err) {
        console.error('--- TEST FAILED ---');
        console.error(err);
        process.exit(1);
    }
}

test();
