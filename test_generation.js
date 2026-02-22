const fetch = globalThis.fetch;
const fs = require('fs');

async function testImageGeneration() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';
    const model = 'seed-2-0-mini-free';

    console.log(`🎨 Testing IMAGE generation with: ${model}...`);

    try {
        const res = await fetch(`${baseUrl}/images/generations`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                prompt: "A futuristic cyberpunk city in 4k detail, neon lights, rainy hyper-realistic.",
                n: 1,
                size: "1024x1024"
            })
        });

        const data = await res.json();
        if (!res.ok) {
            console.log(`❌ Image Gen Failed for ${model}: ${JSON.stringify(data)}`);

            // Try gpt-image-1 as fallback if user wants to see image gen
            console.log(`🔄 Trying gpt-image-1 instead...`);
            const res2 = await fetch(`${baseUrl}/images/generations`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-image-1',
                    prompt: "A futuristic cyberpunk city in 4k detail, neon lights, rainy hyper-realistic.",
                    n: 1,
                    size: "1024x1024"
                })
            });
            const data2 = await res2.json();
            console.log('✅ gpt-image-1 Response:', data2);
        } else {
            console.log('✅ Seed Image Response:', data);
        }

    } catch (err) {
        console.error('❌ API Error:', err.message);
    }
}

async function testVideoGeneration() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';
    const model = 'seed-2-0-mini-free';

    console.log(`\n🎬 Testing VIDEO generation with: ${model}...`);

    try {
        // Many OpenAI-compatible APIs use /videos/generations or /images/generations with a video model
        const res = await fetch(`${baseUrl}/videos/generations`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                prompt: "A cinematic drone shot of a tropical island, 4k.",
            })
        });

        const data = await res.json();
        if (!res.ok) {
            console.log(`❌ Video Gen Failed/Unsupported: ${res.status} ${JSON.stringify(data)}`);
        } else {
            console.log('✅ Video Response:', data);
        }
    } catch (err) {
        console.log('❌ Video API Error (Likely No Endpoint):', err.message);
    }
}

async function run() {
    await testImageGeneration();
    await testVideoGeneration();
}

run();
