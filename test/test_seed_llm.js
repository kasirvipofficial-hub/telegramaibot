const fetch = globalThis.fetch;

async function testSeedLLM() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';
    const model = 'seed-2-0-mini-free';

    console.log(`🧠 Testing ${model} as a standalone LLM...`);

    const prompt = `
    Saya ingin membuat video pendek (Shorts/Reels) tentang "Tips Sukses Jualan Online untuk Pemula".
    Tolong buatkan:
    1. Judul yang clickbait tapi benar.
    2. Hook (pembukaan) 3 detik pertama yang menarik.
    3. Outline singkat isi video (30 detik).
    4. Call to action di akhir.
    
    Balas dalam format Bahasa Indonesia yang santai dan profesional.
    `;

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
                        role: "system",
                        content: "Anda adalah asisten kreatif ahli pembuat konten video pendek viral."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        if (!res.ok) {
            const err = await res.text();
            throw new Error(`HTTP ${res.status}: ${err}`);
        }

        const data = await res.json();
        console.log('\n🤖 LLM RESPONSE:\n');
        console.log(data.choices[0].message.content);

    } catch (err) {
        console.error('❌ API Error:', err.message);
    }
}

testSeedLLM();
