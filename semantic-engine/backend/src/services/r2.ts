import {
    S3Client,
    PutObjectCommand,
    DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { env } from "../config/env";
import { createLogger } from "../utils/logger";

const log = createLogger("r2");

/**
 * S3-compatible client configured for Cloudflare R2.
 */
const s3 = new S3Client({
    region: "auto",
    endpoint: env.R2_ENDPOINT,
    credentials: {
        accessKeyId: env.R2_ACCESS_KEY,
        secretAccessKey: env.R2_SECRET_KEY,
    },
});

/**
 * Upload a file buffer to R2.
 *
 * @param buffer   - Raw file bytes
 * @param key      - Object key (path inside the bucket)
 * @param contentType - MIME type
 */
export async function uploadFile(
    buffer: Buffer,
    key: string,
    contentType: string
): Promise<void> {
    log.info("Uploading file to R2", { key, contentType, size: buffer.length });

    await s3.send(
        new PutObjectCommand({
            Bucket: env.R2_BUCKET,
            Key: key,
            Body: buffer,
            ContentType: contentType,
        })
    );

    log.info("Upload complete", { key });
}

/**
 * Build the public URL for a stored object.
 */
export function getPublicUrl(key: string): string {
    // Remove trailing slash from base URL if present
    const base = env.R2_PUBLIC_URL.replace(/\/+$/, "");
    return `${base}/${key}`;
}

/**
 * Delete an object from R2.
 */
export async function deleteFile(key: string): Promise<void> {
    log.info("Deleting file from R2", { key });

    await s3.send(
        new DeleteObjectCommand({
            Bucket: env.R2_BUCKET,
            Key: key,
        })
    );

    log.info("Delete complete", { key });
}
