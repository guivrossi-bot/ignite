// src/lib/supabaseClient.js
import { createClient } from '@supabase/supabase-js';

// Use Vite environment variables for both local and production
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
	// Warn in dev if missing
	console.warn('Supabase environment variables are missing! Check your .env file or deployment settings.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
