/**
 * Stock Asset Module
 * Auto-fetch video clips from Pexels and Pixabay by keyword search.
 */
// Use globalThis.fetch to avoid undici ESM/CJS issues in some environments
const fetch = globalThis.fetch;

const PEXELS_BASE = 'https://api.pexels.com/videos/search';
const PIXABAY_BASE = 'https://pixabay.com/api/videos/';

export default {
    /**
     * Search for a stock video clip by keyword
     * @param {string} query - Search keyword
     * @param {Object} [options]
     * @param {string} [options.orientation] - 'portrait' | 'landscape' | 'square'
     * @param {number} [options.minDuration] - Minimum clip duration in seconds
     * @param {string} [options.provider] - Force a provider: 'pexels' | 'pixabay'
     * @returns {Promise<{url: string, provider: string, duration: number}>}
     */
    async searchVideo(query, options = {}) {
        const orientation = options.orientation || 'portrait';

        // Try Pexels first, fallback to Pixabay
        const providers = options.provider
            ? [options.provider]
            : ['pexels', 'pixabay'];

        for (const provider of providers) {
            try {
                if (provider === 'pexels') {
                    const result = await this.searchPexels(query, orientation, options.minDuration);
                    if (result) return { ...result, provider: 'pexels' };
                } else if (provider === 'pixabay') {
                    const result = await this.searchPixabay(query, orientation, options.minDuration);
                    if (result) return { ...result, provider: 'pixabay' };
                }
            } catch (e) {
                console.warn(`[Stock] ${provider} search failed for "${query}": ${e.message}`);
            }
        }
        throw new Error(`No stock video found for "${query}"`);
    },

    async searchPexels(query, orientation, minDuration) {
        const apiKey = process.env.PEXELS_API_KEY;
        if (!apiKey) return null;

        const params = new URLSearchParams({
            query,
            orientation,
            per_page: '20',
            size: 'medium'
        });

        console.log(`[Stock] Pexels searching: ${query} (${orientation})`);
        const res = await fetch(`${PEXELS_BASE}?${params}`, {
            headers: { 'Authorization': apiKey }
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error(`[Stock] Pexels error: ${res.status} - ${errText}`);
            throw new Error(`Pexels HTTP ${res.status}`);
        }
        const data = await res.json();
        console.log(`[Stock] Pexels found ${data.total_results} results`);

        if (!data.videos || data.videos.length === 0) return null;

        // Filter by min duration if specified
        let videos = data.videos;
        if (minDuration) {
            videos = videos.filter(v => v.duration >= minDuration);
        }
        if (videos.length === 0) videos = data.videos; // fallback

        // Pick a random usable video from the results to prevent repeating scenes
        const video = videos[Math.floor(Math.random() * videos.length)];
        const hdFile = video.video_files.find(f =>
            f.quality === 'hd' && f.width >= 720
        ) || video.video_files[0];

        return {
            url: hdFile.link,
            duration: video.duration,
            width: hdFile.width,
            height: hdFile.height
        };
    },

    async searchPixabay(query, orientation, minDuration) {
        const apiKey = process.env.PIXABAY_API_KEY;
        if (!apiKey) return null;

        // Map orientation
        const typeMap = { portrait: 'vertical', landscape: 'horizontal', square: 'all' };

        const params = new URLSearchParams({
            key: apiKey,
            q: query,
            video_type: 'film',
            per_page: '20',
            orientation: typeMap[orientation] || 'all'
        });

        const res = await fetch(`${PIXABAY_BASE}?${params}`);
        if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`);
        const data = await res.json();

        if (!data.hits || data.hits.length === 0) return null;

        let hits = data.hits;
        if (minDuration) {
            hits = hits.filter(h => h.duration >= minDuration);
        }
        if (hits.length === 0) hits = data.hits;

        // Pick a random usable video from the results to prevent repeating scenes
        const hit = hits[Math.floor(Math.random() * hits.length)];
        // Prefer medium or large video
        const videoData = hit.videos.medium || hit.videos.large || hit.videos.small;

        return {
            url: videoData.url,
            duration: hit.duration,
            width: videoData.width,
            height: videoData.height
        };
    },

    /**
     * Search for background music
     * Primary: Deezer (30s high quality previews)
     * Fallback: Pixabay (Ambient videos)
     * @param {string} query - Music genre or mood keyword
     * @returns {Promise<{url: string, duration: number, provider: string, title?: string, artist?: string}>}
     */
    async searchMusic(query) {
        try {
            return await this.searchDeezer(query);
        } catch (e) {
            console.warn(`[Stock] Deezer search failed: ${e.message}, falling back to Pixabay`);
            return await this.searchPixabayMusic(query);
        }
    },

    /**
     * Internal: Search Deezer for music tracks (prodives 30s previews)
     */
    async searchDeezer(query) {
        console.log(`[Stock] Deezer search: "${query}"`);
        const res = await fetch(`https://api.deezer.com/search/track?q=${encodeURIComponent(query)}&limit=15`);
        if (!res.ok) throw new Error(`Deezer API HTTP ${res.status}`);
        const data = await res.json();

        if (!data.data || data.data.length === 0) {
            throw new Error(`No tracks found on Deezer for "${query}"`);
        }

        const track = data.data[Math.floor(Math.random() * data.data.length)];

        return {
            url: track.preview,
            duration: 30, // Deezer previews are always 30s
            provider: 'deezer',
            title: track.title,
            artist: track.artist?.name || 'Unknown Artist'
        };
    },

    /**
     * Internal: Search Pixabay for music (legacy/fallback)
     */
    async searchPixabayMusic(query) {
        const apiKey = process.env.PIXABAY_API_KEY;
        if (!apiKey) throw new Error('PIXABAY_API_KEY not configured');

        const musicQuery = `${query} background abstract`;
        const params = new URLSearchParams({
            key: apiKey,
            q: musicQuery,
            video_type: 'film',
            per_page: '15',
        });

        console.log(`[Stock] Pixabay fallback search: "${musicQuery}"`);
        const res = await fetch(`${PIXABAY_BASE}?${params}`);
        if (!res.ok) throw new Error(`Pixabay HTTP ${res.status}`);
        const data = await res.json();

        if (!data.hits || data.hits.length === 0) throw new Error(`No music on Pixabay for "${query}"`);

        const hits = data.hits.filter(h => h.duration >= 10 && h.duration <= 120);
        const hit = (hits.length > 0 ? hits : data.hits)[Math.floor(Math.random() * (hits.length || data.hits.length))];
        const videoData = hit.videos.medium || hit.videos.large || hit.videos.small;

        return {
            url: videoData.url,
            duration: hit.duration,
            provider: 'pixabay'
        };
    }
};
