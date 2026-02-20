
/**
 * API Key Authentication Middleware
 * 
 * Checks for API_KEY in Authorization header (Bearer token) or X-API-Key header.
 * If API_KEY is not set in .env, authentication is skipped (development mode).
 */
export default async function authMiddleware(request, reply) {
    // Skip auth for health check
    if (request.url === '/health') return;

    const apiKey = process.env.API_KEY;

    // If no API_KEY configured, skip auth (dev mode)
    if (!apiKey) return;

    const authHeader = request.headers['authorization'];
    const xApiKey = request.headers['x-api-key'];

    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
    } else if (xApiKey) {
        token = xApiKey;
    }

    if (token !== apiKey) {
        reply.code(401).send({
            code: 401,
            message: 'Unauthorized. Provide a valid API key via Authorization header (Bearer) or X-API-Key header.'
        });
        return reply;
    }
}
