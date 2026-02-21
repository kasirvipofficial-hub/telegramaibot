
import path from 'path';
import fs from 'fs/promises';
import { runFFmpeg, downloadFile, probeFile } from '../utils/ffmpeg.js';
import config from '../../config/default.js';
import TextStyles from '../modules/text/styles.js';
import AnimationPresets from '../modules/animations/presets.js';
import KieVoice from '../modules/voice/kie.js';
import StockSearch from '../modules/stock/search.js';
import SrtParser from '../modules/text/srt-parser.js';
import WordHighlight from '../modules/text/word-highlight.js';
import OpenAITTS from '../modules/voice/openai-tts.js';
import HuggingFaceTTS from '../modules/voice/huggingface-tts.js';
import EdgeTTS from '../modules/voice/edge-tts.js';


// Resolution presets
const RESOLUTION_PRESETS = {
    shorts: '1080x1920',
    reels: '1080x1920',
    tiktok: '1080x1920',
    landscape: '1920x1080',
    youtube: '1920x1080',
    square: '1080x1080',
    instagram: '1080x1080',
    portrait_4_5: '1080x1350'
};

// Supported xfade transition types
const XFADE_TYPES = [
    'fade', 'fadeblack', 'fadewhite', 'fadegrays',
    'slideleft', 'slideright', 'slideup', 'slidedown',
    'wipeleft', 'wiperight', 'wipeup', 'wipedown',
    'smoothleft', 'smoothright', 'smoothup', 'smoothdown',
    'circlecrop', 'circleopen', 'circleclose',
    'dissolve', 'pixelize', 'radial', 'hblur',
    'wipetl', 'wipetr', 'wipebl', 'wipebr'
];

