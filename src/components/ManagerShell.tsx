import { useState, type FormEvent, type ReactNode } from 'react';
import { BrandMark } from './Brand';
import { useSession } from '../lib/session';
import { ApiError } from '../lib/types';
import { isDemo } from '../lib/api';
import { DEMO_PASSCODE } from '../lib/demoApi';
import { Badge, Button } from './ui';

/** Shows the passcode screen until a recruiter signs in, then the top bar + content. */
export function ManagerShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { session, signOut } = useSession();
  if (!session) return <Login />;
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-brand">
          <a href="/">QuickSlot</a>
          {isDemo && <Badge>Demo mode</Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </header>
      <main className={`app-main${wide ? ' app-main--wide' : ''}`} id="main">
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
