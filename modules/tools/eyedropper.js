import { store } from "../core/store.js";
import { composeProjectToCanvas } from "../io/importExport.js";

function getCanvas(){ return document.getElementById('workspace-canvas'); }

function getWorldPointFromEvent(event){
  const canvas = getCanvas(); if (!canvas) return { x: 0, y: 0 };
  const vp = store.getState().viewport || {};
  const zoom = Math.min(Math.max(vp.zoom ?? 1, vp.minZoom ?? 0.1), vp.maxZoom ?? 8);
  const workspaceWidth = vp.size?.width || canvas.clientWidth || 1;
  const workspaceHeight = vp.size?.height || canvas.clientHeight || 1;
  const pan = vp.pan || { x: 0, y: 0 };
  const baseX = (canvas.clientWidth - workspaceWidth * zoom) / 2;
  const baseY = (canvas.clientHeight - workspaceHeight * zoom) / 2;
  const translateX = baseX + pan.x;
  const translateY = baseY + pan.y;
  const offsetX = typeof event.offsetX === 'number' ? event.offsetX : event.clientX - canvas.getBoundingClientRect().left;
  const offsetY = typeof event.offsetY === 'number' ? event.offsetY : event.clientY - canvas.getBoundingClientRect().top;
  const worldX = (offsetX - translateX) / zoom;
  const worldY = (offsetY - translateY) / zoom;
  return { x: Math.max(0, Math.floor(worldX)), y: Math.max(0, Math.floor(worldY)) };
}

function rgbToHex(r,g,b){ const to = (n)=> Math.max(0, Math.min(255, n)).toString(16).padStart(2,'0'); return `#${to(r)}${to(g)}${to(b)}`; }

export function createEyedropperTool(){
  let active=false;
  async function sampleAt(e){
    try {
      const p = getWorldPointFromEvent(e);
      const canvas = composeProjectToCanvas({ scale: 1 });
      const ctx = canvas.getContext('2d');
      const img = ctx.getImageData(Math.min(canvas.width-1, p.x), Math.min(canvas.height-1, p.y), 1, 1);
      const [r,g,b,a] = img.data;
      const hex = rgbToHex(r,g,b);
      const opacity = Math.round((a/255)*100);
      store.updateSlice('ui', (ui)=> ({ ...ui, color: { ...(ui?.color||{}), hex, opacity: opacity/100 } }), { reason: 'ui:eyedropper' });
    } catch (err) {
      // ignore
    }
  }
  function onPointerDown(e){ if (!active) return; sampleAt(e); }
  function attach(){ const c=getCanvas(); if (!c) return; c.addEventListener('pointerdown', onPointerDown); }
  function detach(){ const c=getCanvas(); if (!c) return; c.removeEventListener('pointerdown', onPointerDown); }
  return {
    id: 'eyedropper', label: 'Eyedropper', cursor: 'crosshair',
    getDefaultOptions(){ return {}; }, normalizeOptions(n={}){ return { ...n }; },
    onActivate(){ active=true; attach(); }, onDeactivate(){ active=false; detach(); }, destroy(){ detach(); },
    getPublicApi(){ return Object.freeze({ id: 'eyedropper', label: 'Eyedropper' }); }
  };
}
