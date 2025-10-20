import { createGLCanvas, createProgram, createTextureFromCanvas, drawFullScreenQuad } from './util.js';
import { VERT, FRAG_INVERT, FRAG_GRAYSCALE, FRAG_BASE } from './shaders.js';

export function isWebGLAvailable(){
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch (_) { return false; }
}

function resolveShaderForType(type){
  switch (String(type||'').toLowerCase()){
    case 'invert': return FRAG_INVERT;
    case 'grayscale': return FRAG_GRAYSCALE;
    default: return null;
  }
}

export function applyFilterWithWebGL(sourceCanvas, type, params={}){
  const frag = resolveShaderForType(type);
  if (!frag) return null; // Not supported here
  const width = sourceCanvas.width|0; const height = sourceCanvas.height|0;
  const { canvas, gl } = createGLCanvas(width, height);
  if (!gl) return null;
  try {
    const program = createProgram(gl, VERT, frag);
    gl.useProgram(program);

    const buffer = drawFullScreenQuad(gl);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    const aUv = gl.getAttribLocation(program, 'a_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    const tex = createTextureFromCanvas(gl, sourceCanvas);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const uTex = gl.getUniformLocation(program, 'u_tex');
    gl.uniform1i(uTex, 0);

    gl.viewport(0, 0, width, height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    return canvas;
  } catch (e) {
    try { console.warn('[gl] Filter fell back to 2D path:', e && e.message ? e.message : e); } catch (_) {}
    return null;
  }
}

// Convenience wrapper for filters to attempt GL and fall back if null
export function tryApplyGL(sourceCanvas, type, params){
  if (!isWebGLAvailable()) return null;
  return applyFilterWithWebGL(sourceCanvas, type, params) || null;
}
