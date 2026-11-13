import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { ApiError } from './types';
import { browserZone } from './time';

// After signing in with the shared passcode, the database returns a random session token.
// Only that token is kept in this browser (the passcode is never stored). The database expires
// it 30 days after its last use, so each visit renews it; "Sign out" deletes it there too.
const SESSION_KEY = 'quickslot-recruiter-session';
const OLD_PASS_KEY = 'quickslot-recruiter-passcode'; // earlier versions stored the passcode itself
const ZONE_KEY = 'quickslot-recruiter-zone';

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function write(storage: Storage | undefined, key: string, value: string | null) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* private mode: stay in memory */
  }
}

function readSession(): string | null {
  write(globalThis.localStorage, OLD_PASS_KEY, null);
  write(globalThis.sessionStorage, OLD_PASS_KEY, null);
  const raw = read(globalThis.localStorage, SESSION_KEY);
  if (raw && /^[0-9a-f]{64}$/.test(raw)) return raw;
  if (raw) write(globalThis.localStorage, SESSION_KEY, null);
  return null;
}

interface Session {
  session: string | null;
  zone: string;
  setZone: (z: string) => void;
  signIn: (passcode: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<string | null>(readSession);
  const [zone, setZoneState] = useState<string>(() => read(globalThis.localStorage, ZONE_KEY) ?? browserZone());

  const signIn = useCallback(async (passcode: string) => {
    const token = await api.managerLogin(passcode); // throws ApiError on a wrong passcode
    write(globalThis.localStorage, SESSION_KEY, token);
    setSession(token);
  }, []);

  const signOut = useCallback(() => {
    const token = read(globalThis.localStorage, SESSION_KEY);
    write(globalThis.localStorage, SESSION_KEY, null);
    setSession(null);
    if (token) api.managerLogout(token).catch(() => {}); // best effort: the token also expires by itself
  }, []);

  const setZone = useCallback((z: string) => {
    write(globalThis.localStorage, ZONE_KEY, z);
    setZoneState(z);
  }, []);

  const value = useMemo(() => ({ session, zone, setZone, signIn, signOut }), [session, zone, setZone, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Calls a recruiter API function; if the saved session stopped working, signs out. */
export function useManagerCall() {
  const { session, signOut } = useSession();
  return useCallback(
    async <T,>(fn: (session: string) => Promise<T>): Promise<T> => {
      if (!session) throw new ApiError('bad_passcode');
      try {
        return await fn(session);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'bad_passcode') signOut();
        throw e;
      }
    },
    [session, signOut],
  );
}
