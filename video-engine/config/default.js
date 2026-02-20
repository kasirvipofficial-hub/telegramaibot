
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT_DIR = path.resolve(__dirname, '..');

export default {
    port: process.env.PORT || 3000,
    host: process.env.HOST || '0.0.0.0',
    paths: {
        root: ROOT_DIR,
        jobs: path.join(ROOT_DIR, 'data/jobs'),
        temp: path.join(ROOT_DIR, 'tmp'),
        uploads: path.join(ROOT_DIR, 'tmp/uploads'),
        templates: path.join(ROOT_DIR, 'src/templates'),
        assets: path.join(ROOT_DIR, 'src/assets')
    },
    ffmpeg: {
        threads: 1, // Strict requirement
        timeout: 300 // 5 minutes default timeout
    },
    queue: {
        assemblyConcurrency: 2,
        compositionConcurrency: 1
    }
};
