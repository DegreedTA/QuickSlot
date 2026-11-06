import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from './api';
import { ApiError } from './types';
import { browserZone } from './time';

// The recruiter passcode lives in sessionStorage only: it is gone when the tab closes.
const PASS_KEY = 'quickslot-recruiter-passcode';
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

interface Session {
  passcode: string | null;
  zone: string;
  setZone: (z: string) => void;
  signIn: (passcode: string) => Promise<void>;
  signOut: () => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [passcode, setPasscode] = useState<string | null>(() => read(globalThis.sessionStorage, PASS_KEY));
  const [zone, setZoneState] = useState<string>(() => read(globalThis.localStorage, ZONE_KEY) ?? browserZone());

  const signIn = useCallback(async (p: string) => {
    await api.managerCheck(p); // throws ApiError on a wrong passcode
    write(globalThis.sessionStorage, PASS_KEY, p);
    setPasscode(p);
  }, []);

  const signOut = useCallback(() => {
    write(globalThis.sessionStorage, PASS_KEY, null);
    setPasscode(null);
  }, []);

  const setZone = useCallback((z: string) => {
    write(globalThis.localStorage, ZONE_KEY, z);
    setZoneState(z);
  }, []);

  const value = useMemo(() => ({ passcode, zone, setZone, signIn, signOut }), [passcode, zone, setZone, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** Calls a recruiter API function; if the saved passcode stopped working, signs out. */
export function useManagerCall() {
  const { passcode, signOut } = useSession();
  return useCallback(
    async <T,>(fn: (passcode: string) => Promise<T>): Promise<T> => {
      if (!passcode) throw new ApiError('bad_passcode');
      try {
        return await fn(passcode);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'bad_passcode') signOut();
        throw e;
      }
    },
    [passcode, signOut],
  );
}
