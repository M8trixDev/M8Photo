import { getShortcutMap, setShortcutMap, detectConflicts, getDefaultShortcutMap } from "./shortcuts.js";

function createEl(tag, attrs={}, html) { const el=document.createElement(tag); Object.keys(attrs||{}).forEach((k)=>{ if(k==='class'){el.className=attrs[k];return;} if(attrs[k]===false||attrs[k]===null||attrs[k]===undefined) return; el.setAttribute(k, String(attrs[k])); }); if(html!==undefined) el.innerHTML=String(html); return el; }

const ACTION_LABELS = {
  "tool.move": "Move",
  "tool.select.marquee": "Marquee",
  "tool.select.lasso": "Lasso",
  "tool.crop": "Crop",
  "tool.brush": "Brush",
  "tool.eraser": "Eraser",
  "tool.fill": "Fill",
  "tool.text": "Text",
  "tool.shape": "Shape",
  "tool.eyedropper": "Eyedropper",
  "tool.hand": "Hand",
  "tool.zoom": "Zoom",
};

export function openShortcutsEditor() {
  const overlay = createEl('div', { class: 'm8-shortcuts-overlay' });
  const modal = createEl('div', { class: 'm8-shortcuts-modal' });
  overlay.appendChild(modal);
  const header = createEl('div', { class: 'm8-shortcuts-header' }, '<strong>Shortcuts</strong>');
  const body = createEl('div', { class: 'm8-shortcuts-body' });
  const footer = createEl('div', { class: 'm8-shortcuts-footer' });
  const resetBtn = createEl('button', { type: 'button', class: 'btn' }, 'Reset');
  const closeBtn = createEl('button', { type: 'button', class: 'btn btn-primary' }, 'Close');
  footer.appendChild(resetBtn); footer.appendChild(closeBtn);
  modal.appendChild(header); modal.appendChild(body); modal.appendChild(footer);

  const style = createEl('style', { });
  style.textContent = `
    .m8-shortcuts-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);backdrop-filter:blur(4px);display:grid;place-items:center;z-index:9999}
    .m8-shortcuts-modal{min-width: min(720px, 92vw);max-width: 92vw;background: var(--color-surface-raised);color:var(--color-text-primary);border:1px solid var(--color-border);border-radius:12px;box-shadow: var(--shadow-soft);display:grid;grid-template-rows:auto 1fr auto}
    .m8-shortcuts-header{padding:.85rem 1rem;border-bottom:1px solid var(--color-border);}
    .m8-shortcuts-body{padding:.75rem 1rem;display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:center;max-height:60vh;overflow:auto}
    .m8-shortcuts-footer{padding:.75rem 1rem;border-top:1px solid var(--color-border);display:flex;justify-content:space-between}
    .m8-shortcut-row{display:contents}
    .m8-shortcut-label{color:var(--color-text-secondary)}
    .m8-shortcut-key{min-width:100px;justify-self:end}
    .m8-shortcut-key button{min-width:100px}
    .m8-capture{outline:2px solid var(--color-accent);}
    .m8-conflict{color:#e9b35d;font-size:.85rem;grid-column:1/-1}
  `;
  document.head.appendChild(style);

  const render = () => {
    body.innerHTML = '';
    const map = getShortcutMap();
    const conflicts = detectConflicts(map);
    Object.keys(ACTION_LABELS).forEach((action)=>{
      const row = createEl('div', { class: 'm8-shortcut-row' });
      const label = createEl('div', { class: 'm8-shortcut-label' }, ACTION_LABELS[action]);
      const keyCell = createEl('div', { class: 'm8-shortcut-key' });
      const btn = createEl('button', { type: 'button', class: 'btn' }, (map[action] || '').toUpperCase() || '—');
      btn.addEventListener('click', ()=> startCapture(action, btn));
      keyCell.appendChild(btn);
      row.appendChild(label); row.appendChild(keyCell);
      body.appendChild(row);
    });
    if (conflicts.length) {
      const c = createEl('div', { class: 'm8-conflict' }, `Conflicts: ${conflicts.map(pair => pair.join(' vs ')).join(', ')}`);
      body.appendChild(c);
    }
  };

  let capturing = null;
  function startCapture(action, btn){
    if (capturing) return; capturing = { action, btn };
    btn.classList.add('m8-capture'); btn.textContent = 'Press key…';
    const onKey = (e)=>{
      e.preventDefault(); e.stopPropagation();
      const key = (e.key||'').toLowerCase();
      if (!key || key.length !== 1 || !/[a-z0-9]/.test(key)) { cancel(); return; }
      const map = getShortcutMap(); map[action] = key; setShortcutMap(map);
      stop(); render();
    };
    const cancel = ()=>{ stop(); render(); };
    const stop = ()=>{ btn.classList.remove('m8-capture'); window.removeEventListener('keydown', onKey, true); window.removeEventListener('click', cancel, true); capturing=null; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('click', cancel, true);
  }

  resetBtn.addEventListener('click', ()=>{ setShortcutMap(getDefaultShortcutMap()); render(); });
  closeBtn.addEventListener('click', ()=>{ overlay.remove(); style.remove(); });
  overlay.addEventListener('click', (e)=>{ if (e.target === overlay) { overlay.remove(); style.remove(); } });

  document.body.appendChild(overlay);
  render();
}
