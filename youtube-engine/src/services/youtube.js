import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const execAsync = promisify(exec);

const YT_DLP_PATH = '/usr/local/bin/yt-dlp-new';
const COOKIES_PATH = path.resolve(__dirname, '../../cookies.txt');
const RAM_TEMP_DIR = '/dev/shm/youtube-engine';

// Ensure RAM temp dir exists
if (!fs.existsSync(RAM_TEMP_DIR)) {
    try {
        fs.mkdirSync(RAM_TEMP_DIR, { recursive: true });
    } catch (e) {
        console.warn('Could not create /dev/shm/youtube-engine, falling back to local temp');
    }
}

class YoutubeService {
    getCommonArgs() {
        let args = '';
        if (fs.existsSync(COOKIES_PATH)) {
            args += ` --cookies "${COOKIES_PATH}"`;
        }
        args += ` --js-runtimes node`;
        return args;
    }

    async getInfo(url) {
        try {
            const commonArgs = this.getCommonArgs();
            const { stdout } = await execAsync(`${YT_DLP_PATH}${commonArgs} --dump-json "${url}"`);
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

    async downloadVideo(url, fileName) {
        try {
            const outputPath = path.join(fs.existsSync(RAM_TEMP_DIR) ? RAM_TEMP_DIR : '/tmp', fileName);
            const commonArgs = this.getCommonArgs();

            // Download best quality video + audio together
            const cmd = `${YT_DLP_PATH}${commonArgs} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" -o "${outputPath}" "${url}"`;
            console.log(`Executing: ${cmd}`);
            await execAsync(cmd);

            return outputPath;
        } catch (err) {
            console.error('Youtube Download Error:', err.message);
            throw new Error(`Gagal mendownload YouTube: ${err.message}`);
        }
    }
}

export default new YoutubeService();
