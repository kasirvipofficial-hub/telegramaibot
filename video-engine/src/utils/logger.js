
import { createRequire } from 'module';

// Use pino from Fastify's dependencies
let pino;
try {
    const require = createRequire(import.meta.url);
    pino = require('pino');
} catch (e) {
    // Fallback: structured console logger
    pino = null;
}

function createLogger(name) {
    if (pino) {
        const opts = {
            level: process.env.LOG_LEVEL || 'info',
            name,
        };
        if (process.env.NODE_ENV !== 'production') {
            opts.transport = { target: 'pino-pretty' };
        }
        return pino(opts);
    }

    // Structured console fallback
    const log = (level, msg, data = {}) => {
        const entry = { time: new Date().toISOString(), level, name, msg, ...data };
        const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
        fn(JSON.stringify(entry));
    };
    return {
        info: (msg, data) => log('info', msg, data),
        warn: (msg, data) => log('warn', msg, data),
        error: (msg, data) => log('error', msg, data),
        child: (bindings) => createLogger(`${name}:${bindings.module || ''}`)
    };
}

const logger = createLogger('video-engine');

export default logger;
export { createLogger };
