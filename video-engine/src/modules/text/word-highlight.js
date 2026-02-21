
/**
 * Per-Word Highlight Subtitle Generator (CapCut-style)
 * 
 * Generates ASS subtitles where each word highlights in sequence,
 * synchronized with voice-over word timestamps from Kie.ai.
 */

import TextStyles from './styles.js';

export default {
    /**
     * Generate per-word highlight ASS content
     * 
     * @param {Array} wordTimings - Array of { word, start, end } from Kie.ai timestamps
     * @param {Object} options
     * @param {string} [options.resolution] - Video resolution e.g. "1080x1920"
     * @param {string} [options.highlightColor] - ASS color for highlighted word (e.g. "&H0000FFFF" = yellow)
     * @param {string} [options.normalColor] - ASS color for normal text (e.g. "&H00FFFFFF" = white)
     * @param {string} [options.outlineColor] - Outline color
     * @param {string} [options.fontName] - Font name
     * @param {number} [options.fontSize] - Font size
     * @param {number} [options.wordsPerLine] - Max words per subtitle line (default: 4)
     * @returns {string} ASS file content
     */
    generate(wordTimings, options = {}) {
        const resolution = options.resolution || '1080x1920';
        const [resW, resH] = resolution.split('x');
        const highlightColor = options.highlightColor || '&H0000FFFF'; // Yellow
        const normalColor = options.normalColor || '&H00FFFFFF';       // White
        const outlineColor = options.outlineColor || '&H00000000';     // Black
        const fontName = options.fontName || 'Arial';
        const fontSize = options.fontSize || 72;
        const wordsPerLine = options.wordsPerLine || 4;

        // Group words into lines
        const lines = [];
        for (let i = 0; i < wordTimings.length; i += wordsPerLine) {
            const lineWords = wordTimings.slice(i, i + wordsPerLine);
            lines.push({
                words: lineWords,
                start: lineWords[0].start,
                end: lineWords[lineWords.length - 1].end
            });
        }

        // Build ASS header
        const header = `[Script Info]\r
ScriptType: v4.00+\r
PlayResX: ${resW}\r
PlayResY: ${resH}\r
\r
[V4+ Styles]\r
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\r
Style: Default,${fontName},${fontSize},${normalColor},${normalColor},${outlineColor},&H80000000,1,0,0,0,100,100,2,0,1,4,2,2,40,40,80,1\r
Style: Highlight,${fontName},${fontSize},${highlightColor},${highlightColor},${outlineColor},&H80000000,1,0,0,0,100,100,2,0,1,4,2,2,40,40,80,1\r
\r
[Events]\r
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\r
`;

        // Build per-word highlight events
        const events = [];

        for (const line of lines) {
            // For each word in the line, create a dialogue showing all words
            // with the current word highlighted via override tags
            for (let wi = 0; wi < line.words.length; wi++) {
                const word = line.words[wi];
                const wordStart = word.start;
                const wordEnd = wi < line.words.length - 1 ? line.words[wi + 1].start : word.end;

                // Build text with inline override: current word highlighted, rest normal
                const textParts = line.words.map((w, idx) => {
                    if (idx === wi) {
                        // Highlighted word
                        return `{\\1c${highlightColor}\\b1}${w.word}{\\1c${normalColor}\\b0}`;
                    }
                    return w.word;
                });

                const startTs = this.formatTime(wordStart);
                const endTs = this.formatTime(wordEnd);

                events.push(
                    `Dialogue: 0,${startTs},${endTs},Default,,0,0,0,,${textParts.join(' ')}`
                );
            }
        }

        return '\ufeff' + header + events.join('\r\n');
    },

    /**
     * Generate per-word subtitles from Kie.ai TTS result
     * (combines TTS generation + word timestamp extraction)
     * 
     * @param {Object} kieResult - Raw Kie.ai recordInfo response with resultJson containing timestamps
     * @returns {Array<{word: string, start: number, end: number}>}
     */
    /**
     * Parse Kie.ai timestamps with fallback to estimation
     * 
     * @param {Object} resultJson - { timestamps, text }
     * @returns {Array<{word: string, start: number, end: number}>}
     */
    parseKieTimestamps(resultJson) {
        if (resultJson.timestamps && Array.isArray(resultJson.timestamps) && resultJson.timestamps.length > 0) {
            return resultJson.timestamps.map(ts => ({
                word: ts.word || ts.text,
                start: ts.start_time ?? ts.start ?? 0,
                end: ts.end_time ?? ts.end ?? 0
            }));
        }

        // FALLBACK: Estimate timestamps based on text and duration
        if (!resultJson.text) return [];

        const words = resultJson.text.split(/\s+/).filter(w => w.length > 0);
        if (words.length === 0) return [];

        // Estimate based on 2.2 words per second (average speaking rate)
        const wordDuration = 0.45; // 1/2.2
        return words.map((word, i) => ({
            word: word,
            start: i * wordDuration,
            end: (i + 1) * wordDuration
        }));
    },

    formatTime(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const cc = Math.floor(((seconds % 1) * 100));
        const pad = (num, size) => ('000' + num).slice(size * -1);
        return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cc, 2)}`;
    }
};
