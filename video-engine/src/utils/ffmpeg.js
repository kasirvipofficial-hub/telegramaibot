
import { spawn } from 'child_process';
import path from 'path';
import config from '../../config/default.js';
import { fetch, Agent, setGlobalDispatcher } from 'undici';
import fs from 'fs/promises';
import fs_sync from 'fs';

// Configure global dispatcher for better reliability
setGlobalDispatcher(new Agent({
    connect: { timeout: 60000 },
    bodyTimeout: 120000,
    headersTimeout: 30000,
    keepAliveTimeout: 10000
}));

// Limits
const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024; // 500MB max download
const ALLOWED_CONTENT_TYPES = [
    'video/', 'audio/', 'application/octet-stream',
    'image/', 'application/mp4', 'binary/octet-stream'
];

export async function runFFmpeg(args, workingDir) {
    return new Promise((resolve, reject) => {
        const cmd = `ffmpeg ${args.join(' ')}`;
        console.log(`[FFmpeg] ${cmd.substring(0, 200)}...`);

        const ffmpeg = spawn('ffmpeg', args, {
            cwd: workingDir,
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stderr = '';
        let killed = false;

        // Timeout: kill FFmpeg if it exceeds the configured limit
        const timeoutMs = (config.ffmpeg.timeout || 300) * 1000;
        const killTimer = setTimeout(() => {
            killed = true;
            ffmpeg.kill('SIGKILL');
        }, timeoutMs);

        ffmpeg.stderr.on('data', (data) => {
            stderr += data.toString();
            // Cap stderr buffer to ~1MB to prevent memory issues
            if (stderr.length > 1024 * 1024) {
                stderr = stderr.slice(-512 * 1024);
            }
        });

        ffmpeg.on('close', (code) => {
            clearTimeout(killTimer);
            if (killed) {
                reject(new Error(`FFmpeg timed out after ${config.ffmpeg.timeout}s`));
            } else if (code === 0) {
                resolve(stderr);
            } else {
                // Only include last 2000 chars of stderr in error
                const stderrTail = stderr.length > 2000 ? '...' + stderr.slice(-2000) : stderr;
                reject(new Error(`FFmpeg exited with code ${code}\n${stderrTail}`));
            }
        });

        ffmpeg.on('error', (err) => {
            clearTimeout(killTimer);
            reject(new Error(`Failed to spawn ffmpeg: ${err.message}`));
        });
    });
}

export async function probeFile(filePath) {
    return new Promise((resolve, reject) => {
        const ffprobe = spawn('ffprobe', [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            filePath
        ]);

        ffprobe.on('error', (err) => {
            reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
        });

        let stdout = '';
        let stderr = '';

        ffprobe.stdout.on('data', (data) => { stdout += data.toString(); });
        ffprobe.stderr.on('data', (data) => { stderr += data.toString(); });

        ffprobe.on('close', (code) => {
            if (code === 0) {
                try {
                    resolve(JSON.parse(stdout));
                } catch (e) {
                    reject(new Error(`Failed to parse ffprobe output: ${e.message}`));
                }
            } else {
                reject(new Error(`ffprobe exited with code ${code}`));
            }
        });
    });
}

function downloadWithCurl(url, destPath) {
    return new Promise((resolve, reject) => {
        const isWin = process.platform === 'win32';
        const curlCmd = isWin ? 'curl.exe' : 'curl';
        const curlArgs = [
            '-L',             // Follow redirects
            '-o', destPath,
            '--max-filesize', String(MAX_DOWNLOAD_SIZE),
            '--max-time', '120',  // 2 min timeout
            '-f',             // Fail on HTTP errors
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            url
        ];

        if (isWin) {
            curlArgs.push('--ssl-no-revoke'); // Avoid CRL check issues on Windows
        }

        const curl = spawn(curlCmd, curlArgs);

        curl.on('close', (code) => {
            if (code === 0) resolve(destPath);
            else reject(new Error(`curl exited with code ${code}`));
        });

        curl.on('error', (err) => reject(new Error(`Failed to spawn curl: ${err.message}`)));
    });
}

export async function downloadFile(url, destPath) {
    // Validate URL scheme
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        throw new Error(`Invalid download URL scheme: ${url}`);
    }

    let lastError;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            console.log(`Downloading ${url.substring(0, 100)} (attempt ${attempt}/${maxRetries})...`);
            try {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });
                // Progress log
                // console.log(`[Download] Response status: ${response.status} for ${url.substring(0, 50)}...`);

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                // Check Content-Length
                const contentLength = parseInt(response.headers.get('content-length') || '0');
                if (contentLength > MAX_DOWNLOAD_SIZE) {
                    throw new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_DOWNLOAD_SIZE / 1024 / 1024}MB limit`);
                }

                const buffer = await response.arrayBuffer();

                // Validate downloaded content isn't an error page
                if (buffer.byteLength < 200) {
                    const sample = Buffer.from(buffer).toString('utf8', 0, 100);
                    if (sample.includes('<?xml') || sample.includes('<Error>') || sample.includes('<html')) {
                        throw new Error(`Download returned error page: ${sample.substring(0, 80)}`);
                    }
                }

                await fs.writeFile(destPath, Buffer.from(buffer));
                return destPath;
            } catch (e) {
                console.warn(`Fetch failed: ${e.message}. Trying curl...`);
                await downloadWithCurl(url, destPath);

                // Validate curl result too
                const stat = await fs.stat(destPath);
                if (stat.size < 200) {
                    const content = await fs.readFile(destPath, 'utf8');
                    if (content.includes('<Error>') || content.includes('AccessDenied')) {
                        throw new Error(`Downloaded file is an error response: ${content.substring(0, 80)}`);
                    }
                }
                return destPath;
            }

        } catch (e) {
            console.warn(`Download failed (attempt ${attempt}): ${e.message}`);
            lastError = e;
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }
    throw new Error(`Failed to download after ${maxRetries} attempts: ${lastError.message}`);
}
