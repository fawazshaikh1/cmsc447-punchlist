import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { ServiceContainer } from './presentation/ServiceContainer';
import { ErrorBoundary, AppErrorFallback } from './presentation/components/ErrorBoundary';
import './index.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html.');

createRoot(container).render(
  <StrictMode>
    {/* Backstop for anything a per-marker boundary does not cover. Without it,
        React unmounts the entire tree on an uncaught render error and the user
        sees a blank page with no explanation and no way forward. */}
    <ErrorBoundary label="app" fallback={(error) => <AppErrorFallback error={error} />}>
      {/* The composition root. Swap implementations here and nowhere else. */}
      <ServiceContainer>
        <App />
      </ServiceContainer>
    </ErrorBoundary>
  </StrictMode>,
);
