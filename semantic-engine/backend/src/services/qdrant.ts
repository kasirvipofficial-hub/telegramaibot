import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../config/env";
import { createLogger } from "../utils/logger";

const log = createLogger("qdrant");

/**
 * Qdrant client — connects to the managed Qdrant instance.
 */
const client = new QdrantClient({
    url: env.QDRANT_URL,
    ...(env.QDRANT_API_KEY ? { apiKey: env.QDRANT_API_KEY } : {}),
});

const COLLECTION = env.QDRANT_COLLECTION;
const VECTOR_SIZE = 1536;

/**
 * Ensure the target collection exists.
 * Called once at startup — safe to call multiple times.
 */
export async function ensureCollection(): Promise<void> {
    try {
        const collections = await client.getCollections();
        const exists = collections.collections.some((c) => c.name === COLLECTION);

        if (!exists) {
            log.info("Creating Qdrant collection", { collection: COLLECTION, vectorSize: VECTOR_SIZE });

            await client.createCollection(COLLECTION, {
                vectors: {
                    size: VECTOR_SIZE,
                    distance: "Cosine",
                },
            });

            log.info("Collection created", { collection: COLLECTION });
        } else {
            log.info("Qdrant collection already exists", { collection: COLLECTION });
        }

        // Ensure payload indexes exist for filtered search
        try {
            await client.createPayloadIndex(COLLECTION, {
                field_name: "user_id",
                field_schema: "integer",
            });
            await client.createPayloadIndex(COLLECTION, {
                field_name: "folder_id",
                field_schema: "keyword",
            });
            await client.createPayloadIndex(COLLECTION, {
                field_name: "file_id",
                field_schema: "keyword",
            });
            log.info("Payload indexes ensured");
        } catch {
            // Indexes may already exist — safe to ignore
        }
    } catch (err) {
        log.error("Failed to ensure Qdrant collection", { error: String(err) });
        throw err;
    }
}

/**
 * Upsert a single vector with its associated payload.
 *
 * @param id       - Unique point ID (UUID string)
 * @param vector   - Embedding vector (1536 floats)
 * @param payload  - Metadata stored alongside the vector
 */
export async function upsertVector(
    id: string,
    vector: number[],
    payload: Record<string, unknown>
): Promise<void> {
    await client.upsert(COLLECTION, {
        wait: true,
        points: [
            {
                id,
                vector,
                payload,
            },
        ],
    });
}

/**
 * Optional filter to scope vector searches by user and/or folder.
 */
export interface SearchFilter {
    user_id?: number;
    folder_id?: string;
}

/**
 * Semantic search: find the closest vectors to a query embedding.
 *
 * @param vector - Query embedding
 * @param limit  - Max results to return
 * @param filter - Optional user/folder scoping
 * @returns Array of scored points with payloads
 */
export async function searchVector(
    vector: number[],
    limit: number = 20,
    filter?: SearchFilter
): Promise<
    Array<{
        id: string | number;
        score: number;
        payload?: Record<string, unknown> | null;
    }>
> {
    // Build Qdrant filter conditions
    const mustConditions: Array<Record<string, unknown>> = [];

    if (filter?.user_id) {
        mustConditions.push({
            key: "user_id",
            match: { value: filter.user_id },
        });
    }
    if (filter?.folder_id) {
        mustConditions.push({
            key: "folder_id",
            match: { value: filter.folder_id },
        });
    }

    const queryParams: Record<string, unknown> = {
        query: vector,
        limit,
        with_payload: true,
    };

    if (mustConditions.length > 0) {
        queryParams.filter = { must: mustConditions };
    }

    const results = await client.query(COLLECTION, queryParams);

    return (results.points || []).map((r: { id: string | number; score: number; payload?: Record<string, unknown> | null }) => ({
        id: r.id,
        score: r.score,
        payload: r.payload as Record<string, unknown> | null,
    }));
}

/**
 * Delete all vectors belonging to a specific file.
 *
 * @param fileId - The file UUID whose vectors should be removed
 */
export async function deleteVectorsByFileId(fileId: string): Promise<void> {
    log.info("Deleting vectors for file", { fileId });

    await client.delete(COLLECTION, {
        wait: true,
        filter: {
            must: [
                {
                    key: "file_id",
                    match: { value: fileId },
                },
            ],
        },
    });

    log.info("Vectors deleted", { fileId });
}
