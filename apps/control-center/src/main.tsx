import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function App() {
  return (
    <main className="shell">
      <section className="panel">
        <p className="eyebrow">AxorOS · Phase 6</p>
        <h1>Control Center foundation is running.</h1>
        <p>
          Agent logic is intentionally disabled until the backend, state,
          secrets, observability, knowledge service, and agent runtime are built.
        </p>
        <dl>
          <div><dt>Environment</dt><dd>Development</dd></div>
          <div><dt>Current step</dt><dd>Build Environment and Repository Setup</dd></div>
          <div><dt>Agent runtime</dt><dd>Not yet enabled</dd></div>
        </dl>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
