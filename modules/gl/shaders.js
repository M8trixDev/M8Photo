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
uniform float u_amount;
varying vec2 v_uv;
void main(){
  vec4 c = texture2D(u_tex, v_uv);
  vec3 inverted = 1.0 - c.rgb;
  vec3 rgb = mix(c.rgb, inverted, clamp(u_amount, 0.0, 1.0));
  gl_FragColor = vec4(rgb, c.a);
}
`;

export const FRAG_GRAYSCALE = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_amount;
varying vec2 v_uv;
void main(){
  vec4 c = texture2D(u_tex, v_uv);
  float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 rgb = mix(c.rgb, vec3(g), clamp(u_amount, 0.0, 1.0));
  gl_FragColor = vec4(rgb, c.a);
}
`;

export const FRAG_BRIGHTNESS_CONTRAST = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_brightness;
uniform float u_contrast;
varying vec2 v_uv;
void main(){
  vec4 c = texture2D(u_tex, v_uv);
  vec3 rgb = c.rgb;
  
  // Apply brightness
  rgb += u_brightness / 255.0;
  
  // Apply contrast
  float contrastFactor = (259.0 * (u_contrast + 255.0)) / (255.0 * (259.0 - u_contrast));
  rgb = contrastFactor * (rgb - 0.5) + 0.5;
  
  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), c.a);
}
`;

export const FRAG_SATURATION_HUE = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_saturation;
uniform float u_hue;
varying vec2 v_uv;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main(){
  vec4 c = texture2D(u_tex, v_uv);
  vec3 hsv = rgb2hsv(c.rgb);
  
  // Apply hue shift
  hsv.x = fract(hsv.x + u_hue / 360.0);
  
  // Apply saturation
  hsv.y = clamp(hsv.y * (1.0 + u_saturation / 100.0), 0.0, 1.0);
  
  vec3 rgb = hsv2rgb(hsv);
  gl_FragColor = vec4(rgb, c.a);
}
`;

export const FRAG_BLUR = `
precision mediump float;
uniform sampler2D u_tex;
uniform vec2 u_texelSize;
uniform vec2 u_direction;
uniform float u_radius;
varying vec2 v_uv;

void main(){
  vec4 sum = vec4(0.0);
  float total = 0.0;
  float r = max(1.0, u_radius);
  int samples = int(min(r * 2.0 + 1.0, 15.0));
  
  for(int i = 0; i < 15; i++){
    if(i >= samples) break;
    float offset = float(i) - r;
    vec2 uv = v_uv + u_direction * offset * u_texelSize;
    float weight = 1.0 - abs(offset) / r;
    sum += texture2D(u_tex, uv) * weight;
    total += weight;
  }
  
  gl_FragColor = sum / total;
}
`;
