const fetch = globalThis.fetch;

async function testDeezer(genre) {
    console.log(`\n--- Testing Deezer Search for: "${genre}" ---`);
    try {
        const query = encodeURIComponent(genre);
        const url = `https://api.deezer.com/search/track?q=${query}&limit=5`;
        console.log(`Requesting: ${url}`);

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.data || data.data.length === 0) {
            console.log('❌ No tracks found.');
            return;
        }

        console.log(`✅ Found ${data.data.length} tracks.`);
        data.data.forEach((track, i) => {
            console.log(`   [${i + 1}] ${track.title} - ${track.artist.name}`);
            console.log(`       Preview: ${track.preview}`);
        });

    } catch (err) {
        console.error('❌ Deezer Search Error:', err.message);
    }
}

async function runTests() {
    await testDeezer('lofi hip hop');
    await testDeezer('cinematic epic');
    await testDeezer('happy acoustic');
}

runTests();
