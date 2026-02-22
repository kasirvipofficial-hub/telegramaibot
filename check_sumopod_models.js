const fetch = globalThis.fetch;

async function checkModels() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';

    console.log(`🔍 Checking available models at: ${baseUrl}`);

    try {
        const res = await fetch(`${baseUrl}/models`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP Error: ${res.status}`);
        }

        const data = await res.json();

        if (data.data && Array.isArray(data.data)) {
            console.log(`✅ Found ${data.data.length} models:`);
            data.data.forEach((model, i) => {
                console.log(`   [${i + 1}] ID: ${model.id}`);
                if (model.owned_by) console.log(`       Provider: ${model.owned_by}`);
            });
        } else {
            console.log('❓ Unexpected response format:', data);
        }

    } catch (err) {
        console.error('❌ Error fetching models:', err.message);
    }
}

checkModels();
