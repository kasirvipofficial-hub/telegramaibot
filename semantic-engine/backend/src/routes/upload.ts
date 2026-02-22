import { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { uploadFile } from "../services/r2";
import { getSupabase } from "../services/supabase";
import { createLogger } from "../utils/logger";

const log = createLogger("route:upload");

/**
 * Map MIME type to a file-type folder category.
 */
function mimeToCategory(mimeType: string): string {
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("image/")) return "image";
    if (
        mimeType === "application/pdf" ||
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml" ||
        mimeType === "application/markdown"
    ) return "document";
    return "other";
}

/**
 * Ensure a file-type folder exists for the user + category.
 * Returns the folder ID.
 */
async function ensureFileTypeFolder(
    userId: number,
    category: string
): Promise<string> {
    const supabase = getSupabase();

    // Try to find existing
    const { data: existing } = await supabase
        .from("folders")
        .select("id")
        .eq("user_id", userId)
        .eq("type", "file_type")
        .eq("category", category)
        .single();

    if (existing) return existing.id;

    // Create new
    const { data: created, error } = await supabase
        .from("folders")
        .insert({
            user_id: userId,
            name: category.charAt(0).toUpperCase() + category.slice(1),
            type: "file_type",
            category,
        })
        .select("id")
        .single();

    if (error) throw new Error(`Failed to create folder: ${error.message}`);
    return created.id;
}

/**
 * POST /upload
 *
 * Accepts a multipart file upload.
 *
 * Required fields:
 *   - file (multipart)
 *   - user_id (form field — Telegram user ID)
 *
 * Optional fields:
 *   - folder_id (form field — explicit job folder placement)
 *
 * Steps:
 * 1. Read file + form fields
 * 2. Ensure user exists
 * 3. Resolve folder (explicit job folder OR auto file-type folder)
 * 4. Upload to R2 with user-scoped key
 * 5. Insert into Supabase
 * 6. Return file info
 */
export async function uploadRoute(app: FastifyInstance): Promise<void> {
    app.post("/upload", async (request, reply) => {
        try {
            // ── 1. Read file and fields ───────────────────────────
            const parts = request.parts();
            let fileBuffer: Buffer | null = null;
            let originalName = "";
            let mimeType = "";
            let userId: number | null = null;
            let folderId: string | null = null;

            for await (const part of parts) {
                if (part.type === "file") {
                    fileBuffer = await part.toBuffer();
                    originalName = part.filename;
                    mimeType = part.mimetype;
                } else {
                    // form field
                    const value = part.value as string;
                    if (part.fieldname === "user_id") userId = parseInt(value, 10);
                    if (part.fieldname === "folder_id") folderId = value;
                }
            }

            if (!fileBuffer || !originalName) {
                return reply.status(400).send({ error: "No file provided" });
            }
            if (!userId) {
                return reply.status(400).send({ error: "Missing 'user_id' field" });
            }

            const fileSize = fileBuffer.length;

            // ── 2. Ensure user exists ─────────────────────────────
            const supabase = getSupabase();
            await supabase.from("users").upsert(
                { id: userId },
                { onConflict: "id" }
            );

            // ── 3. Resolve folder ─────────────────────────────────
            if (!folderId) {
                // Auto-assign to file-type folder
                const category = mimeToCategory(mimeType);
                folderId = await ensureFileTypeFolder(userId, category);
            }

            // ── 4. Upload to R2 (user-scoped path) ────────────────
            const fileId = uuidv4();
            const extension = originalName.split(".").pop() || "bin";
            const storageKey = `users/${userId}/${folderId}/${fileId}.${extension}`;

            await uploadFile(fileBuffer, storageKey, mimeType);

            // ── 5. Insert file record ─────────────────────────────
            const { error: dbError } = await supabase.from("files").insert({
                id: fileId,
                user_id: userId,
                folder_id: folderId,
                name: originalName,
                storage_key: storageKey,
                type: mimeType,
                size: fileSize,
                status: "pending",
            });

            if (dbError) {
                log.error("Failed to insert file record", { error: dbError.message });
                return reply.status(500).send({ error: "Database insert failed" });
            }

            log.info("File uploaded", { fileId, userId, folderId, originalName });

            // ── 6. Return ─────────────────────────────────────────
            return reply.status(201).send({
                id: fileId,
                user_id: userId,
                folder_id: folderId,
                name: originalName,
                storage_key: storageKey,
                status: "pending",
            });
        } catch (err) {
            log.error("Upload failed", { error: String(err) });
            return reply.status(500).send({ error: "Upload failed" });
        }
    });

    /**
     * POST /upload/remote
     * 
     * Registers an external file (e.g., from youtube-engine) that is 
     * already stored in R2, bypassing the actual file buffer upload.
     */
    app.post<{
        Body: { name: string; storage_key: string; user_id: number; type?: string; folder_id?: string }
    }>("/upload/remote", async (request, reply) => {
        try {
            let { name, storage_key, user_id, type = "video/mp4", folder_id } = request.body;

            if (!name || !storage_key || !user_id) {
                return reply.status(400).send({ error: "Missing required fields" });
            }

            const supabase = getSupabase();

            // 1. Ensure user exists
            await supabase.from("users").upsert(
                { id: user_id },
                { onConflict: "id" }
            );

            // 2. Resolve folder
            if (!folder_id) {
                const category = mimeToCategory(type);
                folder_id = await ensureFileTypeFolder(user_id, category);
            }

            // 3. Insert file record
            const fileId = uuidv4();
            const { error: dbError } = await supabase.from("files").insert({
                id: fileId,
                user_id: user_id,
                folder_id: folder_id,
                name: name,
                storage_key: storage_key,
                type: type,
                status: "pending",
            });

            if (dbError) {
                log.error("Failed to insert remote file record", { error: dbError.message });
                return reply.status(500).send({ error: "Database insert failed" });
            }

            log.info("Remote file registered", { fileId, user_id, folderId: folder_id, name });

            return reply.status(201).send({
                id: fileId,
                user_id: user_id,
                folder_id: folder_id,
                name: name,
                storage_key: storage_key,
                status: "pending",
            });

        } catch (err) {
            log.error("Remote upload failed", { error: String(err) });
            return reply.status(500).send({ error: "Remote upload failed" });
        }
    });
}
