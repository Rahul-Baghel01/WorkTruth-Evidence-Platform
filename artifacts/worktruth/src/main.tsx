import { createRoot } from 'react-dom/client';
import { setBaseUrl } from '@workspace/api-client-react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

// Local development: VITE_API_BASE_URL is unset, so every API call stays a
// relative `/api/...` path and the Vite dev-server proxy forwards it to the
// local API (see vite.config.ts). Production: set VITE_API_BASE_URL to the
// deployed API origin (e.g. https://worktruth-api.onrender.com) at build
// time and calls are sent there directly. This is a public URL, not a
// secret — never put credentials or tokens in a VITE_* variable, since the
// whole set is inlined into the client bundle.
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
if (apiBaseUrl) {
  setBaseUrl(apiBaseUrl.replace(/\/+$/, ''));
}

createRoot(document.getElementById('root')!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
