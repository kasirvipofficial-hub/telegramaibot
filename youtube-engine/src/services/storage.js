import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

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

class StorageService {
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
            console.log('S3 storage service initialized.');
        } else {
            console.warn('S3 credentials not configured. Uploads disabled.');
        }
    }

    async uploadFile(filePath, key) {
        if (!this.client) throw new Error('S3 client not initialized');

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

    async uploadStream(stream, key, contentType = 'video/mp4') {
        if (!this.client) throw new Error('S3 client not initialized');

        try {
            const parallelUploads3 = new Upload({
                client: this.client,
                params: {
                    Bucket: this.bucket,
                    Key: key,
                    Body: stream,
                    ContentType: contentType
                },
                queueSize: 4,
                partSize: 1024 * 1024 * 5,
                leavePartsOnError: false,
            });

            await parallelUploads3.done();

            if (this.publicUrlBase) {
                return `${this.publicUrlBase}/${key}`;
            }
            return key;
        } catch (err) {
            console.error('S3 Stream Upload Error:', err.message);
            throw err;
        }
    }
}

export default new StorageService();
