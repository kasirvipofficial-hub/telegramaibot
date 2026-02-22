import { v4 as uuidv4 } from "uuid";
import { getSupabase } from "../services/supabase";
import { getPublicUrl } from "../services/r2";
import { extractChunks, SemanticChunk } from "../services/multimodal";
import { extractFromPdf, extractFromText, getExtractionStrategy } from "../services/extractor";
import { getEmbedding } from "../services/embedding";
import { upsertVector } from "../services/qdrant";
import { createLogger } from "../utils/logger";

const log = createLogger("worker");

/** Polling interval in milliseconds */
const POLL_INTERVAL_MS = 5_000;

/**
 * Route extraction based on file type.
 *
 * - PDF        → direct text extraction (pdf-parse)
 * - TXT / MD   → direct text extraction (download + chunk)
 * - Video / Audio / Image → multimodal AI (Sumopod chat completions)
 */
async function extractByStrategy(
    fileUrl: string,
    mimeType: string | null
): Promise<SemanticChunk[]> {
    const strategy = getExtractionStrategy(mimeType);

    log.info("Extraction strategy selected", { strategy, mimeType });

    switch (strategy) {
        case "pdf":
            return extractFromPdf(fileUrl);
        case "text":
            return extractFromText(fileUrl);
        case "multimodal":
            return extractChunks(fileUrl, mimeType || undefined);
    }
}

/**
 * Process a single pending file through the full pipeline:
 *
 * 1. Set status → 'processing'
 * 2. Build public URL from R2
 * 3. Determine extraction strategy (direct text vs multimodal AI)
 * 4. Extract semantic chunks
 * 5. For each chunk: embed → upsert in Qdrant → insert in Supabase
 * 6. Set status → 'indexed'
 *
 * On failure the status is set to 'failed' and the error is logged.
 */
async function processFile(file: {
    id: string;
    storage_key: string;
    name: string;
    type: string | null;
    user_id: number | null;
    folder_id: string | null;
}): Promise<void> {
    const supabase = getSupabase();

    try {
        log.info("Processing file", { fileId: file.id, name: file.name, type: file.type });

        // ── Mark as processing ───────────────────────────────────
        await supabase.from("files").update({ status: "processing" }).eq("id", file.id);

        // ── Get the public URL for the stored file ───────────────
        const fileUrl = getPublicUrl(file.storage_key);

        // ── Extract chunks using the appropriate strategy ─────────
        const chunks = await extractByStrategy(fileUrl, file.type);
        log.info("Chunks received", { fileId: file.id, chunkCount: chunks.length });

        if (chunks.length === 0) {
            log.warn("No chunks extracted — marking as indexed anyway", { fileId: file.id });
            await supabase.from("files").update({ status: "indexed" }).eq("id", file.id);
            return;
        }

        // ── Process each chunk ───────────────────────────────────
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const chunkId = uuidv4();

            // Generate embedding for the chunk text
            const vector = await getEmbedding(chunk.text);

            // Upsert vector into Qdrant with metadata payload
            await upsertVector(chunkId, vector, {
                file_id: file.id,
                file_name: file.name,
                user_id: file.user_id,
                folder_id: file.folder_id,
                text: chunk.text,
                start_time: chunk.start ?? null,
                end_time: chunk.end ?? null,
                page: chunk.page ?? null,
                confidence: chunk.confidence ?? 1.0,
            });

            // Store chunk metadata in Supabase
            const { error: insertError } = await supabase.from("chunks").insert({
                id: chunkId,
                file_id: file.id,
                vector_id: chunkId,
                text: chunk.text,
                start_time: chunk.start ?? null,
                end_time: chunk.end ?? null,
                page: chunk.page ?? null,
                confidence: chunk.confidence ?? 1.0,
            });

            if (insertError) {
                log.warn("Failed to insert chunk into Supabase", {
                    chunkIndex: i,
                    error: insertError.message,
                });
            }

            log.debug("Chunk processed", { fileId: file.id, chunkIndex: i, chunkId });
        }

        // ── Mark as indexed ──────────────────────────────────────
        await supabase.from("files").update({ status: "indexed" }).eq("id", file.id);
        log.info("File indexed successfully", { fileId: file.id, totalChunks: chunks.length });
    } catch (err) {
        log.error("File processing failed", { fileId: file.id, error: String(err) });

        // Mark as failed so it won't be retried automatically
        try {
            await supabase.from("files").update({ status: "failed" }).eq("id", file.id);
        } catch (updateErr: unknown) {
            log.error("Failed to update status to 'failed'", { error: String(updateErr) });
        }
    }
}

/**
 * Single poll cycle:
 * - Fetch all files with status = 'pending'
 * - Process each one sequentially (to avoid overloading external APIs)
 */
async function pollOnce(): Promise<void> {
    const supabase = getSupabase();

    const { data: pendingFiles, error } = await supabase
        .from("files")
        .select("id, storage_key, name, type, user_id, folder_id")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

    if (error) {
        log.error("Failed to poll pending files", { error: error.message });
        return;
    }

    if (!pendingFiles || pendingFiles.length === 0) {
        return; // Nothing to do
    }

    log.info("Found pending files", { count: pendingFiles.length });

    for (const file of pendingFiles) {
        await processFile(file);
    }
}

/**
 * Start the background worker loop.
 * Polls every POLL_INTERVAL_MS for new files to process.
 * Never throws — errors are caught and logged per cycle.
 */
export function startWorker(): void {
    log.info("Worker started", { intervalMs: POLL_INTERVAL_MS });

    const tick = async () => {
        try {
            await pollOnce();
        } catch (err) {
            log.error("Worker tick error", { error: String(err) });
        }
    };

    // Run immediately, then schedule
    tick();
    setInterval(tick, POLL_INTERVAL_MS);
}
