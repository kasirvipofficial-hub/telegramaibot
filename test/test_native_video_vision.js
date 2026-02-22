const fetch = globalThis.fetch;

async function testNativeVideoAnalysis() {
    // API Configuration
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';
    const model = 'seed-2-0-mini-free';

    // Test Video URL (Example: Cooking video or similar)
    const videoUrl = 'https://assets.sarungtambalan.my.id/users/2047148935/jobs/14c96cc4-baf8-4a84-99a0-ac0ef8236a58/output.mp4';

    console.log(`🎬 Testing Native Video Vision using ${model}...`);
    console.log(`🔗 Video URL: ${videoUrl}`);

    const messages = [
        {
            role: "user",
            content: [
                {
                    type: "text",
                    text: "Tolong analisa video ini secara mendalam. Ceritakan suasana, objek yang muncul, dan apa yang sedang terjadi dalam bahasa Indonesia."
                },
                {
                    type: "video_url",
                    video_url: {
                        url: videoUrl
                    }
                }
            ]
        }
    ];

    try {
        console.log('📡 Sending request to AI Vision Service...');
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 1000
            })
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`HTTP ${res.status}: ${errBody}`);
        }

        const data = await res.json();
        console.log('\n🤖 NATIVE VISION ANALYSIS RESULT:\n');
        console.log(data.choices[0].message.content);

    } catch (err) {
        console.error('❌ Native Vision API Error:', err.message);
    }
}

testNativeVideoAnalysis();
