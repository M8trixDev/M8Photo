const FALLBACK_BLEND_MODE = "source-over";

const BLEND_MODE_MAP = new Map(
  Object.entries({
    normal: "source-over",
    sourceover: "source-over",
    multiply: "multiply",
    screen: "screen",
    overlay: "overlay",
    lighten: "lighter",
    light: "lighter",
    darken: "darken",
    darker: "darken",
    difference: "difference",
    exclusion: "exclusion",
    hardlight: "hard-light",
    hard_light: "hard-light",
    softlight: "soft-light",
    soft_light: "soft-light",
    colordodge: "color-dodge",
    color_dodge: "color-dodge",
    colorburn: "color-burn",
    color_burn: "color-burn",
    luminosity: "luminosity",
    hue: "hue",
    saturation: "saturation",
    color: "color",
    plus: "lighter",
    add: "lighter",
    subtract: "destination-out",
    invert: "difference",
  })
);

function normaliseModeName(value) {
  if (typeof value !== "string" || value.trim() === "") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, "");
}

export function resolveBlendMode(mode) {
  const normalised = normaliseModeName(mode);
  return BLEND_MODE_MAP.get(normalised) || FALLBACK_BLEND_MODE;
}

export function isBlendModeSupported(context, blendMode) {
  if (!context || typeof context !== "object") {
    return false;
  }

  const candidate = resolveBlendMode(blendMode);
  const previous = context.globalCompositeOperation;

  try {
    context.globalCompositeOperation = candidate;
    const supported = context.globalCompositeOperation === candidate;
    context.globalCompositeOperation = previous;
    return supported;
  } catch (error) {
    context.globalCompositeOperation = previous;
    return false;
  }
}

export function getBlendModes() {
  return Array.from(new Set([FALLBACK_BLEND_MODE, ...BLEND_MODE_MAP.values()]));
}

export { FALLBACK_BLEND_MODE };
