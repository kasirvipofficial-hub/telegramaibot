import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import dotenv from 'dotenv';
dotenv.config();

const client = new S3Client({
    region: 'auto',
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY
    }
});

const bucket = process.env.S3_BUCKET;

async function cleanup() {
    console.log(`🧹 Cleaning up bucket: ${bucket}`);
    try {
        const listCmd = new ListObjectsV2Command({ Bucket: bucket });
        const data = await client.send(listCmd);

        if (!data.Contents || data.Contents.length === 0) {
            console.log('✅ Bucket already empty.');
            return;
        }

        const deleteParams = {
            Bucket: bucket,
            Delete: {
                Objects: data.Contents.map(obj => ({ Key: obj.Key }))
            }
        };

        await client.send(new DeleteObjectsCommand(deleteParams));
        console.log(`✅ Deleted ${data.Contents.length} objects.`);
    } catch (err) {
        console.error('❌ Cleanup Error:', err.message);
    }
}

cleanup();
