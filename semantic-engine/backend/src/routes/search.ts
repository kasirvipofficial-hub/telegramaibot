import { FastifyInstance } from "fastify";
import { getEmbedding } from "../services/embedding";
import { searchVector, SearchFilter } from "../services/qdrant";
import { getSupabase } from "../services/supabase";
import { createLogger } from "../utils/logger";

const log = createLogger("route:search");

/**
 * Shape of a single search result returned to the client.
 */
interface SearchResult {
    file_id: string;
    file_name: string;
    storage_key: string;
    text: string;
    start_time: number | null;
    end_time: number | null;
    page: number | null;
    score: number;
    folder_id: string | null;
}

/**
 * POST /search
 *
 * Body: {
 *   "query": "...",
 *   "user_id": 123456789,
 *   "folder_id": "optional-uuid",
 *   "limit": 20
 * }
 *
 * 1. Generate an embedding from the query text
 * 2. Search Qdrant filtered by user_id (and optionally folder_id)
 * 3. Enrich results with file metadata from Supabase
 * 4. Return ranked results with timestamps / page numbers
 */
export async function searchRoute(app: FastifyInstance): Promise<void> {
    app.post<{
        Body: { query: string; user_id: number; folder_id?: string; limit?: number };
    }>("/search", async (request, reply) => {
        try {
            const { query, user_id, folder_id, limit = 20 } = request.body;

            if (!query || typeof query !== "string") {
                return reply.status(400).send({ error: "Missing or invalid 'query'" });
            }
            if (!user_id) {
                return reply.status(400).send({ error: "Missing 'user_id'" });
            }

            // ── 1. Generate query embedding ────────────────────────
            log.info("Searching", { userId: user_id, queryLength: query.length });
            const vector = await getEmbedding(query);

            // ── 2. Search Qdrant (user-scoped) ─────────────────────
            const filter: SearchFilter = { user_id };
            if (folder_id) filter.folder_id = folder_id;

            const qdrantResults = await searchVector(vector, limit, filter);

            if (qdrantResults.length === 0) {
                return reply.send({ results: [] });
            }

            // ── 3. Collect unique file IDs for metadata lookup ─────
            const fileIds = [
                ...new Set(
                    qdrantResults
                        .map((r) => (r.payload as Record<string, unknown>)?.file_id as string)
                        .filter(Boolean)
                ),
            ];

            const supabase = getSupabase();
            const { data: files, error: dbError } = await supabase
                .from("files")
                .select("id, name, storage_key, folder_id")
                .in("id", fileIds);

            if (dbError) {
                log.error("Failed to fetch file metadata", { error: dbError.message });
                return reply.status(500).send({ error: "Metadata lookup failed" });
            }

            const fileMap = new Map(
                (files || []).map((f) => [
                    f.id,
                    { name: f.name, storage_key: f.storage_key, folder_id: f.folder_id },
                ])
            );

            // ── 4. Assemble enriched results ───────────────────────
            const results: SearchResult[] = qdrantResults.map((r) => {
                const payload = (r.payload || {}) as Record<string, unknown>;
                const fileId = payload.file_id as string;
                const fileMeta = fileMap.get(fileId);

                return {
                    file_id: fileId,
                    file_name: fileMeta?.name || "unknown",
                    storage_key: fileMeta?.storage_key || "",
                    folder_id: fileMeta?.folder_id || null,
                    text: (payload.text as string) || "",
                    start_time: (payload.start_time as number) ?? null,
                    end_time: (payload.end_time as number) ?? null,
                    page: (payload.page as number) ?? null,
                    score: r.score,
                };
            });

            log.info("Search completed", { userId: user_id, resultCount: results.length });
            return reply.send({ results });
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error("Search failed", { error: errMsg });
            return reply.status(500).send({ error: "Search failed", detail: errMsg });
        }
    });
}
