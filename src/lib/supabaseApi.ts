import { createClient } from '@supabase/supabase-js';
import {
  ApiError,
  type Api,
  type ApiErrorCode,
  type CandidateResult,
  type CreatedLinks,
  type ManagerLinkResult,
  type Overview,
  type SuggestedSlot,
} from './types';

const KNOWN: ApiErrorCode[] = ['bad_passcode', 'too_many_attempts', 'bad_timezone', 'link_unavailable'];

function toError(e: unknown): ApiError {
  const msg = typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
  const hit = KNOWN.find((k) => msg.includes(k));
  if (hit) return new ApiError(hit);
  if (/fetch|network|failed to|load failed/i.test(msg)) return new ApiError('network', msg);
  return new ApiError('unknown', msg);
}

export function createSupabaseApi(url: string, anonKey: string): Api {
  const sb = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let res;
    try {
      res = await sb.rpc(fn, args);
    } catch (e) {
      throw toError(e);
    }
    if (res.error) throw toError(res.error);
    return res.data as T;
  }

  /** Recruiter functions answer { error } instead of raising so failed attempts are counted. */
  async function mgr<T extends object>(fn: string, args: Record<string, unknown>): Promise<T> {
    const data = await rpc<T & { error?: ApiErrorCode }>(fn, args);
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      throw new ApiError(KNOWN.includes(data.error) ? data.error : 'unknown');
    }
    return data;
  }

  return {
    mode: 'supabase',
    getLink: (token) => rpc<CandidateResult>('get_link', { p_token: token }),
    setAvailability: (token, slots, timezone, unavailableDays) =>
      rpc<string>('set_availability', {
        p_token: token,
        p_slots: slots,
        p_timezone: timezone,
        p_unavailable_days: unavailableDays,
      }),
    setRanked: (token, choices) => rpc<string>('set_ranked_choices', { p_token: token, p_choices: choices }),

    managerLogin: async (passcode) => {
      const r = await mgr<{ token: string }>('manager_login', { p_passcode: passcode });
      return r.token;
    },
    managerLogout: async (session) => {
      await mgr('manager_logout', { p_session: session });
    },
    managerOverview: (session) => mgr<Overview>('manager_overview', { p_session: session }),
    managerCreate: (session, count, labels) =>
      mgr<CreatedLinks>('manager_create_links', { p_session: session, p_count: count, p_labels: labels }),
    managerGetLink: (session, token, markSeen) =>
      mgr<ManagerLinkResult>('manager_get_link', { p_session: session, p_token: token, p_mark_seen: markSeen }),
    managerSetLabel: async (session, token, label) => {
      await mgr('manager_set_label', { p_session: session, p_token: token, p_label: label });
    },
    managerSetSuggestions: async (session, tokens, slots: SuggestedSlot[], timezone) => {
      const r = await mgr<{ changed: number }>('manager_set_suggestions', {
        p_session: session,
        p_tokens: tokens,
        p_slots: slots,
        p_timezone: timezone,
      });
      return r.changed;
    },
    managerDeactivate: async (session, token, wholeBatch) => {
      const r = await mgr<{ changed: number }>('manager_deactivate', {
        p_session: session,
        p_token: token,
        p_whole_batch: wholeBatch,
      });
      return r.changed;
    },
  };
}
