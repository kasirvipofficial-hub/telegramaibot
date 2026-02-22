import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";

import { env } from "./config/env";
import { ensureCollection } from "./services/qdrant";
import { uploadRoute } from "./routes/upload";
import { searchRoute } from "./routes/search";
import { filesRoute } from "./routes/files";
import { foldersRoute } from "./routes/folders";
import { startWorker } from "./worker/worker";
import { createLogger } from "./utils/logger";

const log = createLogger("server");

async function main(): Promise<void> {
    // ── 1. Create Fastify instance ─────────────────────────────
    const app = Fastify({
        logger: false, // We use our own structured logger
    });

    // ── 2. Register plugins ────────────────────────────────────
    await app.register(cors, { origin: true });
    await app.register(multipart, {
        limits: {
            fileSize: 500 * 1024 * 1024, // 500 MB max upload
        },
    });

    // ── 3. Health check ────────────────────────────────────────
    app.get("/health", async () => ({
        status: "ok",
        timestamp: new Date().toISOString(),
    }));

    // ── 4. Register routes ─────────────────────────────────────
    await uploadRoute(app);
    await searchRoute(app);
    await filesRoute(app);
    await foldersRoute(app);

    // ── 5. Ensure Qdrant collection exists ─────────────────────
    try {
        await ensureCollection();
    } catch (err) {
        log.warn("Qdrant collection setup failed — will retry in worker", {
            error: String(err),
        });
    }

    // ── 6. Start the background worker ─────────────────────────
    startWorker();

    // ── 7. Start listening ─────────────────────────────────────
    try {
        const address = await app.listen({ port: env.PORT, host: "0.0.0.0" });
        log.info("Server running", { address, port: env.PORT });
    } catch (err) {
        log.error("Failed to start server", { error: String(err) });
        process.exit(1);
    }
}

main();
