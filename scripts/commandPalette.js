import { tools } from "../modules/tools/index.js";
import { store } from "../modules/core/store.js";
import { eventBus } from "../modules/core/events.js";
import { openImportDialog, openExportDialog } from "../modules/io/importExport.js";

function setViewport(partial, reason) {
  store.updateSlice("viewport", (vp) => ({ ...vp, ...partial }), { reason: reason || "command-palette" });
}

const COMMANDS = [
  { id: 'tool.move', label: 'Tool: Move', run: ()=> tools.setActive('move', { source: 'cmdk' }) },
  { id: 'tool.select.marquee', label: 'Tool: Marquee', run: ()=> { tools.setActive('select', { source: 'cmdk' }); try { tools.updateOptions('select', { lassoMode: 'rect' }, { source: 'cmdk' }); } catch(_){} } },
  { id: 'tool.select.lasso', label: 'Tool: Lasso', run: ()=> { tools.setActive('select', { source: 'cmdk' }); try { tools.updateOptions('select', { lassoMode: 'lasso' }, { source: 'cmdk' }); } catch(_){} } },
  { id: 'tool.crop', label: 'Tool: Crop', run: ()=> tools.setActive('crop', { source: 'cmdk' }) },
  { id: 'tool.brush', label: 'Tool: Brush', run: ()=> tools.setActive('brush', { source: 'cmdk' }) },
  { id: 'tool.eraser', label: 'Tool: Eraser', run: ()=> tools.setActive('eraser', { source: 'cmdk' }) },
  { id: 'tool.fill', label: 'Tool: Fill', run: ()=> tools.setActive('fill', { source: 'cmdk' }) },
  { id: 'tool.text', label: 'Tool: Text', run: ()=> tools.setActive('text', { source: 'cmdk' }) },
  { id: 'tool.shape', label: 'Tool: Shape', run: ()=> tools.setActive('shape', { source: 'cmdk' }) },
  { id: 'tool.eyedropper', label: 'Tool: Eyedropper', run: ()=> tools.setActive('eyedropper', { source: 'cmdk' }) },
  { id: 'tool.hand', label: 'Tool: Hand', run: ()=> tools.setActive('hand', { source: 'cmdk' }) },
  { id: 'tool.zoom', label: 'Tool: Zoom', run: ()=> tools.setActive('zoom', { source: 'cmdk' }) },
  { id: 'view.zoomIn', label: 'View: Zoom In', run: ()=> setViewport({ zoom: (store.getState().viewport?.zoom??1) * 1.1 }, 'viewport:zoom-in') },
  { id: 'view.zoomOut', label: 'View: Zoom Out', run: ()=> setViewport({ zoom: (store.getState().viewport?.zoom??1) / 1.1 }, 'viewport:zoom-out') },
  { id: 'view.resetZoom', label: 'View: Actual Size', run: ()=> setViewport({ zoom: 1, pan: { x: 0, y: 0 } }, 'viewport:reset') },
  { id: 'view.toggleGrid', label: 'View: Toggle Grid', run: ()=>{ const g = store.getState().viewport?.grid; const visible = g ? g.visible !== false : true; setViewport({ grid: { ...(g||{}), visible: !visible } }, 'viewport:grid-toggle'); if(eventBus) eventBus.emit('viewport:grid-toggle', { visible: !visible, source: 'cmdk' }); } },
  { id: 'file.import', label: 'File: Import…', run: ()=> openImportDialog().catch(()=>{}) },
  { id: 'file.export', label: 'File: Export…', run: ()=> openExportDialog().catch(()=>{}) },
];

function filterCommands(query){
  const q = (query||'').trim().toLowerCase();
  if (!q) return COMMANDS.slice(0, 20);
  return COMMANDS.filter(c => c.label.toLowerCase().includes(q)).slice(0, 20);
}

export function initCommandPalette(){
  const overlay = document.createElement('div');
  overlay.className = 'm8-cmdk-overlay';
  overlay.innerHTML = `
    <div class="m8-cmdk-modal" role="dialog" aria-modal="true" aria-label="Command Palette">
      <div class="m8-cmdk-input-row">
        <input type="text" class="m8-cmdk-input" placeholder="Type a command…" aria-label="Command" />
      </div>
      <div class="m8-cmdk-list" role="listbox"></div>
    </div>
  `;
  const style = document.createElement('style');
  style.textContent = `
    .m8-cmdk-overlay{position:fixed;inset:0;display:none;place-items:center;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);z-index:9999}
    .m8-cmdk-overlay.is-open{display:grid}
    .m8-cmdk-modal{min-width:min(720px,92vw);max-width:92vw;background:var(--color-surface-raised);color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:12px;box-shadow:var(--shadow-soft);}
    .m8-cmdk-input-row{padding:.6rem .75rem;border-bottom:1px solid var(--color-border)}
    .m8-cmdk-input{width:100%;background:var(--color-surface);color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:8px;padding:.55rem .65rem}
    .m8-cmdk-list{max-height:60vh;overflow:auto;display:grid}
    .m8-cmdk-item{padding:.6rem .75rem;border-bottom:1px solid var(--color-border);cursor:pointer}
    .m8-cmdk-item:hover,.m8-cmdk-item[aria-selected="true"]{background:var(--color-accent-soft)}
  `;
  document.head.appendChild(style);
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.m8-cmdk-input');
  const list = overlay.querySelector('.m8-cmdk-list');

  function open(){ overlay.classList.add('is-open'); input.value=''; render(''); setTimeout(()=> input.focus(), 0); }
  function close(){ overlay.classList.remove('is-open'); }
  function render(q){
    const items = filterCommands(q);
    list.innerHTML = '';
    items.forEach((cmd, idx)=>{
      const el = document.createElement('div'); el.className = 'm8-cmdk-item'; el.setAttribute('role','option'); el.setAttribute('data-id', cmd.id); el.textContent = cmd.label; if (idx===0) el.setAttribute('aria-selected','true');
      el.addEventListener('click', ()=> { try{ cmd.run(); }catch(_){} close(); });
      list.appendChild(el);
    });
  }

  input.addEventListener('input', ()=> render(input.value));
  overlay.addEventListener('keydown', (e)=>{
    if (e.key==='Escape'){ e.preventDefault(); close(); return; }
    const active = list.querySelector('[aria-selected="true"]');
    const items = Array.from(list.querySelectorAll('.m8-cmdk-item'));
    let index = items.indexOf(active);
    if (e.key==='ArrowDown'){ e.preventDefault(); index = Math.min(items.length-1, index+1); items.forEach(i=>i.removeAttribute('aria-selected')); if(items[index]) items[index].setAttribute('aria-selected','true'); return; }
    if (e.key==='ArrowUp'){ e.preventDefault(); index = Math.max(0, index-1); items.forEach(i=>i.removeAttribute('aria-selected')); if(items[index]) items[index].setAttribute('aria-selected','true'); return; }
    if (e.key==='Enter'){ e.preventDefault(); const target = items[index] || items[0]; if (!target) return; const id = target.getAttribute('data-id'); const cmd = COMMANDS.find(c=>c.id===id); if (cmd) { try{ cmd.run(); }catch(_){} } close(); return; }
  });
  overlay.addEventListener('click', (e)=>{ if (e.target===overlay) close(); });

  // Keyboard shortcut to open
  window.addEventListener('keydown', (e)=>{
    const isMod = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
    if (isMod && (e.key==='k' || e.key==='K')) { e.preventDefault(); open(); }
  });

  try { window.M8PhotoCmdk = { open, close }; } catch (_) {}
  return { open, close };
}
