import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "../config/env";

/**
 * Singleton Supabase client.
 * Initialised lazily on first call to getSupabase().
 */
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
    if (!client) {
        client = createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    }
    return client;
}
