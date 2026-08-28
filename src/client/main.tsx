import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/tokens.css';
import './styles/grid.css';
import './styles/panels.css';

/**
 * Development affordance: `?preview=4096x2160` letterboxes the layout at the real
 * panel's aspect ratio inside an ordinary browser window, so the 4K board can be
 * worked on without the television. Any WxH works.
 */
function applyPreview() {
  const preview = new URLSearchParams(window.location.search).get('preview');
  if (!preview) return;
  const match = /^(\d+)x(\d+)$/.exec(preview);
  if (!match) return;

  const width = Number(match[1]);
  const height = Number(match[2]);
  const scale = Math.min(window.innerWidth / width, window.innerHeight / height);

  const root = document.getElementById('root')!;
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  root.style.transform = `scale(${scale})`;
  root.style.transformOrigin = 'top left';
  document.body.style.display = 'grid';
  document.body.style.placeItems = 'start center';
  document.body.style.background = '#000';
}

applyPreview();
window.addEventListener('resize', applyPreview);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
