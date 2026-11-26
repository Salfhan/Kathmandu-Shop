import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../migration-source/src/App';
import '../migration-source/src/index.css';
import './supabaseApi';
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
