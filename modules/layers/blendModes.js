const FALLBACK_BLEND_MODE = "normal";
const FALLBACK_BLEND_OPERATION = "source-over";

const BLEND_MODE_DEFINITIONS = [
  {
    id: "normal",
    label: "Normal",
    operation: "source-over",
    composer: composeNormal,
  },
  {
    id: "multiply",
    label: "Multiply",
    operation: "multiply",
    composer: composeMultiply,
  },
  {
    id: "screen",
    label: "Screen",
    operation: "screen",
    composer: composeScreen,
  },
  {
    id: "overlay",
    label: "Overlay",
    operation: "overlay",
    composer: composeOverlay,
  },
  {
    id: "darken",
    label: "Darken",
    operation: "darken",
    composer: composeDarken,
  },
  {
    id: "lighten",
    label: "Lighten",
    operation: "lighten",
    composer: composeLighten,
  },
];

const DEFINITION_LOOKUP = new Map();
const MODE_ALIAS_MAP = new Map();

BLEND_MODE_DEFINITIONS.forEach((definition) => {
  DEFINITION_LOOKUP.set(definition.id, definition);
  MODE_ALIAS_MAP.set(normaliseModeKey(definition.id), definition.id);
});

[
  ["source-over", "normal"],
  ["sourceover", "normal"],
  ["source", "normal"],
  ["light", "lighten"],
  ["lighter", "lighten"],
  ["darker", "darken"],
].forEach(([alias, target]) => {
  MODE_ALIAS_MAP.set(normaliseModeKey(alias), target);
});

function normaliseModeKey(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

export function resolveBlendMode(mode, context) {
  const definition = getBlendModeDefinition(mode);
  const operation = definition.operation || FALLBACK_BLEND_OPERATION;

  if (context && !isGlobalCompositeSupported(context, operation)) {
    return FALLBACK_BLEND_OPERATION;
  }

  return operation;
}

export function isBlendModeSupported(context, mode) {
  if (!context || typeof context !== "object") {
    return false;
  }

  const definition = getBlendModeDefinition(mode);
  return isGlobalCompositeSupported(context, definition.operation || FALLBACK_BLEND_OPERATION);
}

export function getBlendModes() {
  return BLEND_MODE_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    operation: definition.operation,
  }));
}

export function getBlendModeDefinition(mode) {
  const key = normaliseModeKey(mode);
  const resolvedId = MODE_ALIAS_MAP.get(key) || FALLBACK_BLEND_MODE;
  return DEFINITION_LOOKUP.get(resolvedId) || DEFINITION_LOOKUP.get(FALLBACK_BLEND_MODE);
}

export function applyBlendMode(mode, baseColor, blendColor, opacity = 1) {
  const definition = getBlendModeDefinition(mode);
  const composer = definition.composer || composeNormal;

  const base = normaliseColor(baseColor);
  const top = normaliseColor(blendColor);
  const mixRatio = clampUnit(opacity);

  const topAlpha = clampUnit(top.a * mixRatio);
  const baseAlpha = clampUnit(base.a);

  const composed = composer(base, top);
  const outputAlpha = topAlpha + baseAlpha * (1 - topAlpha);

  if (outputAlpha <= 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    r: clampChannel((composed.r * topAlpha + base.r * baseAlpha * (1 - topAlpha)) / outputAlpha),
    g: clampChannel((composed.g * topAlpha + base.g * baseAlpha * (1 - topAlpha)) / outputAlpha),
    b: clampChannel((composed.b * topAlpha + base.b * baseAlpha * (1 - topAlpha)) / outputAlpha),
    a: outputAlpha,
  };
}

function isGlobalCompositeSupported(context, operation) {
  if (!context || typeof context !== "object") {
    return false;
  }

  const previous = context.globalCompositeOperation;

  try {
    context.globalCompositeOperation = operation;
    const supported = context.globalCompositeOperation === operation;
    context.globalCompositeOperation = previous;
    return supported;
  } catch (error) {
    context.globalCompositeOperation = previous;
    return false;
  }
}

function normaliseColor(color) {
  if (!color || typeof color !== "object") {
    return { r: 0, g: 0, b: 0, a: 1 };
  }

  const r = clampChannel(color.r ?? color.red ?? 0);
  const g = clampChannel(color.g ?? color.green ?? 0);
  const b = clampChannel(color.b ?? color.blue ?? 0);
  const a = clampUnit(color.a ?? color.alpha ?? 1);

  return { r, g, b, a };
}

function clampChannel(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 255) {
    return 255;
  }

  return Math.round(value);
}

function clampUnit(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 1;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function composeNormal(base, blend) {
  return {
    r: blend.r,
    g: blend.g,
    b: blend.b,
  };
}

function composeMultiply(base, blend) {
  return {
    r: clampChannel((base.r * blend.r) / 255),
    g: clampChannel((base.g * blend.g) / 255),
    b: clampChannel((base.b * blend.b) / 255),
  };
}

function composeScreen(base, blend) {
  return {
    r: clampChannel(255 - ((255 - base.r) * (255 - blend.r)) / 255),
    g: clampChannel(255 - ((255 - base.g) * (255 - blend.g)) / 255),
    b: clampChannel(255 - ((255 - base.b) * (255 - blend.b)) / 255),
  };
}

function composeOverlay(base, blend) {
  return {
    r: overlayChannel(base.r, blend.r),
    g: overlayChannel(base.g, blend.g),
    b: overlayChannel(base.b, blend.b),
  };
}

function composeDarken(base, blend) {
  return {
    r: Math.min(base.r, blend.r),
    g: Math.min(base.g, blend.g),
    b: Math.min(base.b, blend.b),
  };
}

function composeLighten(base, blend) {
  return {
    r: Math.max(base.r, blend.r),
    g: Math.max(base.g, blend.g),
    b: Math.max(base.b, blend.b),
  };
}

function overlayChannel(base, blend) {
  const baseNorm = base / 255;
  const blendNorm = blend / 255;

  let value;
  if (baseNorm < 0.5) {
    value = 2 * baseNorm * blendNorm;
  } else {
    value = 1 - 2 * (1 - baseNorm) * (1 - blendNorm);
  }

  return clampChannel(value * 255);
}

export { FALLBACK_BLEND_MODE, FALLBACK_BLEND_OPERATION };
