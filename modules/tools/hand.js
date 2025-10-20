export function createHandTool(ctx={}){
  let active=false;
  return {
    id: 'hand',
    label: 'Hand',
    cursor: 'grab',
    getDefaultOptions(){ return { } },
    normalizeOptions(next={}){ return { ...next }; },
    onActivate(){ active=true; },
    onDeactivate(){ active=false; },
    getPublicApi(){ return Object.freeze({ id: 'hand', label: 'Hand' }); },
  };
}
