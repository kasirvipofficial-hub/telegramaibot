import axios from "axios";
import { env } from "../config/env";
import { createLogger } from "../utils/logger";

const log = createLogger("embedding");

/**
 * OpenAI-compatible embedding API response shape.
 */
interface EmbeddingResponse {
    data: Array<{
        embedding: number[];
        index: number;
    }>;
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}

/**
 * Generate an embedding vector for the given text
 * using the Sumopod OpenAI-compatible embeddings API.
 *
 * API contract (OpenAI format):
 *   POST <EMBEDDING_API_URL>
 *   Headers: Authorization: Bearer <key>
 *   Body: { "input": "...", "model": "text-embedding-3-small" }
 *   Response: { "data": [{ "embedding": number[] }] }
 *
 * @param text - The text to embed
 * @returns Embedding vector (1536 floats for text-embedding-3-small)
 */
export async function getEmbedding(text: string): Promise<number[]> {
    log.debug("Generating embedding", { textLength: text.length });

    try {
        const response = await axios.post<EmbeddingResponse>(
            env.EMBEDDING_API_URL,
            {
                input: text,
                model: env.EMBEDDING_MODEL,
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${env.EMBEDDING_API_KEY}`,
                },
                timeout: 30_000,
            }
        );

        const vector = response.data?.data?.[0]?.embedding;

        if (!Array.isArray(vector) || vector.length === 0) {
            throw new Error("Embedding API returned invalid vector");
        }

        log.debug("Embedding generated", { dimensions: vector.length });
        return vector;
    } catch (err) {
        log.error("Embedding API call failed", { error: String(err) });
        throw err;
    }
}
