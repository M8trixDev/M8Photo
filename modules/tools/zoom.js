import { store } from "../core/store.js";

const MIN_Z = 0.1; const MAX_Z = 8;
function clampZoom(value, minZoom, maxZoom){ const min = typeof minZoom==='number'&&!Number.isNaN(minZoom)?Math.max(minZoom,MIN_Z):MIN_Z; const max= typeof maxZoom==='number'&&!Number.isNaN(maxZoom)?Math.max(maxZoom,min):MAX_Z; const t= typeof value==='number'&&!Number.isNaN(value)?value:1; return Math.min(Math.max(t,min),max); }
function computeBaseOffset(canvasSize, workspaceSize, zoom){ const safeWorkspace=Math.max(1, workspaceSize); return (canvasSize - safeWorkspace * zoom) / 2; }
function getCanvas(){ return document.getElementById('workspace-canvas'); }

export function createZoomTool(){
  let active=false; let pointerId=null;
  function setZoomAt(zoomTarget, focus){
    const vp = store.getState().viewport || {};
    const clamped = clampZoom(zoomTarget, vp.minZoom, vp.maxZoom);
    const canvas = getCanvas(); if (!canvas) return;
    const canvasW = vp.canvas?.width || canvas.clientWidth || 1;
    const canvasH = vp.canvas?.height || canvas.clientHeight || 1;
    const workspaceWidth = vp.size?.width || canvasW || 1;
    const workspaceHeight = vp.size?.height || canvasH || 1;
    const pan = vp.pan || { x: 0, y: 0 };
    const currentZoom = clampZoom(vp.zoom ?? 1, vp.minZoom, vp.maxZoom);
    const baseXBefore = computeBaseOffset(canvasW, workspaceWidth, currentZoom);
    const baseYBefore = computeBaseOffset(canvasH, workspaceHeight, currentZoom);
    const worldX = (focus.x - (baseXBefore + pan.x)) / currentZoom;
    const worldY = (focus.y - (baseYBefore + pan.y)) / currentZoom;
    const baseXAfter = computeBaseOffset(canvasW, workspaceWidth, clamped);
    const baseYAfter = computeBaseOffset(canvasH, workspaceHeight, clamped);
    const nextPan = { x: focus.x - baseXAfter - worldX * clamped, y: focus.y - baseYAfter - worldY * clamped };
    store.updateSlice('viewport', (prev)=> ({ ...prev, zoom: clamped, pan: nextPan }), { reason: 'viewport:zoom', source: 'tool:zoom' });
  }
  function handlePointerDown(e){ if (!active) return; if (e.button!==0 && e.button!==2) return; const canvas=getCanvas(); if(!canvas) return; const rect=canvas.getBoundingClientRect(); const focus={ x: typeof e.offsetX==='number' ? e.offsetX : e.clientX - rect.left, y: typeof e.offsetY==='number' ? e.offsetY : e.clientY - rect.top }; const vp=store.getState().viewport||{}; const current=vp.zoom??1; const factor = (e.button===2 || e.altKey) ? 1/1.2 : 1.2; setZoomAt(current*factor, focus); }
  function attach(){ const canvas=getCanvas(); if (!canvas) return; canvas.addEventListener('pointerdown', handlePointerDown); }
  function detach(){ const canvas=getCanvas(); if (!canvas) return; canvas.removeEventListener('pointerdown', handlePointerDown); }
  return {
    id: 'zoom', label: 'Zoom', cursor: 'zoom-in',
    getDefaultOptions(){ return {}; }, normalizeOptions(next={}){ return { ...next }; },
    onActivate(){ active=true; attach(); }, onDeactivate(){ active=false; detach(); },
    destroy(){ detach(); },
    getPublicApi(){ return Object.freeze({ id: 'zoom', label: 'Zoom' }); }
  };
}
