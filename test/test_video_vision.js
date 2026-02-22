const fs = require('fs');
const path = require('path');
const fetch = globalThis.fetch;

async function testVideoAnalysis() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';
    const model = 'seed-2-0-mini-free';

    const frameDir = 'test_vision';
    const frames = fs.readdirSync(frameDir)
        .filter(f => f.endsWith('.jpg'))
        .slice(0, 5); // Take first 5 frames for analysis

    console.log(`🎬 Analyzing video segments using ${model}...`);
    console.log(`📦 Using ${frames.length} frames from ${frameDir}`);

    const content = [
        {
            type: "text",
            text: "Ini adalah urutan frame dari sebuah video. Tolong analisa apa yang terjadi dalam video ini secara mendalam. Ceritakan suasana, objek yang muncul, dan gerakan yang terlihat dalam bahasa Indonesia."
        }
    ];

    // Add images to content
    for (const frame of frames) {
        const filePath = path.join(frameDir, frame);
        const base64Image = fs.readFileSync(filePath).toString('base64');
        content.push({
            type: "image_url",
            image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
            }
        });
    }

    try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: [
                    {
                        role: "user",
                        content: content
                    }
                ],
                max_tokens: 1000
            })
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`HTTP ${res.status}: ${errBody}`);
        }

        const data = await res.json();
        console.log('\n🤖 ANALYSIS RESULT:\n');
        console.log(data.choices[0].message.content);

    } catch (err) {
        console.error('❌ Vision API Error:', err.message);
    }
}

testVideoAnalysis();
