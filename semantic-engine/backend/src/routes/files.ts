import { FastifyInstance } from "fastify";
import { getSupabase } from "../services/supabase";
import { deleteFile as deleteR2File } from "../services/r2";
import { deleteVectorsByFileId } from "../services/qdrant";
import { createLogger } from "../utils/logger";

const log = createLogger("route:files");

/**
 * File management routes (all user-scoped via query params):
 *
 * GET    /files?user_id=&folder_id= — list files
 * GET    /files/:id                 — single file with chunks
 * DELETE /files/:id                 — delete file + R2 + Qdrant
 */
export async function filesRoute(app: FastifyInstance): Promise<void> {

    // ── GET /files ─────────────────────────────────────────────
    app.get<{
        Querystring: { user_id?: string; folder_id?: string };
    }>("/files", async (request, reply) => {
        try {
            const { user_id, folder_id } = request.query;

            if (!user_id) {
                return reply.status(400).send({ error: "Missing 'user_id' query parameter" });
            }

            const supabase = getSupabase();
            let query = supabase
                .from("files")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", { ascending: false });

            if (folder_id) {
                query = query.eq("folder_id", folder_id);
            }

            const { data, error } = await query;

            if (error) {
                log.error("Failed to list files", { error: error.message });
                return reply.status(500).send({ error: "Failed to list files" });
            }

            return reply.send({ files: data });
        } catch (err) {
            log.error("List files failed", { error: String(err) });
            return reply.status(500).send({ error: "Internal error" });
        }
    });

    // ── GET /files/:id ────────────────────────────────────────
    app.get<{ Params: { id: string } }>("/files/:id", async (request, reply) => {
        try {
            const { id } = request.params;
            const supabase = getSupabase();

            const { data: file, error: fileError } = await supabase
                .from("files")
                .select("*")
                .eq("id", id)
                .single();

            if (fileError || !file) {
                return reply.status(404).send({ error: "File not found" });
            }

            const { data: chunks, error: chunksError } = await supabase
                .from("chunks")
                .select("*")
                .eq("file_id", id)
                .order("start_time", { ascending: true });

            if (chunksError) {
                log.error("Failed to fetch chunks", { error: chunksError.message });
                return reply.status(500).send({ error: "Failed to fetch chunks" });
            }

            return reply.send({ file, chunks: chunks || [] });
        } catch (err) {
            log.error("Get file failed", { error: String(err) });
            return reply.status(500).send({ error: "Internal error" });
        }
    });

    // ── DELETE /files/:id ─────────────────────────────────────
    app.delete<{ Params: { id: string } }>("/files/:id", async (request, reply) => {
        try {
            const { id } = request.params;
            const supabase = getSupabase();

            const { data: file, error: fetchError } = await supabase
                .from("files")
                .select("id, storage_key")
                .eq("id", id)
                .single();

            if (fetchError || !file) {
                return reply.status(404).send({ error: "File not found" });
            }

            try { await deleteVectorsByFileId(id); } catch (_) { /* best effort */ }
            try { await deleteR2File(file.storage_key); } catch (_) { /* best effort */ }

            const { error: deleteError } = await supabase
                .from("files")
                .delete()
                .eq("id", id);

            if (deleteError) {
                log.error("Failed to delete file", { error: deleteError.message });
                return reply.status(500).send({ error: "Database delete failed" });
            }

            log.info("File deleted", { id });
            return reply.send({ success: true, id });
        } catch (err) {
            log.error("Delete file failed", { error: String(err) });
            return reply.status(500).send({ error: "Internal error" });
        }
    });
}
