
import path from 'path';
import fs from 'fs/promises';
import { runFFmpeg, downloadFile } from '../utils/ffmpeg.js';
import config from '../../config/default.js';

export default {
    async run(job) {
        const { timeline } = job.payload.assembly;
        const workDir = path.join(config.paths.temp, job.id);
        await fs.mkdir(workDir, { recursive: true });

        const segmentFiles = [];

        // 1. Process each segment
        for (let i = 0; i < timeline.length; i++) {
            const segment = timeline[i];
            const sourceExt = path.extname(new URL(segment.source_url).pathname) || '.mp4';
            const localSource = path.join(workDir, `source_${i}${sourceExt}`);
            const segmentOutput = path.join(workDir, `seg_${i}.mp4`);

            // Check if we can stream copy directly from URL (ideal) or need to download
            // For stability, let's download first.
            // In a real optimized engine, we'd use http protocol in ffmpeg inputs.

            console.log(`Job ${job.id}: Downloading segment ${i}...`);
            await downloadFile(segment.source_url, localSource);

            // Cut segment
            // ffmpeg -ss {start} -to {end} -i {source} -c copy {out}
            const args = [];
            if (segment.start !== undefined) args.push('-ss', segment.start.toString());
            if (segment.end !== undefined) args.push('-to', segment.end.toString());

            args.push('-i', localSource);
            // reset timestamps to avoid issues during concat
            // args.push('-avoid_negative_ts', 'make_zero'); 
            // Note: -c copy with -ss before -i is frame-accurate but slow seek.
            // -ss after -i is fast seek but not keyframe accurate.
            // For assembly engine, we want fast, but accurate start is important.
            // Let's try standard copy.

            args.push('-c', 'copy', '-avoid_negative_ts', 'make_zero', segmentOutput);

            console.log(`Job ${job.id}: Cutting segment ${i}...`);
            await runFFmpeg(args, workDir);
            segmentFiles.push(segmentOutput);
        }

        // 2. Create Concat List
        const concatListPath = path.join(workDir, 'concat.txt');
        const concatContent = segmentFiles.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
        await fs.writeFile(concatListPath, concatContent);

        // 3. Concat
        const outputFile = path.join(workDir, 'output.mp4');
        const concatArgs = [
            '-f', 'concat',
            '-safe', '0',
            '-i', 'concat.txt',
            '-c', 'copy',
            outputFile
        ];

        console.log(`Job ${job.id}: Concatenating...`);
        await runFFmpeg(concatArgs, workDir);

        return {
            outputFile,
            segments: segmentFiles.length
        };
    }
};
