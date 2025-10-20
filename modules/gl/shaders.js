// Simple shader sources for common color transforms

export const VERT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

export const FRAG_BASE = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(){
  gl_FragColor = texture2D(u_tex, v_uv);
}
`;

export const FRAG_INVERT = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(){
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(1.0 - c.rgb, c.a);
}
`;

export const FRAG_GRAYSCALE = `
precision mediump float;
uniform sampler2D u_tex;
varying vec2 v_uv;
void main(){
  vec4 c = texture2D(u_tex, v_uv);
  float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(vec3(g), c.a);
}
`;
