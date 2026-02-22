import dotenv from "dotenv";

// Load .env file from project root
dotenv.config();

/**
 * Helper: reads an env var or throws if missing.
 */
function required(key: string): string {
    const value = process.env[key];
    if (!value) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
}

/**
 * Helper: reads an env var with a fallback default.
 */
function optional(key: string, fallback: string): string {
    return process.env[key] || fallback;
}

/**
 * Centralised, validated environment configuration.
 * Imported once at startup — every module reads from this object.
 */
export const env = {
    // ── Supabase ────────────────────────────────────────────────
    SUPABASE_URL: required("SUPABASE_URL"),
    SUPABASE_KEY: required("SUPABASE_KEY"),

    // ── Cloudflare R2 (S3-compatible) ──────────────────────────
    R2_ENDPOINT: required("R2_ENDPOINT"),
    R2_ACCESS_KEY: required("R2_ACCESS_KEY"),
    R2_SECRET_KEY: required("R2_SECRET_KEY"),
    R2_BUCKET: required("R2_BUCKET"),
    R2_PUBLIC_URL: required("R2_PUBLIC_URL"),

    // ── Qdrant ─────────────────────────────────────────────────
    QDRANT_URL: required("QDRANT_URL"),
    QDRANT_API_KEY: optional("QDRANT_API_KEY", ""),
    QDRANT_COLLECTION: optional("QDRANT_COLLECTION", "chunks"),

    // ── Embedding API ──────────────────────────────────────────
    EMBEDDING_API_URL: required("EMBEDDING_API_URL"),
    EMBEDDING_API_KEY: optional("EMBEDDING_API_KEY", ""),
    EMBEDDING_MODEL: optional("EMBEDDING_MODEL", "text-embedding-3-small"),

    // ── Multimodal Extraction API ──────────────────────────────
    MULTIMODAL_API_URL: required("MULTIMODAL_API_URL"),
    MULTIMODAL_API_KEY: optional("MULTIMODAL_API_KEY", ""),
    MULTIMODAL_MODEL: optional("MULTIMODAL_MODEL", "seed-2-0-mini-free"),

    // ── Server ─────────────────────────────────────────────────
    PORT: parseInt(optional("PORT", "3000"), 10),
} as const;
