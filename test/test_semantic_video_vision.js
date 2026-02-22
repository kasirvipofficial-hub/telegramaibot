const fetch = globalThis.fetch;

async function testSemanticVideoAnalysis() {
    const apiKey = 'sk-XgmAFOIOwvQPF-XHdwj4Cg';
    const baseUrl = 'https://ai.sumopod.com/v1';
    const model = 'seed-2-0-mini-free';
    const videoUrl = 'https://assets.sarungtambalan.my.id/users/2047148935/jobs/14c96cc4-baf8-4a84-99a0-ac0ef8236a58/output.mp4';

    console.log(`🧠 Testing Semantic Video Analysis for Vector DB...`);

    // System prompt behavior for JSON enforcement
    const systemPrompt = `You are a video metadata extractor for a Vector Database.
Your task is to analyze the video and output ONLY a valid JSON object.
This JSON will be embedded for semantic search.
Ensure the descriptions are detailed enough for a vector database to find specific moments.`;

    const userPrompt = `Analisa video ini dan berikan output dalam format JSON berikut:
{
  "video_metadata": {
    "title": "String",
    "global_summary": "Detailed summary of the whole video",
    "primary_category": "e.g. Cooking, Tutorial, Educational",
    "overall_mood": "String"
  },
  "semantic_segments": [
    {
      "start_time": "seconds",
      "end_time": "seconds",
      "description": "Very detailed description of what is happening in this specific segment",
      "tags": ["list", "of", "keywords", "for", "search"],
      "visual_elements": ["list of objects seen"]
    }
  ]
}`;

    const messages = [
        { role: "system", content: systemPrompt },
        {
            role: "user",
            content: [
                { type: "text", text: userPrompt },
                {
                    type: "video_url",
                    video_url: { url: videoUrl }
                }
            ]
        }
    ];

    try {
        console.log('📡 Generating Structured Metadata...');
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model,
                messages: messages,
                max_tokens: 1500,
                response_format: { type: "json_object" }
            })
        });

        if (!res.ok) {
            const errBody = await res.text();
            throw new Error(`HTTP ${res.status}: ${errBody}`);
        }

        const data = await res.json();
        const jsonOutput = JSON.parse(data.choices[0].message.content);

        console.log('\n✅ STRUCTURED METADATA GENERATED (Vector DB Ready):\n');
        console.log(JSON.stringify(jsonOutput, null, 2));

        console.log('\n--- 🚀 Vision for Semantic Search ---');
        console.log('Data di atas siap untuk di-generate embedding-nya (OpenAI Ada atau Voyage AI)');
        console.log('dan disimpan ke Vector Database (Pinecone/Milvus).');
        console.log('User nantinya bisa cari: "Cari momen saat santan dituang"');
        console.log('dan sistem akan langsung menemukan segment yang deskripsinya relevan.');

    } catch (err) {
        console.error('❌ Semantic Vision Error:', err.message);
    }
}

testSemanticVideoAnalysis();
