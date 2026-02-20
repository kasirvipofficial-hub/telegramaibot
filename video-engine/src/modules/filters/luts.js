
import path from 'path';
import fs from 'fs/promises';

export default {
    async getFilter(lutName) {
        if (!lutName) return null;

        // 1. Check if built-in/asset exists
        const lutPath = path.resolve('src/assets/luts', `${lutName}.cube`);

        // Check existence (async)
        try {
            await fs.access(lutPath);
            // Escape path for ffmpeg filter definition
            // Windows paths need to be forward slashes. 
            // Colon in drive letter (D:) doesn't strictly need escaping if quoted, 
            // but escaping it (D\:) is safer in complex filters.
            // HOWEVER, simple forward slashes with quotes usually works best across versions.
            // Let's try standard forward slashes without colon escape, but keep quotes.
            const escapedPath = lutPath.replace(/\\/g, '/').replace(/:/g, '\\\\:'); // Double escape backslash for the colon escape? No, just \\:
            // Actually, if we use Replace(/:/g, '\\:'), we get D\:/...
            // Let's try just forward slashes and NO colon escape, relying on quotes.
            // const escapedPath = lutPath.replace(/\\/g, '/');
            // return `lut3d=file='${escapedPath}'`;

            // Try standard forward slashes with quotes, NO COLON ESCAPE.
            // Works best for Windows ffmpeg filters.
            const normalized = lutPath.replace(/\\/g, '/');
            return `lut3d=file='${normalized}'`;
        } catch (e) {
            console.warn(`LUT asset not found: ${lutName} at ${lutPath}`);
            return null;
        }
    }
};
