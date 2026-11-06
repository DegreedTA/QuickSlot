export interface SuggestedSlot {
  /** ISO instant */
  start: string;
  minutes: number;
}

export interface CandidateLinkData {
  status: 'ok';
  token: string;
  timezone: string;
  slots: string[];
  suggested_slots: SuggestedSlot[];
  suggested_slots_timezone: string | null;
  ranked_choices: string[];
  updated_at: string;
  expires_at: string;
}

export type CandidateResult = CandidateLinkData | { status: 'expired' } | { status: 'not_found' };

export interface LinkRow {
  token: string;
  label: string;
  batch_id: string | null;
  created_at: string;
  expires_at: string;
  updated_at: string;
  is_active: boolean;
  slot_count: number;
  next_slot: string | null;
  has_unseen_change: boolean;
  suggested_count: number;
  ranked_count: number;
  timezone: string;
}

export interface Overview {
  active: number;
  total: number;
  links: LinkRow[];
}

export interface BatchMate {
  token: string;
  label: string;
}

export interface ManagerLinkData extends Omit<CandidateLinkData, 'status'> {
  status: 'ok' | 'expired';
  label: string;
  batch_id: string | null;
  batch: BatchMate[];
  created_at: string;
}

export type ManagerLinkResult = ManagerLinkData | { status: 'not_found' };

export interface CreatedLinks {
  batch_id: string | null;
  links: BatchMate[];
}

export type ApiErrorCode = 'bad_passcode' | 'too_many_attempts' | 'bad_timezone' | 'link_unavailable' | 'network' | 'unknown';

export class ApiError extends Error {
  code: ApiErrorCode;
  constructor(code: ApiErrorCode, message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface Api {
  mode: 'supabase' | 'demo';
  // candidate
  getLink(token: string): Promise<CandidateResult>;
  setAvailability(token: string, slots: string[], timezone: string): Promise<string>;
  setRanked(token: string, choices: string[]): Promise<string>;
  // recruiter (every call carries the shared passcode)
  managerCheck(passcode: string): Promise<void>;
  managerOverview(passcode: string): Promise<Overview>;
  managerCreate(passcode: string, count: number, labels: string[]): Promise<CreatedLinks>;
  managerGetLink(passcode: string, token: string, markSeen: boolean): Promise<ManagerLinkResult>;
  managerSetLabel(passcode: string, token: string, label: string): Promise<void>;
  managerSetSuggestions(passcode: string, tokens: string[], slots: SuggestedSlot[], timezone: string): Promise<number>;
  managerDeactivate(passcode: string, token: string, wholeBatch: boolean): Promise<number>;
}
