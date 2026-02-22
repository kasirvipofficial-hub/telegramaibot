const fetch = globalThis.fetch;
const fs = require('fs');

async function testImageToFile() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';

    console.log(`🎨 Generating image with gpt-image-1...`);

    try {
        const res = await fetch(`${baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'gpt-image-1',
                prompt: "A beautiful Indonesian tropical beach at sunset, hyper-realistic, 4k.",
                n: 1,
                size: "1024x1024",
                response_format: "b64_json"
            })
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
        }

        if (data.data && data.data[0].b64_json) {
            const b64 = data.data[0].b64_json;
            const buffer = Buffer.from(b64, 'base64');
            fs.writeFileSync('test_generated_image.png', buffer);
            console.log('✅ Image saved to test_generated_image.png');
        } else if (data.data && data.data[0].url) {
            console.log('✅ Image URL:', data.data[0].url);
        } else {
            console.log('❓ Unexpected format:', JSON.stringify(data).substring(0, 500));
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
}

testImageToFile();
