
/**
 * SRT Parser & Converter
 * Parses .srt files and converts them to our internal subtitle format.
 */

export default {
    /**
     * Parse SRT text content into subtitle array
     * @param {string} srtContent - Raw SRT file content
     * @returns {Array<{start: number, end: number, text: string}>}
     */
    parse(srtContent) {
        const entries = [];
        // Normalize line endings and split by double newline
        const blocks = srtContent
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '\n')
            .trim()
            .split(/\n\n+/);

        for (const block of blocks) {
            const lines = block.trim().split('\n');
            if (lines.length < 2) continue;

            // Find the timestamp line (contains -->)
            const tsLineIdx = lines.findIndex(l => l.includes('-->'));
            if (tsLineIdx === -1) continue;

            const tsLine = lines[tsLineIdx];
            const match = tsLine.match(
                /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
            );
            if (!match) continue;

            const start = this.toSeconds(match[1], match[2], match[3], match[4]);
            const end = this.toSeconds(match[5], match[6], match[7], match[8]);

            // Text is everything after the timestamp line
            const text = lines.slice(tsLineIdx + 1).join('\n').trim();
            if (text) {
                entries.push({ start, end, text });
            }
        }

        return entries;
    },

    /**
     * Convert timestamp parts to seconds
     */
    toSeconds(h, m, s, ms) {
        return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
    },

    /**
     * Convert subtitles array back to SRT format
     * @param {Array<{start: number, end: number, text: string}>} subtitles
     * @returns {string}
     */
    toSrt(subtitles) {
        return subtitles.map((sub, i) => {
            return `${i + 1}\n${this.formatTimestamp(sub.start)} --> ${this.formatTimestamp(sub.end)}\n${sub.text}`;
        }).join('\n\n');
    },

    formatTimestamp(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.floor((seconds % 1) * 1000);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
    }
};
