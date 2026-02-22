/**
 * Text chunker utility.
 *
 * Splits long text into smaller, overlapping chunks suitable for
 * embedding and vector search. Each chunk carries page/position metadata.
 */

export interface TextChunk {
    text: string;
    page: number | null;
    index: number; // chunk index within the document
}

/**
 * Options for the chunking algorithm.
 */
interface ChunkOptions {
    /** Max characters per chunk (default: 1000) */
    maxChunkSize?: number;
    /** Overlap in characters between consecutive chunks (default: 200) */
    overlap?: number;
}

/**
 * Split a single block of text into overlapping chunks.
 *
 * Uses a simple sliding-window approach with paragraph-aware splitting:
 * 1. Split by double-newlines (paragraphs) first
 * 2. Accumulate paragraphs until maxChunkSize is reached
 * 3. Emit chunk and step back by `overlap` characters
 *
 * @param text    - Full document text
 * @param page    - Optional page number (null if not applicable)
 * @param options - Chunking parameters
 * @returns Array of text chunks
 */
export function chunkText(
    text: string,
    page: number | null = null,
    options: ChunkOptions = {}
): TextChunk[] {
    const { maxChunkSize = 1000, overlap = 200 } = options;

    const trimmed = text.trim();
    if (!trimmed) return [];

    // If the text fits in one chunk, return it directly
    if (trimmed.length <= maxChunkSize) {
        return [{ text: trimmed, page, index: 0 }];
    }

    const chunks: TextChunk[] = [];
    let start = 0;
    let index = 0;

    while (start < trimmed.length) {
        let end = Math.min(start + maxChunkSize, trimmed.length);

        // Try to break at a paragraph or sentence boundary
        if (end < trimmed.length) {
            // Look for paragraph break
            const paragraphBreak = trimmed.lastIndexOf("\n\n", end);
            if (paragraphBreak > start + maxChunkSize * 0.3) {
                end = paragraphBreak;
            } else {
                // Fall back to sentence boundary
                const sentenceBreak = trimmed.lastIndexOf(". ", end);
                if (sentenceBreak > start + maxChunkSize * 0.3) {
                    end = sentenceBreak + 1; // Include the period
                }
            }
        }

        const chunkText = trimmed.slice(start, end).trim();
        if (chunkText.length > 0) {
            chunks.push({ text: chunkText, page, index });
            index++;
        }

        // Move start forward, minus overlap
        start = end - overlap;
        if (start <= (chunks.length > 0 ? end - chunkText.length : 0)) {
            start = end; // Prevent infinite loop
        }
    }

    return chunks;
}

/**
 * Split a multi-page document into chunks.
 * Each page is chunked independently, preserving page numbers.
 *
 * @param pages - Array of { pageNumber, text } objects
 * @param options - Chunking parameters
 * @returns Flat array of all chunks across all pages
 */
export function chunkPages(
    pages: Array<{ pageNumber: number; text: string }>,
    options: ChunkOptions = {}
): TextChunk[] {
    const allChunks: TextChunk[] = [];
    let globalIndex = 0;

    for (const page of pages) {
        const pageChunks = chunkText(page.text, page.pageNumber, options);
        for (const chunk of pageChunks) {
            allChunks.push({ ...chunk, index: globalIndex });
            globalIndex++;
        }
    }

    return allChunks;
}