export default {
    async run(job, onProgress = () => { }) {
        const { composition } = job.payload;
        const workDir = path.join(config.paths.temp, job.id);
        await fs.mkdir(workDir, { recursive: true });
        onProgress({ stage: 'preparing', message: 'Setting up workspace' });

        // 1. Resolve clips (support url, local path, or stock query)
        let clips = [];
        if (composition.clips && Array.isArray(composition.clips)) {
            clips = composition.clips;
        } else if (composition.input) {
            clips = [{ url: composition.input }];
        } else {
            throw new Error('No video inputs (composition.clips or composition.input missing)');
        }

        // 2. Load Template (Moved earlier to provide defaults)
        const templateId = composition.template_id || 'shorts_modern_v1';
        let template = await this.loadTemplate(templateId);

        // Resolve output_format preset
        if (composition.output_format && RESOLUTION_PRESETS[composition.output_format]) {
            template.resolution = RESOLUTION_PRESETS[composition.output_format];
        }
        if (composition.template_overrides) {
            template = { ...template, ...composition.template_overrides };
        }
        if (composition.template_variables) {
            template = this.applyTemplateVariables(template, composition.template_variables);
        }

        const clipFiles = [];
        console.log(`Job ${job.id}: Processing ${clips.length} clips...`);

        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];

            // Stock search: if clip has `query` instead of `url`
            if (clip.query && !clip.url) {
                onProgress({ stage: 'stock_search', clip: i + 1, total: clips.length, query: clip.query });
                console.log(`Job ${job.id}: Searching stock: "${clip.query}"...`);
                const stock = await StockSearch.searchVideo(clip.query, {
                    orientation: clip.orientation || 'portrait',
                    minDuration: clip.duration
                });
                clip.url = stock.url;
                console.log(`Job ${job.id}: Found ${stock.provider} clip (${stock.duration}s)`);
            }

            onProgress({ stage: 'downloading', clip: i + 1, total: clips.length });
            console.log(`Job ${job.id}: Downloading clip ${i + 1}/${clips.length}...`);

            // Determine if this is an image clip
            const isImage = clip.type === 'image' || /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(clip.url || '');
            const ext = isImage ? path.extname(clip.url || '.png') : '.mp4';
            const clipPath = path.join(workDir, `clip_${i}${ext}`);

            let clipUrl = clip.url;
            if (clipUrl && clipUrl.startsWith('local://')) {
                const relativePath = clipUrl.replace('local://', '');
                clipUrl = path.join(config.paths.assets, relativePath);
            }

            if (clipUrl && clipUrl.startsWith('http')) {
                await downloadFile(clipUrl, clipPath);
            } else if (clipUrl) {
                try {
                    await fs.access(clipUrl);
                    await fs.copyFile(clipUrl, clipPath);
                } catch (e) {
                    throw new Error(`Local clip not found: ${clipUrl} (from ${clip.url})`);
                }
            } else {
                throw new Error(`Clip ${i} has no url or query`);
            }

            clipFiles.push({
                path: clipPath,
                duration: clip.duration,
                speed: clip.speed,
                transition: clip.transition,
                isImage,
                effect: clip.effect,    // Ken Burns preset
                blur_background: clip.blur_background ?? template.blur_background ?? false
            });
        }

        // 2. Download Audio Assets
        let voFile = null;
        if (composition.voice_over) {
            voFile = path.join(workDir, 'vo.wav');
            console.log(`Job ${job.id}: Processing voice over...`);
            let voSource = composition.voice_over;

            if (typeof voSource === 'object' && voSource.text) {
                onProgress({ stage: 'tts', message: 'Generating voice-over' });
                console.log(`Job ${job.id}: Generating TTS...`);
                // ... TTS logic ...
                const ttsOptions = {
                    text: voSource.text,
                    voice: voSource.voice,
                    language_code: voSource.language_code || 'id',
                    timestamps: voSource.word_highlight || false,
                    workDir, // Pass workDir for local file saving (OpenAI)
                    ...voSource.options
                };

                const provider = voSource.provider || 'kie';
                let voResult;

                console.log(`Job ${job.id}: Calling TTS provider: ${provider}`);

                // --- Fallback Mechanism ---
                const providers = [provider, 'openai', 'huggingface', 'edge'];
                const tried = new Set();
                let lastErr = null;

                for (const p of providers) {
                    if (tried.has(p)) continue;
                    tried.add(p);

                    try {
                        onProgress({ stage: 'tts', message: `Generating voice-over (${p})` });
                        if (p === 'openai') {
                            if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_TTS_API_KEY) continue;
                            voResult = await OpenAITTS.generateVoiceOver(ttsOptions);
                        } else if (p === 'huggingface') {
                            if (!process.env.HF_API_KEY) continue;
                            voResult = await HuggingFaceTTS.generateVoiceOver(ttsOptions);
                        } else if (p === 'edge') {
                            // Self-hosted, always try as last resort
                            voResult = await EdgeTTS.generateVoiceOver(ttsOptions);
                        } else {
                            // Default to Kie or whatever requested
                            voResult = await KieVoice.generateVoiceOver(ttsOptions);
                        }

                        // If we reached here, TTS succeeded!
                        console.log(`Job ${job.id}: TTS succeeded with provider: ${p}`);
                        break;
                    } catch (err) {
                        console.warn(`Job ${job.id}: TTS provider ${p} failed: ${err.message}`);
                        lastErr = err;
                    }
                }

                if (!voResult) {
                    throw new Error(`All TTS providers failed. Last error: ${lastErr?.message}`);
                }

                console.log(`Job ${job.id}: TTS result received: ${JSON.stringify(voResult).substring(0, 100)}...`);
                voSource = voResult.url;

                if (voSource && voResult.timestamps) {
                    console.log(`Job ${job.id}: Received ${voResult.timestamps.length} timestamps`);
                    job._wordTimestamps = voResult.timestamps;
                }
            } else if (typeof voSource === 'object' && voSource.url) {
                voSource = voSource.url;
            }

            if (typeof voSource === 'string' && voSource.startsWith('http')) {
                console.log(`Job ${job.id}: Downloading VO from ${voSource}`);
                await downloadFile(voSource, voFile);
            } else if (typeof voSource === 'string') {
                console.log(`Job ${job.id}: Using local VO file ${voSource}`);
                await fs.access(voSource).catch((e) => {
                    console.error(`Job ${job.id}: VO access error: ${e.message}`);
                    throw new Error(`VO not found: ${voSource}`);
                });
                await fs.copyFile(voSource, voFile);
            }
        }
        let musicFile = null;
        if (composition.music) {
            onProgress({ stage: 'music', message: 'Processing background music' });
            musicFile = path.join(workDir, 'music.mp3');
            console.log(`Job ${job.id}: Processing music...`);

            const musicSrc = typeof composition.music === 'string' ? composition.music : composition.music.url;

            if (musicSrc.startsWith('http')) {
                await downloadFile(musicSrc, musicFile);
            } else {
                await fs.access(musicSrc).catch(() => { throw new Error(`Music not found: ${musicSrc}`); });
                await fs.copyFile(musicSrc, musicFile);
            }
        }

        // 3. Download Audio Assets (template already loaded)

        // Resolve default transition from template
        const defaultTransition = template.transitions || null;

        // 4. Quality settings (draft mode)
        const isDraft = composition.quality === 'draft';
        const [templateW, templateH] = template.resolution.split('x').map(Number);
        const w = isDraft ? Math.round(templateW / 3) : templateW;
        const h = isDraft ? Math.round(templateH / 3) : templateH;
        const preset = isDraft ? 'ultrafast' : 'fast';

        // 5. Generate Subtitles (ASS)
        let assFile = null;

        // Ensure backward compatibility plus blueprint 5 rules mapping
        const useAssHighlight = (composition.text && composition.text.subtitle_engine === 'ass') ||
            (composition.voice_over && typeof composition.voice_over === 'object' && composition.voice_over.word_highlight);

        // Option A: Per-word highlight subtitles (CapCut-style) / ASS Engine from Blueprint
        if (useAssHighlight) {
            const rawTimestamps = job._wordTimestamps || null;
            const fallbackText = composition.voice_over?.text || "";

            assFile = path.join(workDir, 'subs.ass');
            const wordTimings = WordHighlight.parseKieTimestamps({
                timestamps: rawTimestamps,
                text: fallbackText
            });

            if (wordTimings.length > 0) {
                const assContent = WordHighlight.generate(wordTimings, {
                    resolution: template.resolution,
                    highlightColor: (composition.text && composition.text.highlight_color) || (composition.voice_over && composition.voice_over.highlight_color) || '&H0000FFFF',
                    normalColor: (composition.text && composition.text.normal_color) || (composition.voice_over && composition.voice_over.normal_color) || '&H00FFFFFF',
                    fontName: (composition.text && composition.text.font) || (composition.voice_over && composition.voice_over.font) || 'Arial',
                    fontSize: (composition.text && composition.text.font_size) || (composition.voice_over && composition.voice_over.font_size) || 72,
                    wordsPerLine: (composition.text && composition.text.words_per_line) || (composition.voice_over && composition.voice_over.words_per_line) || 4
                });
                await fs.writeFile(assFile, assContent);
                console.log(`Job ${job.id}: Per-word highlight subtitles generated (${wordTimings.length} words)${rawTimestamps ? '' : ' (Estimated)'}`);
            } else {
                assFile = null;
            }
        }
        // Option B: SRT content provided as text
        else if (composition.srt_content) {
            const parsedSubs = SrtParser.parse(composition.srt_content);
            if (parsedSubs.length > 0) {
                assFile = path.join(workDir, 'subs.ass');
                await this.generateAssFile(parsedSubs, assFile, template);
                console.log(`Job ${job.id}: SRT imported (${parsedSubs.length} subtitles)`);
            }
        }
        // Option C: Subtitle array provided directly
        else if (composition.subtitles && composition.subtitles.length > 0) {
            assFile = path.join(workDir, 'subs.ass');
            await this.generateAssFile(composition.subtitles, assFile, template);
        }

        // 6. Build Filter Complex
        const inputs = [];
        const filterComplex = [];
        let streamIndex = 0;

        // Prepare LUT
        let lutFilter = null;
        if (template.color_grade && !isDraft) {
            const lutSrc = path.resolve('src/assets/luts', `${template.color_grade}.cube`);
            try {
                await fs.access(lutSrc);
                await fs.copyFile(lutSrc, path.join(workDir, 'lut.cube'));
                lutFilter = 'lut3d=file=lut.cube';
            } catch (e) {
                console.warn(`LUT not found: ${template.color_grade}`);
            }
        }

        // Per-clip processing
        const processedClips = [];
        onProgress({ stage: 'building_filters', message: 'Building video filters' });

        // Calculate final output duration based on VO if necessary
        const voDuration = job._voDuration || 0;
        const totalVisualDuration = clips.reduce((acc, c) => acc + (c.duration || 5), 0);
        const finalDuration = Math.max(totalVisualDuration, voDuration);

        for (let i = 0; i < clips.length; i++) {
            const clip = clips[i];
            const localPath = path.join(workDir, `clip_${i}.mp4`);

            if (clip.isImage) {
                // Loop image for duration so filters like zoompan work correctly
                const dur = clip.duration || 5;
                inputs.push('-loop', '1', '-t', String(dur + 1), '-i', localPath);
            } else {
                inputs.push('-i', localPath);
            }
            const currentStream = `[${streamIndex}:v]`;
            streamIndex++;

            let filters = [];

            // Ken Burns for image clips
            if (clip.isImage) {
                const dur = clip.duration || 5;
                const effect = clip.effect || 'ken_burns_zoom_in';
                const frames = dur * template.fps;

                let zpFilter;
                switch (effect) {
                    case 'ken_burns_zoom_out':
                        zpFilter = `zoompan=z='if(lte(zoom,1.0),1.5,max(1.001,zoom-0.002))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${template.fps}`;
                        break;
                    case 'ken_burns_pan_right':
                        zpFilter = `zoompan=z=1.2:x='if(lte(on,1),0,min(iw/zoom-iw, x+2))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${template.fps}`;
                        break;
                    case 'ken_burns_pan_left':
                        zpFilter = `zoompan=z=1.2:x='if(lte(on,1),iw/zoom-iw,max(0, x-2))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${template.fps}`;
                        break;
                    case 'ken_burns_zoom_in':
                    default:
                        zpFilter = `zoompan=z='min(zoom+0.002,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${w}x${h}:fps=${template.fps}`;
                        break;
                }
                filters.push(zpFilter);
                filters.push('setsar=1/1');
                if (lutFilter) filters.push(lutFilter);
            } else {
                // Video clip processing
                if (clip.duration) {
                    filters.push(`trim=duration=${clip.duration}`);
                    filters.push('setpts=PTS-STARTPTS');
                }

                // Speed control
                const speed = clip.speed;
                if (speed && speed !== 1) {
                    const clampedSpeed = Math.max(0.25, Math.min(4.0, speed));
                    filters.push(`setpts=PTS/${clampedSpeed}`);
                }

                // Scale & Crop
                if (clip.blur_background) {
                    // (Simplified for this block, keeping original logic)
                    filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1/1`);
                } else {
                    filters.push(`scale=${w}:${h}:force_original_aspect_ratio=increase`);
                    filters.push(`crop=${w}:${h}`);
                    filters.push('setsar=1/1');
                }
                filters.push(`fps=${template.fps}`);
                if (lutFilter) filters.push(lutFilter);
            }

            // PAD LAST CLIP IF NEEDED
            if (i === clips.length - 1 && finalDuration > totalVisualDuration) {
                const padTime = finalDuration - totalVisualDuration;
                filters.push(`tpad=stop_mode=clone:stop_duration=${padTime}`);
            }

            filterComplex.push(`${currentStream}${filters.join(',')}[v${i}]`);

            // Calculate effective duration for xfade offset
            let effectiveDuration = clip.duration || 5;
            const clipSpeed = clip.speed;
            if (clipSpeed && clipSpeed !== 1) {
                effectiveDuration = effectiveDuration / Math.max(0.25, Math.min(4.0, clipSpeed));
            }
            if (i === clips.length - 1 && finalDuration > totalVisualDuration) {
                effectiveDuration += (finalDuration - totalVisualDuration);
            }

            processedClips.push({
                label: `[v${i}]`,
                effectiveDuration,
                transition: clip.transition || (template.transitions ? template.transitions[0] : null),
                isImage: clip.isImage,
                effect: clip.effect
            });
        }

        // 7. Concat / Transitions
        let lastVideoStream;
        let totalVideoDuration = 0;
        if (processedClips.length === 1) {
            lastVideoStream = processedClips[0].label;
            totalVideoDuration = processedClips[0].effectiveDuration;
        } else {
            const transitionResult = this.buildTransitionChain(processedClips, filterComplex);
            lastVideoStream = transitionResult.stream;
            totalVideoDuration = transitionResult.duration;
        }

        // 8. Image Overlays (watermark, logo, sticker)
        if (composition.overlays && composition.overlays.length > 0) {
            for (let i = 0; i < composition.overlays.length; i++) {
                const overlay = composition.overlays[i];
                const overlayPath = path.join(workDir, `overlay_${i}.png`);

                if (overlay.url.startsWith('http')) {
                    await downloadFile(overlay.url, overlayPath);
                } else {
                    await fs.copyFile(overlay.url, overlayPath);
                }

                inputs.push('-i', overlayPath);
                const overlayIdx = streamIndex;
                streamIndex++;

                // Position
                const pos = this.resolveOverlayPosition(overlay.position || 'top-right', overlay.margin || 20, w, h);
                const opacity = overlay.opacity ?? 1.0;
                const size = overlay.size || -1;

                // Scale overlay
                let overlayLabel = `[${overlayIdx}:v]`;
                if (size > 0) {
                    filterComplex.push(`${overlayLabel}scale=${size}:-1[ovs${i}]`);
                    overlayLabel = `[ovs${i}]`;
                }

                // Apply opacity
                if (opacity < 1.0) {
                    filterComplex.push(`${overlayLabel}format=rgba,colorchannelmixer=aa=${opacity}[ova${i}]`);
                    overlayLabel = `[ova${i}]`;
                }

                // Overlay filter with optional timing
                let overlayFilter = `overlay=${pos.x}:${pos.y}`;
                if (overlay.start !== undefined || overlay.end !== undefined) {
                    const enableParts = [];
                    if (overlay.start !== undefined) enableParts.push(`gte(t,${overlay.start})`);
                    if (overlay.end !== undefined) enableParts.push(`lte(t,${overlay.end})`);
                    overlayFilter += `:enable='${enableParts.join('*')}'`;
                }

                filterComplex.push(`${lastVideoStream}${overlayLabel}${overlayFilter}[ov${i}]`);
                lastVideoStream = `[ov${i}]`;
            }
        }

        // 9. Subtitles
        if (assFile) {
            let fontsDir = path.resolve('src/assets/fonts').replace(/\\/g, '/');
            if (process.platform === 'win32') {
                fontsDir = fontsDir.replace(/:/g, '\\:');
            }
            // Use relative path for subtitles since we are in workDir
            filterComplex.push(`${lastVideoStream}subtitles='subs.ass':fontsdir='${fontsDir}'[vsubs]`);
            lastVideoStream = '[vsubs]';
        }

        // 9b. Progress Bar
        if (composition.progress_bar || template.progress_bar) {
            // Precise duration considering transition overlaps
            let totalDuration = 0;
            if (processedClips.length > 0) {
                totalDuration = processedClips[0].effectiveDuration;
                for (let i = 1; i < processedClips.length; i++) {
                    const trans = processedClips[i].transition;
                    const dur = (trans && trans.type) ? (trans.duration || 0.5) : 0;
                    totalDuration += processedClips[i].effectiveDuration - dur;
                }
            }

            const barHeight = 8;
            const barColor = composition.progress_bar_color || 'white@0.8';

            // Create a color source for the bar, then overlay it with a time-based x offset
            // Overlay x = -W + (W * t / duration) -> starts at -W (hidden) and moves to 0 (full)
            filterComplex.push(`color=c=${barColor}:s=${w}x${barHeight}[pbar]`);
            filterComplex.push(`${lastVideoStream}[pbar]overlay=x='-W+(W*t/${totalDuration})':y=H-${barHeight}:shortest=1[vprog]`);
            lastVideoStream = '[vprog]';
        }

        // 10. Audio Pipeline
        const audioMixInputs = [];
        let voStream = null;
        if (voFile) {
            inputs.push('-i', voFile);
            voStream = `[${streamIndex}:a]`;
            streamIndex++;
        }

        let musicStream = null;
        if (musicFile) {
            inputs.push('-i', musicFile);
            musicStream = `[${streamIndex}:a]`;
            streamIndex++;

            const musicVol = template.music_volume ?? 0.15;
            // new hierarchy support: composition.audio.voice.duck_music or fallback to old
            const isDucking = (composition.audio && composition.audio.voice && composition.audio.voice.duck_music !== undefined) ?
                composition.audio.voice.duck_music :
                (composition.audio_ducking ?? template.audio_ducking ?? false);

            if (isDucking && voStream) {
                filterComplex.push(`${voStream}asplit=2[vo_main][vo_sc]`);
                voStream = '[vo_main]';
                filterComplex.push(`${musicStream}volume=${musicVol}[mvol]`);
                filterComplex.push(`[mvol][vo_sc]sidechaincompress=threshold=0.1:ratio=4:attack=50:release=200[mduck]`);
                musicStream = '[mduck]';
            } else {
                filterComplex.push(`${musicStream}volume=${musicVol}[mvol]`);
                musicStream = '[mvol]';
            }
            audioMixInputs.push(musicStream);
        }

        if (voStream) {
            audioMixInputs.push(voStream);
        }

        let lastAudioStream;
        if (audioMixInputs.length > 0) {
            const safeDuration = Math.ceil(finalDuration) + 1;
            filterComplex.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${safeDuration}[asil]`);
            audioMixInputs.push('[asil]');

            let mixIn = audioMixInputs.join('');
            filterComplex.push(`${mixIn}amix=inputs=${audioMixInputs.length}:duration=longest:dropout_transition=2[amix]`);
            lastAudioStream = '[amix]';
        } else {
            const safeDuration = Math.ceil(finalDuration) + 1;
            filterComplex.push(`anullsrc=channel_layout=stereo:sample_rate=44100,atrim=duration=${safeDuration}[asil]`);
            lastAudioStream = '[asil]';
        }

        // 11. Render
        const outputFile = path.join(workDir, 'output.mp4');
        const filterFile = path.join(workDir, 'filters.txt');
        const filterStr = filterComplex.join(';');
        await fs.writeFile(filterFile, filterStr);

        const args = [
            '-y',
            ...inputs,
            '-filter_complex_script', filterFile,
            '-map', lastVideoStream,
            '-map', (typeof lastAudioStream === 'string' && lastAudioStream.match(/^\[\d+:a\]$/)) ? lastAudioStream.slice(1, -1) : lastAudioStream,
            '-c:v', 'libx264',
            '-preset', preset,
            '-r', String(template.fps),
            '-c:a', 'aac',
            '-b:a', isDraft ? '128k' : '192k',
            '-pix_fmt', 'yuv420p',
            '-t', String(finalDuration),
            outputFile
        ];

        // Debug log
        await fs.writeFile(path.join(process.cwd(), 'ffmpeg_args_debug.txt'), JSON.stringify(args, null, 2));


        console.log(`[FFMPEG_DEBUG] Full Args: ${JSON.stringify(args)}`);
        onProgress({ stage: 'rendering', quality: isDraft ? 'draft' : 'full', resolution: `${w}x${h}` });
        console.log(`Job ${job.id}: Rendering (${isDraft ? 'draft' : 'full'} quality, ${w}x${h})...`);
        await runFFmpeg(args, workDir);
        onProgress({ stage: 'post_processing', message: 'Generating thumbnail' });

        // 12. Thumbnail
        const result = { outputFile };
        const thumbConfig = composition.thumbnail;
        if (thumbConfig !== false) {
            try {
                const thumbTime = (thumbConfig && thumbConfig.time) || 1;
                const thumbPath = path.join(workDir, 'thumbnail.jpg');
                await runFFmpeg([
                    '-y', '-i', outputFile,
                    '-ss', String(thumbTime),
                    '-vframes', '1',
                    '-pix_fmt', 'yuvj420p',
                    '-q:v', '2',
                    thumbPath
                ], workDir);
                result.thumbnailFile = thumbPath;
                console.log(`Job ${job.id}: Thumbnail generated.`);
            } catch (e) {
                console.warn(`Job ${job.id}: Thumbnail failed: ${e.message}`);
            }
        }

        return result;
    },

    /**
     * Build transition chain using xfade filters
     * If no transition specified for a clip, falls back to simple concat
     */
    buildTransitionChain(clips, filterComplex) {
        // Check if any clip has transitions
        const hasAnyTransition = clips.some(c => c.transition);

        if (!hasAnyTransition) {
            // Simple concat
            const labels = clips.map(c => c.label).join('');
            filterComplex.push(`${labels}concat=n=${clips.length}:v=1:a=0[vout]`);
            const totalDuration = clips.reduce((sum, c) => sum + c.effectiveDuration, 0);
            return { stream: '[vout]', duration: totalDuration };
        }

        // Pairwise xfade chain
        let currentStream = clips[0].label;
        let runningOffset = clips[0].effectiveDuration;

        for (let i = 1; i < clips.length; i++) {
            const clip = clips[i];
            const trans = clip.transition;
            const outLabel = `[vx${i}]`;

            if (trans && trans.type) {
                const type = XFADE_TYPES.includes(trans.type) ? trans.type : 'fade';
                const dur = trans.duration || 0.5;
                const offset = Math.max(0, runningOffset - dur);

                filterComplex.push(
                    `${currentStream}${clip.label}xfade=transition=${type}:duration=${dur}:offset=${offset}${outLabel}`
                );
                // Adjust running offset: previous accumulated time + this clip's duration - overlap
                runningOffset = offset + clip.effectiveDuration;
            } else {
                // No transition on this clip — simple concat pair
                filterComplex.push(
                    `${currentStream}${clip.label}concat=n=2:v=1:a=0${outLabel}`
                );
                runningOffset += clip.effectiveDuration;
            }

            currentStream = outLabel;
        }

        return { stream: currentStream, duration: runningOffset };
    },

    /**
     * Resolve named overlay positions to x:y coordinates
     */
    resolveOverlayPosition(position, margin, videoW, videoH) {
        const m = margin;
        const positions = {
            'top-left': { x: m, y: m },
            'top-center': { x: `(W-w)/2`, y: m },
            'top-right': { x: `W-w-${m}`, y: m },
            'center': { x: '(W-w)/2', y: '(H-h)/2' },
            'bottom-left': { x: m, y: `H-h-${m}` },
            'bottom-center': { x: '(W-w)/2', y: `H-h-${m}` },
            'bottom-right': { x: `W-w-${m}`, y: `H-h-${m}` }
        };
        return positions[position] || positions['top-right'];
    },

    async loadTemplate(templateId) {
        const defaults = {
            resolution: '1080x1920',
            fps: 30,
            music_volume: 0.15,
            text_style: 'basic',
            animation: 'slide_up',
            color_grade: null,
            audio_ducking: false,
            transitions: null
        };

        try {
            const templatePath = path.join(config.paths.templates, `${templateId}.json`);
            const content = await fs.readFile(templatePath, 'utf-8');
            const data = JSON.parse(content);
            console.log(`Template loaded: ${templateId}`);
            return { ...defaults, ...data };
        } catch (e) {
            console.warn(`Template "${templateId}" not found, using defaults.`);
            return defaults;
        }
    },

    async generateAssFile(subtitles, outputPath, template) {
        // Resolve base style - can be a name or a custom object
        // If the first subtitle has a custom style object, use that as the "Default" style for the file
        let styleSource = template.text_style || 'basic';
        if (subtitles[0] && subtitles[0].style) {
            styleSource = subtitles[0].style;
        }

        const styleConfig = TextStyles.getStyle(styleSource, template.subtitle_overrides);

        const animName = template.animation || 'slide_up';
        let animTags = '';
        if (AnimationPresets[animName]) {
            animTags = AnimationPresets[animName](500, template.resolution);
        }

        const [resW, resH] = template.resolution.split('x');
        const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${resW}\nPlayResY: ${resH}\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styleConfig}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;

        const events = subtitles.map(sub => {
            const start = this.formatTime(sub.start);
            const end = this.formatTime(sub.end);

            // Allow per-subtitle animation override
            const subAnim = sub.animation ? (AnimationPresets[sub.animation]?.(500, template.resolution) || animTags) : animTags;

            // Note: Currently we only support one 'Default' style per file for simplicity,
            // but we pick it up from sub.style if provided.
            return `Dialogue: 0,${start},${end},Default,,0,0,0,,${subAnim}${sub.text}`;
        }).join('\n');

        await fs.writeFile(outputPath, '\ufeff' + header + events);
    },

    formatTime(seconds) {
        const pad = (num, size) => ('000' + num).slice(size * -1);
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const cc = Math.floor(((seconds % 1) * 100));
        return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cc, 2)}`;
    },

    applyTemplateVariables(template, variables) {
        if (!variables) return template;
        const jsonStr = JSON.stringify(template);
        const processedStr = jsonStr.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            return variables[key] !== undefined ? variables[key] : match;
        });
        return JSON.parse(processedStr);
    }
};
