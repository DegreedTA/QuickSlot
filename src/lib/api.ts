import { createSupabaseApi } from './supabaseApi';
import { createDemoApi } from './demoApi';
import type { Api } from './types';

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const api: Api = url && key ? createSupabaseApi(url, key) : createDemoApi();
export const isDemo = api.mode === 'demo';
