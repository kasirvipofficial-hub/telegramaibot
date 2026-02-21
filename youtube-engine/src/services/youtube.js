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
     * returns a Readable stream of the video content
     */
    downloadStream(url) {
        const args = [
            ...this.getCommonArgs(),
            '-f', 'best[ext=mp4]/best',
            '-o', '-',
            url
        ];

        console.log(`Spawning: ${YT_DLP_PATH} ${args.join(' ')}`);
        const process = spawn(YT_DLP_PATH, args);

        process.stderr.on('data', (data) => {
            console.error(`[yt-dlp] ${data.toString()}`);
        });

        return process.stdout;
    }
}

export default new YoutubeService();
