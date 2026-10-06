import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import 'leaflet/dist/leaflet.css';
import 'vazirmatn/Vazirmatn-font-face.css';
import 'vazirmatn/Round-Dots/Vazirmatn-RD-font-face.css';
import './index.css';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
