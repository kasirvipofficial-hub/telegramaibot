
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';

// MIME type mapping by extension
const MIME_TYPES = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
};

class UploadService {
    constructor() {
        if (process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY) {
            this.client = new S3Client({
                region: process.env.S3_REGION || 'auto',
                endpoint: process.env.S3_ENDPOINT,
                credentials: {
                    accessKeyId: process.env.S3_ACCESS_KEY,
                    secretAccessKey: process.env.S3_SECRET_KEY
                }
            });
            this.bucket = process.env.S3_BUCKET;
            this.publicUrlBase = process.env.S3_PUBLIC_URL;
            console.log('S3 upload service initialized.');
        } else {
            console.warn('S3 credentials not configured. Uploads disabled.');
        }
    }

    async uploadFile(filePath, key) {
        if (!this.client) return null;

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        const fileStream = fs.createReadStream(filePath);

        try {
            await this.client.send(new PutObjectCommand({
                Bucket: this.bucket,
                Key: key,
                Body: fileStream,
                ContentType: contentType
            }));

            if (this.publicUrlBase) {
                return `${this.publicUrlBase}/${key}`;
            }
            return key;
        } catch (err) {
            console.error('S3 Upload Error:', err.message);
            throw err;
        }
    }
}

export default new UploadService();
