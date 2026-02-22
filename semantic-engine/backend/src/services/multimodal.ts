import axios from "axios";
import { env } from "../config/env";
import { createLogger } from "../utils/logger";

const log = createLogger("multimodal");

/**
 * A single semantic chunk extracted from a file.
 */
export interface SemanticChunk {
    text: string;
    start: number | null;  // start time in seconds (video/audio) or null
    end: number | null;    // end time in seconds (video/audio) or null
    page: number | null;   // page number (PDF/document) or null
    confidence: number;
}

/**
 * System prompt that instructs the model to output structured JSON
 * suitable for vector embedding and semantic search.
 */
const SYSTEM_PROMPT = `You are a video/file metadata extractor for a Vector Database.
Your task is to analyze the provided content and output ONLY a valid JSON object.
This JSON will be embedded for semantic search.
Ensure the descriptions are detailed enough for a vector database to find specific moments.`;

/**
 * User prompt that defines the desired JSON output schema.
 * The model returns semantic_segments with timestamps for video/audio,
 * or page numbers for documents.
 */
const USER_PROMPT = `Analyze this content and output a JSON object with this exact structure:
{
  "video_metadata": {
    "title": "String",
    "global_summary": "Detailed summary of the whole content",
    "primary_category": "e.g. Cooking, Tutorial, Educational",
    "overall_mood": "String"
  },
  "semantic_segments": [
    {
      "start_time": 0,
      "end_time": 10,
      "description": "Very detailed description of what is happening in this specific segment",
      "tags": ["keyword1", "keyword2"],
      "visual_elements": ["object1", "object2"]
    }
  ]
}`;

/**
 * Raw response shape from the Sumopod chat completions API.
 */
interface ChatCompletionResponse {
    choices: Array<{
        message: {
            content: string;
        };
    }>;
}

/**
 * Parsed JSON structure returned by the model.
 */
interface ExtractionResult {
    video_metadata?: {
        title?: string;
        global_summary?: string;
        primary_category?: string;
        overall_mood?: string;
    };
    semantic_segments?: Array<{
        start_time?: number;
        end_time?: number;
        description?: string;
        tags?: string[];
        visual_elements?: string[];
    }>;
}

/**
 * Send a file to the Sumopod OpenAI-compatible chat completions API
 * for multimodal analysis, and receive semantic chunks.
 *
 * Uses the video_url content type to pass the file URL to the vision model.
 * The model returns structured JSON with semantic segments.
 *
 * @param fileUrl  - Publicly accessible URL of the file to analyse
 * @param fileType - MIME type hint (e.g. "video/mp4", "image/png", "application/pdf")
 * @returns Array of extracted semantic chunks
 */
export async function extractChunks(fileUrl: string, fileType?: string): Promise<SemanticChunk[]> {
    log.info("Extracting semantic chunks via chat completions", { fileUrl, fileType });

    try {
        // ── Build multimodal content based on file type ────────────
        const contentParts: Array<Record<string, unknown>> = [
            { type: "text", text: USER_PROMPT },
        ];

        // Use the appropriate content type for the file
        if (fileType?.startsWith("image/")) {
            contentParts.push({
                type: "image_url",
                image_url: { url: fileUrl },
            });
        } else {
            // Default to video_url for video, audio, and other file types
            contentParts.push({
                type: "video_url",
                video_url: { url: fileUrl },
            });
        }

        // ── Call the chat completions API ──────────────────────────
        const response = await axios.post<ChatCompletionResponse>(
            env.MULTIMODAL_API_URL,
            {
                model: env.MULTIMODAL_MODEL,
                messages: [
                    { role: "system", content: SYSTEM_PROMPT },
                    { role: "user", content: contentParts },
                ],
                max_tokens: 4096,
                response_format: { type: "json_object" },
            },
            {
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${env.MULTIMODAL_API_KEY}`,
                },
                timeout: 300_000, // 5 minutes — vision analysis can be slow
            }
        );

        // ── Parse the structured JSON from the model response ─────
        const rawContent = response.data.choices?.[0]?.message?.content;

        if (!rawContent) {
            throw new Error("Chat completions returned empty content");
        }

        const parsed: ExtractionResult = JSON.parse(rawContent);
        const segments = parsed.semantic_segments || [];

        // ── Map segments to our SemanticChunk format ───────────────
        const chunks: SemanticChunk[] = segments.map((seg) => ({
            text: [
                seg.description || "",
                seg.tags?.length ? `Tags: ${seg.tags.join(", ")}` : "",
                seg.visual_elements?.length ? `Visual: ${seg.visual_elements.join(", ")}` : "",
            ]
                .filter(Boolean)
                .join(" | "),
            start: seg.start_time ?? null,
            end: seg.end_time ?? null,
            page: null,
            confidence: 1.0,
        }));

        // ── Optionally add a global summary chunk ─────────────────
        if (parsed.video_metadata?.global_summary) {
            const meta = parsed.video_metadata;
            chunks.unshift({
                text: [
                    `[SUMMARY] ${meta.global_summary}`,
                    meta.title ? `Title: ${meta.title}` : "",
                    meta.primary_category ? `Category: ${meta.primary_category}` : "",
                    meta.overall_mood ? `Mood: ${meta.overall_mood}` : "",
                ]
                    .filter(Boolean)
                    .join(" | "),
                start: null,
                end: null,
                page: null,
                confidence: 1.0,
            });
        }

        log.info("Chunks extracted", { count: chunks.length });
        return chunks;
    } catch (err) {
        log.error("Multimodal extraction failed", { error: String(err) });
        throw err;
    }
}
