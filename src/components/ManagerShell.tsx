import { useState, type FormEvent, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { LinkSimple, SignOut } from '@phosphor-icons/react';
import { BrandMark } from './Brand';
import { useSession } from '../lib/session';
import { ApiError } from '../lib/types';
import { isDemo } from '../lib/api';
import { DEMO_PASSCODE } from '../lib/demoApi';

/** Shows the passcode screen until a recruiter signs in, then the rail + content. */
export function ManagerShell({ children }: { children: ReactNode }) {
  const { passcode, signOut } = useSession();
  if (!passcode) return <Login />;
  return (
    <div className="shell">
      <aside className="rail" aria-label="QuickSlot">
        <a className="brand" href="/">
          <BrandMark size={28} />
          QuickSlot
        </a>
        <nav className="nav" aria-label="Main">
          <NavLink to="/" end>
            <LinkSimple size={18} aria-hidden />
            Links
          </NavLink>
        </nav>
        <div className="rail-foot">
          {isDemo && <p className="rail-note">Demo mode</p>}
          <button type="button" onClick={signOut}>
            <SignOut size={18} aria-hidden />
            Sign out
          </button>
        </div>
      </aside>
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}

function Login() {
  const { signIn } = useSession();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!value) {
      setError('Enter the recruiter passcode.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(value);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'unknown';
      setError(
        code === 'bad_passcode'
          ? 'Wrong passcode.'
          : code === 'too_many_attempts'
            ? 'Too many attempts. Try again in 10 minutes.'
            : code === 'network'
              ? 'No connection.'
              : 'Something went wrong.',
      );
      setBusy(false);
    }
  }

  return (
    <div className="gate">
      <div className="gate-side">
        <span className="brand" style={{ padding: 0 }}>
          <BrandMark size={28} />
          QuickSlot
        </span>
        <div>
          <h1 style={{ color: 'var(--text-on-dark)', fontSize: 'var(--t-2xl)', marginBottom: 12 }}>Interview availability, in one link.</h1>
        </div>
      </div>
      <main className="gate-main" id="main">
        <form className="gate-form" onSubmit={submit} noValidate>
          <div>
            <h2 style={{ fontSize: 'var(--t-xl)' }}>Recruiter sign in</h2>
          </div>
          {isDemo && (
            <p className="notice">
              Demo mode. Passcode: <code>{DEMO_PASSCODE}</code>
            </p>
          )}
          <div className="field">
            <label htmlFor="passcode">Recruiter passcode</label>
            <input
              id="passcode"
              className="input"
              type="password"
              name="passcode"
              autoComplete="current-password"
              autoFocus
              value={value}
              aria-invalid={!!error}
              aria-describedby={error ? 'passcode-error' : undefined}
              onChange={(e) => setValue(e.target.value)}
            />
            {error && (
              <p id="passcode-error" className="error" role="alert">
                {error}
              </p>
            )}
          </div>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Checking...' : 'Sign in'}
          </button>
        </form>
      </main>
    </div>
  );
}
