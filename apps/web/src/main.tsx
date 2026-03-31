import React from 'react';
import ReactDOM from 'react-dom/client';
import { init as initPlausible } from '@plausible-analytics/tracker';

import { App } from './App';
import './styles.css';

initPlausible({
  domain: 'https://app.wykra.io/',
  autoCapturePageviews: true,
  outboundLinks: true,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
