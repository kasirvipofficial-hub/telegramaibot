const fs = require('fs');
const fetch = globalThis.fetch;

async function testTranscription() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';
    const audioPath = 'test_speech.mp3';

    console.log(`🎙️ Sending "${audioPath}" to Whisper-1...`);

    try {
        const formData = new FormData();
        const fileBuffer = fs.readFileSync(audioPath);
        const blob = new Blob([fileBuffer], { type: 'audio/mpeg' });

        formData.append('file', blob, 'audio.mp3');
        formData.append('model', 'whisper-1');
        formData.append('language', 'id'); // Set to Indonesian

        const res = await fetch(`${baseUrl}/audio/transcriptions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`
            },
            body: formData
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`HTTP ${res.status}: ${err}`);
        }

        const data = await res.json();
        console.log('\n📝 TRANSCRIPTION RESULT:\n');
        console.log(data.text);

    } catch (err) {
        console.error('❌ Whisper API Error:', err.message);
    }
}

testTranscription();
