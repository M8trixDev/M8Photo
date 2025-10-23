import { createGLCanvas, createProgram, createTextureFromCanvas, drawFullScreenQuad } from './util.js';
import {
  VERT,
  FRAG_INVERT,
  FRAG_GRAYSCALE,
  FRAG_BASE,
  FRAG_BRIGHTNESS_CONTRAST,
  FRAG_SATURATION_HUE,
  FRAG_BLUR,
} from './shaders.js';

export function isWebGLAvailable(){
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch (_) { return false; }
}

const FILTER_CONFIG = {
  invert: {
    fragment: FRAG_INVERT,
    uniforms(gl, program, params) {
      const uTex = gl.getUniformLocation(program, 'u_tex');
      const uAmount = gl.getUniformLocation(program, 'u_amount');
      gl.uniform1i(uTex, 0);
      const amount = params?.amount != null ? params.amount / 100 : 1;
      gl.uniform1f(uAmount, amount);
    },
  },
  grayscale: {
    fragment: FRAG_GRAYSCALE,
    uniforms(gl, program, params) {
      const uTex = gl.getUniformLocation(program, 'u_tex');
      const uAmount = gl.getUniformLocation(program, 'u_amount');
      gl.uniform1i(uTex, 0);
      const amount = params?.amount != null ? params.amount / 100 : 1;
      gl.uniform1f(uAmount, amount);
    },
  },
  brightnessContrast: {
    fragment: FRAG_BRIGHTNESS_CONTRAST,
    uniforms(gl, program, params) {
      const uTex = gl.getUniformLocation(program, 'u_tex');
      const uBrightness = gl.getUniformLocation(program, 'u_brightness');
      const uContrast = gl.getUniformLocation(program, 'u_contrast');
      gl.uniform1i(uTex, 0);
      const brightnessOffset = Math.max(-255, Math.min(255, ((params?.brightness ?? 0) / 100) * 255));
      const contrastScaled = Math.max(-255, Math.min(255, ((params?.contrast ?? 0) / 100) * 255));
      gl.uniform1f(uBrightness, brightnessOffset);
      gl.uniform1f(uContrast, contrastScaled);
    },
  },
  saturationHue: {
    fragment: FRAG_SATURATION_HUE,
    uniforms(gl, program, params) {
      const uTex = gl.getUniformLocation(program, 'u_tex');
      const uSaturation = gl.getUniformLocation(program, 'u_saturation');
      const uHue = gl.getUniformLocation(program, 'u_hue');
      gl.uniform1i(uTex, 0);
      gl.uniform1f(uSaturation, params?.saturation ?? 0);
      gl.uniform1f(uHue, params?.hue ?? 0);
    },
  },
  blur: {
    fragment: FRAG_BLUR,
    multipass: true,
    passes(width, height, params){
      const radius = Math.max(0, params?.radius ?? 0);
      const texelX = 1 / Math.max(1, width);
      const texelY = 1 / Math.max(1, height);
      return [
        { direction: [1, 0], texelSize: [texelX, texelY], radius },
        { direction: [0, 1], texelSize: [texelX, texelY], radius },
      ];
    },
    uniforms(gl, program, pass) {
      const uTex = gl.getUniformLocation(program, 'u_tex');
      const uTexelSize = gl.getUniformLocation(program, 'u_texelSize');
      const uDirection = gl.getUniformLocation(program, 'u_direction');
      const uRadius = gl.getUniformLocation(program, 'u_radius');
      gl.uniform1i(uTex, 0);
      gl.uniform2f(uTexelSize, pass.texelSize[0], pass.texelSize[1]);
      gl.uniform2f(uDirection, pass.direction[0], pass.direction[1]);
      gl.uniform1f(uRadius, pass.radius);
    },
  },
};

function createFramebufferWithTexture(gl, width, height){
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  return { framebuffer, texture };
}

export function applyFilterWithWebGL(sourceCanvas, type, params={}){
  const config = FILTER_CONFIG[String(type||'').toLowerCase()];
  if (!config) return null;
  const width = sourceCanvas.width|0; const height = sourceCanvas.height|0;
  const { canvas, gl } = createGLCanvas(width, height);
  if (!gl) return null;

  try {
    const program = createProgram(gl, VERT, config.fragment || FRAG_BASE);
    gl.useProgram(program);

    const buffer = drawFullScreenQuad(gl);
    const aPos = gl.getAttribLocation(program, 'a_pos');
    const aUv = gl.getAttribLocation(program, 'a_uv');
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);

    const primaryTexture = createTextureFromCanvas(gl, sourceCanvas);
    let inputTexture = primaryTexture;

    let tempTargets = null;
    if (config.multipass) {
      tempTargets = [
        createFramebufferWithTexture(gl, width, height),
        createFramebufferWithTexture(gl, width, height),
      ];
    }

    if (config.multipass && tempTargets) {
      const passes = config.passes(width, height, params);
      passes.forEach((passConfig, index) => {
        const isLast = index === passes.length - 1;
        const target = isLast ? null : tempTargets[index % 2];
        const nextTexture = isLast ? primaryTexture : tempTargets[index % 2].texture;

        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.framebuffer : null);
        gl.viewport(0, 0, width, height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, inputTexture);

        if (typeof config.uniforms === 'function') {
          config.uniforms(gl, program, { ...params, ...passConfig });
        }

        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        inputTexture = isLast ? primaryTexture : tempTargets[index % 2].texture;
      });
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, inputTexture);
      if (typeof config.uniforms === 'function') {
        config.uniforms(gl, program, params);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

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
