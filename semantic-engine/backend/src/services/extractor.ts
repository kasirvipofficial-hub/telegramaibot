import axios from "axios";
import { createLogger } from "../utils/logger";
import { chunkText, chunkPages, TextChunk } from "../utils/chunker";
import { SemanticChunk } from "./multimodal";

const log = createLogger("extractor");

/**
 * Direct text extraction for document files (PDF, TXT, Markdown).
 *
 * Unlike the multimodal service, these extractors parse text directly
 * from the file content — no AI call needed. The extracted text is then
 * chunked and returned in the same SemanticChunk format used by the
 * multimodal pipeline, so the worker can process both paths uniformly.
 */

// ── PDF Extraction ──────────────────────────────────────────────

/**
 * Extract text from a PDF file accessed by URL.
 * Downloads the file, parses with pdf-parse, and chunks per page.
 *
 * @param fileUrl - Public URL of the PDF file
 * @returns Array of SemanticChunks with page numbers
 */
export async function extractFromPdf(fileUrl: string): Promise<SemanticChunk[]> {
    log.info("Extracting text from PDF", { fileUrl });

    // Download the PDF as a buffer
    const response = await axios.get(fileUrl, {
        responseType: "arraybuffer",
        timeout: 60_000,
    });
    const buffer = Buffer.from(response.data);

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
    const pdf = await pdfParse(buffer);

    // pdf-parse gives us full text — split by form feed (page breaks) if present
    // Otherwise treat as single page
    const rawPages: string[] = pdf.text.split("\f");

    const pages = rawPages.map((text: string, i: number) => ({
        pageNumber: i + 1,
        text: text.trim(),
    })).filter((p) => p.text.length > 0);

    log.info("PDF parsed", { totalPages: pages.length, totalChars: pdf.text.length });

    const textChunks = chunkPages(pages);
    return mapToSemanticChunks(textChunks);
}

// ── Plain Text / Markdown Extraction ────────────────────────────

/**
 * Extract text from a plain text or markdown file accessed by URL.
 * Downloads the file, reads as UTF-8, and chunks by paragraphs.
 *
 * @param fileUrl - Public URL of the text file
 * @returns Array of SemanticChunks (page = null for plain text)
 */
export async function extractFromText(fileUrl: string): Promise<SemanticChunk[]> {
    log.info("Extracting text from document", { fileUrl });

    const response = await axios.get(fileUrl, {
        responseType: "text",
        timeout: 60_000,
    });
    const text: string = response.data;

    if (!text || text.trim().length === 0) {
        log.warn("Document is empty", { fileUrl });
        return [];
    }

    log.info("Text document loaded", { totalChars: text.length });

    const textChunks = chunkText(text);
    return mapToSemanticChunks(textChunks);
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Convert TextChunks to SemanticChunks for uniform downstream processing.
 */
function mapToSemanticChunks(textChunks: TextChunk[]): SemanticChunk[] {
    return textChunks.map((tc) => ({
        text: tc.text,
        start: null,      // No timestamps for documents
        end: null,
        page: tc.page,
        confidence: 1.0,  // Direct extraction = high confidence
    }));
}

// ── File Type Detection ─────────────────────────────────────────

/**
 * Determine the extraction strategy based on MIME type.
 *
 * Returns:
 * - "pdf"       → use extractFromPdf
 * - "text"      → use extractFromText
 * - "multimodal" → use multimodal AI (video, audio, image)
 */
export function getExtractionStrategy(
    mimeType: string | null
): "pdf" | "text" | "multimodal" {
    if (!mimeType) return "multimodal";

    const mime = mimeType.toLowerCase();

    if (mime === "application/pdf") return "pdf";

    if (
        mime.startsWith("text/") ||
        mime === "application/json" ||
        mime === "application/xml" ||
        mime === "application/markdown"
    ) {
        return "text";
    }

    // Video, audio, image → multimodal AI
    return "multimodal";
}
