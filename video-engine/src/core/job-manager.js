
import fs from 'fs/promises';
import path from 'path';
import pkg from 'uuid';
const { v4: uuidv4 } = pkg;
import { EventEmitter } from 'events';
import config from '../../config/default.js';
import assemblyEngine from './assembly-engine.js';
import compositionEngine from './composition-engine.js';
import uploadService from '../utils/upload.js';

const MAX_WEBHOOK_RETRIES = 3;
const WEBHOOK_BACKOFF_MS = 2000;

class JobManager extends EventEmitter {
    constructor() {
        super();
        this.jobs = new Map();
        this.activeJobs = 0;
        this.metrics = {
            completed: 0,
            failed: 0,
            total_time_ms: 0
        };
    }

    async init() {
        // Startup: Clean all temp files from previous runs
        try {
            const tempDir = config.paths.temp;
            const entries = await fs.readdir(tempDir);
            let cleaned = 0;
            for (const entry of entries) {
                const fullPath = path.join(tempDir, entry);
                try {
                    await fs.rm(fullPath, { recursive: true, force: true });
                    cleaned++;
                } catch (e) { /* ignore */ }
            }
            if (cleaned > 0) console.log(`🧹 Startup: Cleaned ${cleaned} temp items`);
        } catch (e) { /* temp dir may not exist yet */ }

        // Load persisted jobs from filesystem
        try {
            const files = await fs.readdir(config.paths.jobs);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const content = await fs.readFile(path.join(config.paths.jobs, file), 'utf-8');
                    const job = JSON.parse(content);
                    this.jobs.set(job.id, job);
                    // If a job was 'processing' when server crashed, mark it failed
                    if (job.status === 'processing' || job.status === 'preparing') {
                        job.status = 'failed';
                        job.error = 'Server restart during execution';
                        job.updated_at = new Date().toISOString();
                        await this.persistJob(job);
                    }
                }
            }
            console.log(`Loaded ${this.jobs.size} jobs from storage.`);
        } catch (err) {
            console.warn('Could not load jobs from storage:', err.message);
        }

        // Resume queued jobs from before restart
        this.processQueue();

        // Schedule periodic cleanup (every 15 min)
        this._cleanupInterval = setInterval(() => this.cleanupOldJobs(), 15 * 60 * 1000);
    }

    async createJob(payload) {
        const id = uuidv4();
        const job = {
            id,
            status: 'queued',
            created_at: new Date().toISOString(),
            payload,
            logs: []
        };

        this.jobs.set(id, job);
        await this.persistJob(job);
        this.processQueue();
        return id;
    }

    getJob(id) {
        const job = this.jobs.get(id);
        if (!job) return null;

        // Return a sanitized copy (no stack traces, no sensitive data)
        const safe = { ...job };
        delete safe.stack;
        // Don't expose full payload credentials in response
        return safe;
    }

    /**
     * Emit progress event for SSE streaming
     */
    emitProgress(id, data) {
        const job = this.jobs.get(id);
        if (!job) return;
        job.progress = data;
        this.emit(`progress:${id}`, data);
    }

    async updateJobStatus(id, status, extra = {}) {
        const job = this.jobs.get(id);
        if (!job) return;

        const previousStatus = job.status;
        job.status = status;
        Object.assign(job, extra);
        job.updated_at = new Date().toISOString();

        // Emit status change as progress event
        this.emit(`progress:${id}`, { stage: status, ...extra });

        await this.persistJob(job);

        if (['done', 'failed'].includes(status)) {
            // Only decrement if this job was actively running
            if (['processing', 'preparing'].includes(previousStatus)) {
                this.activeJobs = Math.max(0, this.activeJobs - 1);
            }

            if (status === 'done') this.metrics.completed++;
            if (status === 'failed') this.metrics.failed++;

            // Calculate duration
            if (job.created_at && job.updated_at) {
                const duration = new Date(job.updated_at) - new Date(job.created_at);
                this.metrics.total_time_ms += duration;
            }

            // Webhook Callback with retry
            if (job.payload.webhook_url) {
                this.sendWebhookWithRetry(job.payload.webhook_url, job);
            }

            // DO NOT cleanup immediately on done/failed so the user can download the result.
            // Cleanup is handled by the 24h cleanupOldJobs timer.

            this.processQueue();
        } else if (status === 'cancelled') {
            if (['processing', 'preparing'].includes(previousStatus)) {
                this.activeJobs = Math.max(0, this.activeJobs - 1);
            }
            // Cleanup immediately on cancel since it's abandoned
            this.cleanupJob(id);
            this.processQueue();
        }
    }

    async persistJob(job) {
        await fs.writeFile(
            path.join(config.paths.jobs, `${job.id}.json`),
            JSON.stringify(job, null, 2)
        );
    }

    async processQueue() {
        if (this.activeJobs >= config.queue.compositionConcurrency) return;

        // FIFO: find next queued job
        const nextJob = Array.from(this.jobs.values())
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .find(j => j.status === 'queued');

        if (!nextJob) return;

        this.activeJobs++;
        await this.updateJobStatus(nextJob.id, 'preparing');

        // Execute asynchronously
        this.executeJob(nextJob);
    }

    async executeJob(job) {
        try {
            await this.updateJobStatus(job.id, 'processing');

            // Provide progress callback to engines
            const onProgress = (data) => this.emitProgress(job.id, data);

            let result;
            if (job.payload.mode === 'assembly') {
                result = await assemblyEngine.run(job, onProgress);
            } else if (job.payload.mode === 'composition') {
                result = await compositionEngine.run(job, onProgress);
            } else {
                throw new Error(`Unknown mode: ${job.payload.mode}`);
            }

            // Upload to S3 if configured
            if (process.env.S3_BUCKET) {
                const chatId = job.payload.meta?.chat_id || job.payload.composition?.meta?.chat_id || 'guest';
                const userFolder = `users/${chatId}`;

                // Upload main output
                if (result.outputFile) {
                    try {
                        const key = `${userFolder}/jobs/${job.id}/${path.basename(result.outputFile)}`;
                        console.log(`Job ${job.id}: Uploading result to S3 for user ${chatId}...`);
                        result.url = await uploadService.uploadFile(result.outputFile, key);
                    } catch (uploadErr) {
                        console.error(`Job ${job.id}: Video upload failed`, uploadErr.message);
                        result.uploadError = uploadErr.message;
                    }
                }
                // Upload thumbnail
                if (result.thumbnailFile) {
                    try {
                        const thumbKey = `${userFolder}/jobs/${job.id}/${path.basename(result.thumbnailFile)}`;
                        console.log(`Job ${job.id}: Uploading thumbnail to S3 for user ${chatId}...`);
                        result.thumbnailUrl = await uploadService.uploadFile(result.thumbnailFile, thumbKey);
                    } catch (thumbErr) {
                        console.error(`Job ${job.id}: Thumbnail upload failed`, thumbErr.message);
                    }
                }
            }

            await this.updateJobStatus(job.id, 'done', { result });

        } catch (err) {
            console.error(`Job ${job.id} failed:`, err.message);
            await this.updateJobStatus(job.id, 'failed', { error: err.message });
        }
    }

    async cancelJob(id) {
        const job = this.jobs.get(id);
        if (!job) throw new Error('Job not found');

        await this.updateJobStatus(id, 'cancelled');
    }

    async cleanupJob(id) {
        const workDir = path.join(config.paths.temp, id);
        try {
            await fs.rm(workDir, { recursive: true, force: true });
            console.log(`Cleaned up temp for job ${id}`);
        } catch (e) {
            // Ignore — dir might not exist
        }
    }

    async cleanupOldJobs() {
        const now = Date.now();

        // Check disk usage of temp directory
        let tempSizeMB = 0;
        try {
            tempSizeMB = await this.getDirSizeMB(config.paths.temp);
        } catch (e) { /* ignore */ }

        // Adaptive threshold: 24h normally, 6h if disk critical (>2GB)
        const maxAge = tempSizeMB > 2048 ? 6 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

        if (tempSizeMB > 1024) {
            console.warn(`⚠️ Temp disk usage: ${tempSizeMB.toFixed(0)}MB (threshold: ${maxAge / 3600000}h)`);
        }

        let cleaned = 0;
        for (const [id, job] of this.jobs) {
            if (['done', 'failed', 'cancelled'].includes(job.status)) {
                const age = now - new Date(job.updated_at || job.created_at).getTime();
                if (age > maxAge) {
                    this.jobs.delete(id);
                    cleaned++;
                    try {
                        await fs.unlink(path.join(config.paths.jobs, `${id}.json`));
                        await this.cleanupJob(id);
                    } catch (e) { /* ignore */ }
                }
            }
        }
        if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} old jobs (temp: ${tempSizeMB.toFixed(0)}MB)`);
    }

    async getDirSizeMB(dirPath) {
        let totalBytes = 0;
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                if (entry.isDirectory()) {
                    totalBytes += await this.getDirSizeMB(fullPath) * 1024 * 1024;
                } else {
                    const stat = await fs.stat(fullPath);
                    totalBytes += stat.size;
                }
            }
        } catch (e) { /* ignore errors */ }
        return totalBytes / (1024 * 1024);
    }

    async sendWebhookWithRetry(url, job) {
        const safeCopy = { ...job };
        delete safeCopy.stack;

        for (let attempt = 1; attempt <= MAX_WEBHOOK_RETRIES; attempt++) {
            try {
                console.log(`Webhook for job ${job.id} → ${url} (attempt ${attempt})`);
                const { fetch } = await import('undici');
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(safeCopy),
                    signal: AbortSignal.timeout(10000) // 10s timeout
                });
                if (res.ok) {
                    console.log(`Webhook for job ${job.id} delivered.`);
                    return;
                }
                console.warn(`Webhook returned ${res.status}`);
            } catch (e) {
                console.warn(`Webhook attempt ${attempt} failed: ${e.message}`);
            }
            if (attempt < MAX_WEBHOOK_RETRIES) {
                await new Promise(r => setTimeout(r, WEBHOOK_BACKOFF_MS * attempt));
            }
        }
        console.error(`Webhook for job ${job.id} failed after ${MAX_WEBHOOK_RETRIES} attempts.`);
    }

    getMetrics() {
        return {
            active_jobs: this.activeJobs,
            queued_jobs: Array.from(this.jobs.values()).filter(j => j.status === 'queued').length,
            completed_jobs: this.metrics.completed,
            failed_jobs: this.metrics.failed,
            average_time_ms: this.metrics.completed > 0 ? Math.round(this.metrics.total_time_ms / this.metrics.completed) : 0
        };
    }
}

export default new JobManager();
