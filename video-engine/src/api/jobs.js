
import jobManager from '../core/job-manager.js';

// Simple URL validation
function isValidUrl(str) {
    try {
        const url = new URL(str);
        return ['http:', 'https:'].includes(url.protocol);
    } catch {
        return false;
    }
}

export default async function (fastify, opts) {
    // Create Job
    fastify.post('/jobs', async (request, reply) => {
        const payload = request.body;

        // Mode validation
        if (!payload.mode || !['assembly', 'composition'].includes(payload.mode)) {
            return reply.code(400).send({ error: 'Invalid mode. Must be "assembly" or "composition".' });
        }

        // Composition-specific validation
        if (payload.mode === 'composition') {
            const comp = payload.composition;
            if (!comp) {
                return reply.code(400).send({ error: 'Missing "composition" object for composition mode.' });
            }

            // Validate clips
            if (comp.clips && Array.isArray(comp.clips)) {
                if (comp.clips.length === 0 || comp.clips.length > 20) {
                    return reply.code(400).send({ error: 'clips must have 1-20 items.' });
                }
                for (const clip of comp.clips) {
                    // Each clip needs either url or query
                    if (!clip.url && !clip.query) {
                        return reply.code(400).send({ error: 'Each clip must have a "url" or "query" field.' });
                    }
                    if (clip.url && clip.url.startsWith('http') && !isValidUrl(clip.url)) {
                        return reply.code(400).send({ error: `Invalid clip URL: ${clip.url}` });
                    }
                    // Speed range
                    if (clip.speed !== undefined && (typeof clip.speed !== 'number' || clip.speed < 0.25 || clip.speed > 4.0)) {
                        return reply.code(400).send({ error: 'clip.speed must be between 0.25 and 4.0' });
                    }
                    // Boolean flags
                    if (clip.blur_background !== undefined && typeof clip.blur_background !== 'boolean') {
                        return reply.code(400).send({ error: 'clip.blur_background must be a boolean' });
                    }
                    // Transition
                    if (clip.transition && typeof clip.transition !== 'object') {
                        return reply.code(400).send({ error: 'Clip transition must be an object { type, duration }.' });
                    }
                }
            } else if (!comp.input) {
                return reply.code(400).send({ error: 'Either "clips" array or "input" URL required.' });
            }

            // Validate overlays
            if (comp.overlays && Array.isArray(comp.overlays)) {
                if (comp.overlays.length > 5) {
                    return reply.code(400).send({ error: 'Maximum 5 overlays allowed.' });
                }
                for (const ov of comp.overlays) {
                    if (!ov.url) {
                        return reply.code(400).send({ error: 'Each overlay must have a "url".' });
                    }
                }
            }

            // Validate output_format
            const validFormats = ['shorts', 'reels', 'tiktok', 'landscape', 'youtube', 'square', 'instagram', 'portrait_4_5'];
            if (comp.output_format && !validFormats.includes(comp.output_format)) {
                return reply.code(400).send({ error: `Invalid output_format. Valid: ${validFormats.join(', ')}` });
            }

            // Validate quality
            if (comp.quality && !['draft', 'full'].includes(comp.quality)) {
                return reply.code(400).send({ error: 'quality must be "draft" or "full".' });
            }

            // Validate subtitles text length
            if (comp.subtitles && Array.isArray(comp.subtitles)) {
                for (const sub of comp.subtitles) {
                    if (!sub.text || typeof sub.start !== 'number' || typeof sub.end !== 'number') {
                        return reply.code(400).send({ error: 'Each subtitle must have text, start, and end.' });
                    }
                }
            }

            // Validate voice_over text length
            if (comp.voice_over && typeof comp.voice_over === 'object' && comp.voice_over.text) {
                if (comp.voice_over.text.length > 5000) {
                    return reply.code(400).send({ error: 'voice_over.text exceeds 5000 character limit.' });
                }
            }
        }

        // Assembly-specific validation
        if (payload.mode === 'assembly') {
            if (!payload.assembly || !payload.assembly.timeline || !Array.isArray(payload.assembly.timeline)) {
                return reply.code(400).send({ error: 'Assembly mode requires assembly.timeline array.' });
            }
            if (payload.assembly.timeline.length === 0 || payload.assembly.timeline.length > 50) {
                return reply.code(400).send({ error: 'timeline must have 1-50 segments.' });
            }
            for (const seg of payload.assembly.timeline) {
                if (!seg.source_url || !isValidUrl(seg.source_url)) {
                    return reply.code(400).send({ error: `Invalid segment URL: ${seg.source_url}` });
                }
            }
        }

        // Webhook URL validation
        if (payload.webhook_url && !isValidUrl(payload.webhook_url)) {
            return reply.code(400).send({ error: 'Invalid webhook_url.' });
        }

        const jobId = await jobManager.createJob(payload);
        return { job_id: jobId, status: 'queued' };
    });

    // Get Job Status
    fastify.get('/jobs/:id', async (request, reply) => {
        const job = jobManager.getJob(request.params.id);
        if (!job) {
            return reply.code(404).send({ error: 'Job not found' });
        }
        return job;
    });

    // Get Job Result
    fastify.get('/jobs/:id/result', async (request, reply) => {
        const job = jobManager.getJob(request.params.id);
        if (!job) {
            return reply.code(404).send({ error: 'Job not found' });
        }
        if (job.status !== 'done' || !job.result) {
            return reply.code(400).send({ error: 'Job not finished or no result available.' });
        }
        return {
            status: 'done',
            outputFile: job.result.outputFile,
            url: job.result.url || null,
            thumbnailFile: job.result.thumbnailFile || null,
            thumbnailUrl: job.result.thumbnailUrl || null,
            uploadError: job.result.uploadError || null
        };
    });

    // Cancel / Delete Job
    fastify.delete('/jobs/:id', async (request, reply) => {
        try {
            await jobManager.cancelJob(request.params.id);
            return { status: 'cancelled' };
        } catch (e) {
            return reply.code(404).send({ error: e.message });
        }
    });

    // SSE Progress Stream
    fastify.get('/jobs/:id/stream', async (request, reply) => {
        const jobId = request.params.id;
        const job = jobManager.getJob(jobId);
        if (!job) {
            return reply.code(404).send({ error: 'Job not found' });
        }

        // If job is already done/failed, return final state immediately
        if (['done', 'failed', 'cancelled'].includes(job.status)) {
            reply.header('Content-Type', 'text/event-stream');
            reply.header('Cache-Control', 'no-cache');
            reply.header('Connection', 'keep-alive');
            const event = job.status === 'done' ? 'done' : 'error';
            const data = job.status === 'done'
                ? JSON.stringify({ status: 'done', result: job.result })
                : JSON.stringify({ status: job.status, error: job.error });
            reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
            reply.raw.end();
            return;
        }

        // Set up SSE stream
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no'
        });
        reply.hijack();

        // Send initial state
        reply.raw.write(`event: status\ndata: ${JSON.stringify({ status: job.status })}\n\n`);

        // Listen for progress events
        const onProgress = (data) => {
            try {
                if (data.stage === 'done' || data.result) {
                    reply.raw.write(`event: done\ndata: ${JSON.stringify(data)}\n\n`);
                    cleanup();
                } else if (data.stage === 'failed' || data.error) {
                    reply.raw.write(`event: error\ndata: ${JSON.stringify(data)}\n\n`);
                    cleanup();
                } else {
                    reply.raw.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
                }
            } catch (e) {
                cleanup();
            }
        };

        const cleanup = () => {
            jobManager.off(`progress:${jobId}`, onProgress);
            try { reply.raw.end(); } catch (e) { /* ignore */ }
        };

        jobManager.on(`progress:${jobId}`, onProgress);

        // Clean up on client disconnect
        request.raw.on('close', cleanup);

        // Heartbeat to keep connection alive
        const heartbeat = setInterval(() => {
            try {
                reply.raw.write(': heartbeat\n\n');
            } catch (e) {
                clearInterval(heartbeat);
                cleanup();
            }
        }, 15000);

        // Cleanup heartbeat on close
        request.raw.on('close', () => clearInterval(heartbeat));
    });
}
