import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

const YT_DLP_PATH = 'yt-dlp';
const COOKIES_PATH = path.resolve(__dirname, '../../cookies.txt');

class YoutubeService {
    getCommonArgs() {
        let args = [];
        if (fs.existsSync(COOKIES_PATH)) {
            args.push('--cookies', COOKIES_PATH);
        }
        args.push('--js-runtimes', 'node');
        return args;
    }

    async getInfo(url) {
        try {
            const args = [...this.getCommonArgs(), '--dump-json', url];
            const { stdout } = await execAsync(`"${YT_DLP_PATH}" ${args.join(' ')}`);
            const info = JSON.parse(stdout);

            return {
                title: info.title,
                author: info.uploader,
                duration: info.duration,
                thumbnail: info.thumbnail,
                videoId: info.id
            };
        } catch (err) {
            console.error('Youtube Info Error:', err.message);
            if (err.message.includes('Sign in to confirm you’re not a bot')) {
                throw new Error('IP Server dideteksi bot oleh YouTube. Harap masukkan cookies.txt di folder youtube-engine.');
            }
            throw new Error(`Gagal mengambil info YouTube: ${err.message}`);
        }
    }

    /**
     * Downloads the video to the temp directory and returns the file path.
     */
    async downloadToFile(url, tempDir, filename) {
        const outputPath = path.resolve(tempDir, filename);

        // Resolve absolute path to aria2c.exe which we downloaded to youtube-engine root
        const aria2cPath = path.resolve(process.cwd(), 'aria2c.exe');

        const args = [
            ...this.getCommonArgs(),
            '-f', 'best[ext=mp4]/best',
            '--downloader', aria2cPath,
            '--downloader-args', `aria2c:"-x 16 -k 1M"`,
            '-o', outputPath,
            url
        ];

        console.log(`Executing: ${YT_DLP_PATH} ${args.join(' ')}`);

        return new Promise((resolve, reject) => {
            const process = spawn(YT_DLP_PATH, args);

            process.stderr.on('data', (data) => {
                console.error(`[yt-dlp error] ${data.toString()}`);
            });

            process.stdout.on('data', (data) => {
                // Log progress optionally, or keep quiet
                const out = data.toString();
                if (out.includes('[download]') || out.includes('ETA:')) {
                    console.log(`[yt-dlp] ${out.trim()}`);
                }
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(outputPath);
                } else {
                    reject(new Error(`yt-dlp exited with code ${code}`));
                }
            });
        });
    }
}

export default new YoutubeService();
