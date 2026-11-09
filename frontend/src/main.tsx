import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'vazirmatn/Vazirmatn-Variable-font-face.css';
import './styles/global.css';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { ThemeProvider } from './lib/theme';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
);
