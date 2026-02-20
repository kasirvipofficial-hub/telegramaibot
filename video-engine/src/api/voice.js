
import KieVoice from '../modules/voice/kie.js';

export default async function voiceRoutes(fastify, opts) {
    /**
     * Standalone voice-over generation API
     * POST /api/generate-vo
     */
    fastify.post('/api/generate-vo', async (request, reply) => {
        try {
            const body = request.body;

            if (!body || !body.text) {
                return reply.code(400).send({
                    code: 400,
                    message: 'Missing "text" parameter in request body'
                });
            }

            // Enforce text length limit
            if (body.text.length > 5000) {
                return reply.code(400).send({
                    code: 400,
                    message: 'Text exceeds 5000 character limit'
                });
            }

            console.log(`[API] TTS request: "${body.text.substring(0, 50)}..."`);
            const result = await KieVoice.generateVoiceOver(body);
            console.log(`[API] TTS success: ${result.taskId}`);

            return {
                code: 200,
                message: 'success',
                data: result
            };
        } catch (err) {
            console.error(`[API] TTS error: ${err.message}`);
            return reply.code(500).send({
                code: 500,
                message: err.message || 'Internal Server Error'
            });
        }
    });
}
