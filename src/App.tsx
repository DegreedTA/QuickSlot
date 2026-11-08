import { Route, Routes, Link } from 'react-router-dom';
import Candidate from './pages/Candidate';
import Manager from './pages/Manager';
import LinkDetail from './pages/LinkDetail';
import UiKit from './pages/UiKit';

export function App() {
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Routes>
        {import.meta.env.DEV && <Route path="/__ui" element={<UiKit />} />}
        <Route path="/" element={<Manager />} />
        <Route path="/:token/recruiter" element={<LinkDetail />} />
        <Route path="/:token" element={<Candidate />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

function NotFound() {
  return (
    <div className="state-page">
      <div className="state-card">
        <h1 style={{ fontSize: 'var(--t-xl)' }}>Page not found</h1>
        <p>This address does not lead anywhere. If you were sent a link, ask your recruiter to resend it.</p>
        <Link to="/">Go to the start page</Link>
      </div>
    </div>
  );
}
