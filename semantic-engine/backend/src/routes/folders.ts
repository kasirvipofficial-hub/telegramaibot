import { FastifyInstance } from "fastify";
import { getSupabase } from "../services/supabase";
import { deleteFile as deleteR2File } from "../services/r2";
import { deleteVectorsByFileId } from "../services/qdrant";
import { createLogger } from "../utils/logger";

const log = createLogger("route:folders");

/**
 * Folder management routes:
 *
 * GET    /folders?user_id=   — list user's folders
 * POST   /folders            — create a job folder
 * GET    /folders/:id        — folder detail with files
 * DELETE /folders/:id        — delete folder + cascade files + R2 + Qdrant
 */
export async function foldersRoute(app: FastifyInstance): Promise<void> {

    // ── GET /folders ─────────────────────────────────────────
    app.get<{
        Querystring: { user_id: string };
    }>("/folders", async (request, reply) => {
        try {
            const userId = request.query.user_id;
            if (!userId) {
                return reply.status(400).send({ error: "Missing 'user_id' query parameter" });
            }

            const supabase = getSupabase();
            const { data, error } = await supabase
                .from("folders")
                .select("*, files(count)")
                .eq("user_id", userId)
                .order("created_at", { ascending: false });

            if (error) {
                log.error("Failed to list folders", { error: error.message });
                return reply.status(500).send({ error: "Failed to list folders" });
            }

            return reply.send({ folders: data });
        } catch (err) {
            log.error("List folders failed", { error: String(err) });
            return reply.status(500).send({ error: "Internal error" });
        }
    });

    // ── POST /folders ────────────────────────────────────────
    app.post<{
        Body: { user_id: number; name: string };
    }>("/folders", async (request, reply) => {
        try {
            const { user_id, name } = request.body;

            if (!user_id || !name) {
                return reply.status(400).send({ error: "Missing 'user_id' or 'name'" });
            }

            const supabase = getSupabase();

            // Ensure user exists
            await supabase.from("users").upsert(
                { id: user_id },
                { onConflict: "id" }
            );

            // Create job folder
            const { data, error } = await supabase
                .from("folders")
                .insert({
                    user_id,
                    name,
                    type: "job",
                })
                .select()
                .single();

            if (error) {
                log.error("Failed to create folder", { error: error.message });
                return reply.status(500).send({ error: "Failed to create folder" });
            }

            log.info("Job folder created", { folderId: data.id, userId: user_id, name });
            return reply.status(201).send({ folder: data });
        } catch (err) {
            log.error("Create folder failed", { error: String(err) });
            return reply.status(500).send({ error: "Internal error" });
        }
    });

    // ── GET /folders/:id ─────────────────────────────────────
    app.get<{ Params: { id: string } }>("/folders/:id", async (request, reply) => {
        try {
            const { id } = request.params;
            const supabase = getSupabase();

            const { data: folder, error: folderError } = await supabase
                .from("folders")
                .select("*")
                .eq("id", id)
                .single();

            if (folderError || !folder) {
                return reply.status(404).send({ error: "Folder not found" });
            }

            const { data: files, error: filesError } = await supabase
                .from("files")
                .select("*")
                .eq("folder_id", id)
                .order("created_at", { ascending: false });

            if (filesError) {
                log.error("Failed to fetch folder files", { error: filesError.message });
                return reply.status(500).send({ error: "Failed to fetch files" });
            }

            return reply.send({ folder, files: files || [] });
        } catch (err) {
            log.error("Get folder failed", { error: String(err) });
            return reply.status(500).send({ error: "Internal error" });
        }
    });

    // ── DELETE /folders/:id ──────────────────────────────────
    app.delete<{ Params: { id: string } }>("/folders/:id", async (request, reply) => {
        try {
            const { id } = request.params;
            const supabase = getSupabase();

            // 1. Get all files in this folder
            const { data: files, error: filesError } = await supabase
                .from("files")
                .select("id, storage_key")
                .eq("folder_id", id);

            if (filesError) {
                log.error("Failed to fetch folder files", { error: filesError.message });
                return reply.status(500).send({ error: "Failed to fetch files" });
            }

            // 2. Clean up each file's vectors and R2 objects
            for (const file of files || []) {
                try { await deleteVectorsByFileId(file.id); } catch (_) { /* best effort */ }
                try { await deleteR2File(file.storage_key); } catch (_) { /* best effort */ }
            }

            // 3. Delete the folder (cascade deletes files → cascade deletes chunks)
            const { error: deleteError } = await supabase
                .from("files")
                .delete()
                .eq("folder_id", id);

            if (deleteError) {
                log.error("Failed to delete folder files", { error: deleteError.message });
            }

            const { error: folderDeleteError } = await supabase
                .from("folders")
                .delete()
                .eq("id", id);

            if (folderDeleteError) {
                log.error("Failed to delete folder", { error: folderDeleteError.message });
                return reply.status(500).send({ error: "Failed to delete folder" });
            }

            log.info("Folder deleted", { id, filesDeleted: (files || []).length });
            return reply.send({ success: true, id });
        } catch (err) {
            log.error("Delete folder failed", { error: String(err) });
            return reply.status(500).send({ error: "Internal error" });
        }
    });
}
