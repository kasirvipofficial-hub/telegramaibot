import 'dotenv/config';
import Fastify from 'fastify';
import path from 'path';
import fs from 'fs/promises';

import config from '../config/default.js';
import authMiddleware from './middleware/auth.js';
import jobManager from './core/job-manager.js';
import jobsRoutes from './api/jobs.js';
import voiceRoutes from './api/voice.js';

const fastify = Fastify({
    logger: true,
    bodyLimit: 1048576 // 1MB max body size
});

// Auth middleware (skipped if API_KEY not set)
fastify.addHook('onRequest', authMiddleware);

// Register routes
fastify.register(jobsRoutes);
fastify.register(voiceRoutes);

fastify.get('/health', async (request, reply) => {
    return {
        status: 'ok',
        uptime: process.uptime(),
        metrics: jobManager.getMetrics()
    };
});

// Startup logic
const start = async () => {
    try {
        // Ensure directories exist
        await fs.mkdir(config.paths.jobs, { recursive: true });
        await fs.mkdir(config.paths.temp, { recursive: true });
        await fs.mkdir(config.paths.uploads, { recursive: true });

        // Initialize Job Manager (recover state + resume queue)
        await jobManager.init();

        await fastify.listen({ port: config.port, host: config.host });
        console.log(`Server running at http://${config.host}:${config.port}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

// Graceful shutdown
const shutdown = async (signal) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    try {
        await fastify.close();
        console.log('Server closed.');
    } catch (err) {
        console.error('Error during shutdown:', err);
    }
    process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
