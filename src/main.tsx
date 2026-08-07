import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// A tab left open across a new deploy still has the OLD build's chunk
// filenames baked into its already-loaded JS — when it later tries a
// lazy import (e.g. opening the editor panel), that old filename no
// longer exists on the server and 404s into the SPA's index.html
// fallback, which throws as a "Failed to fetch dynamically imported
// module" MIME-type error. Vite fires this event for exactly that
// case; reloading fetches the current build instead of leaving the
// editor permanently broken until the visitor manually refreshes.
window.addEventListener('vite:preloadError', () => {
  window.location.reload();
});

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Keep app behavior unchanged if SW registration fails.
    });
  });
}
