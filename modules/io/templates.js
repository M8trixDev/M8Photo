import { store, initialState } from "../core/store.js";
import { history } from "../core/history.js";
import { eventBus } from "../core/events.js";

const THUMBS_BASE = "/assets/template-thumbs";

// Catalog of preset sizes with metadata
// Keep entries minimal but useful for common workflows
const TEMPLATES = [
  {
    id: "instagram-square",
    name: "Instagram Square",
    description: "1080 × 1080 px (1:1)",
    width: 1080,
    height: 1080,
    aspect: "1:1",
    category: "Social",
    platform: "Instagram",
    thumb: `${THUMBS_BASE}/instagram-square.svg`,
  },
  {
    id: "instagram-story",
    name: "Instagram Story",
    description: "1080 × 1920 px (9:16)",
    width: 1080,
    height: 1920,
    aspect: "9:16",
    category: "Social",
    platform: "Instagram",
    thumb: `${THUMBS_BASE}/instagram-story.svg`,
  },
  {
    id: "youtube-thumbnail",
    name: "YouTube Thumbnail",
    description: "1280 × 720 px (16:9)",
    width: 1280,
    height: 720,
    aspect: "16:9",
    category: "Video",
    platform: "YouTube",
    thumb: `${THUMBS_BASE}/youtube-thumbnail.svg`,
  },
  {
    id: "youtube-banner",
    name: "YouTube Channel Banner",
    description: "2048 × 1152 px (16:9)",
    width: 2048,
    height: 1152,
    aspect: "16:9",
    category: "Video",
    platform: "YouTube",
    thumb: `${THUMBS_BASE}/youtube-banner.svg`,
  },
  {
    id: "twitter-header",
    name: "Twitter Header",
    description: "1500 × 500 px (3:1)",
    width: 1500,
    height: 500,
    aspect: "3:1",
    category: "Social",
    platform: "Twitter",
    thumb: `${THUMBS_BASE}/twitter-header.svg`,
  },
  {
    id: "facebook-post",
    name: "Facebook Post",
    description: "1200 × 630 px (~1.91:1)",
    width: 1200,
    height: 630,
    aspect: "1.91:1",
    category: "Social",
    platform: "Facebook",
    thumb: `${THUMBS_BASE}/facebook-post.svg`,
  },
];

export function getTemplates() {
  return TEMPLATES.slice();
}

export function getTemplateById(id) {
  return TEMPLATES.find((t) => t.id === id) || null;
}

// Creates a fresh project based on a template. Resets history appropriately.
export function createProjectFromTemplate(id, options = {}) {
  const tpl = typeof id === "string" ? getTemplateById(id) : id;
  if (!tpl) {
    throw new Error("Unknown template");
  }

  // Reset store back to initial shape to avoid carrying state across projects
  try {
    store.replace({ ...initialState }, { reason: "template:new:reset" });
  } catch (_) {
    // fallback: no-op
  }

  // Apply viewport and project metadata
  const now = Date.now();
  store.updateSlice(
    "viewport",
    (viewport) => ({
      ...viewport,
      size: { width: Math.max(1, tpl.width), height: Math.max(1, tpl.height) },
      pan: { x: 0, y: 0 },
      zoom: 1,
    }),
    { reason: "template:new:viewport" }
  );

  store.updateSlice(
    "project",
    (project) => ({
      ...project,
      id: null,
      name: tpl.name,
      description: tpl.description || "",
      createdAt: now,
      updatedAt: now,
      metadata: {
        ...project.metadata,
        template: {
          id: tpl.id,
          name: tpl.name,
          category: tpl.category || null,
          platform: tpl.platform || null,
          width: tpl.width,
          height: tpl.height,
          aspect: tpl.aspect || null,
        },
      },
    }),
    { reason: "template:new:project-meta" }
  );

  // Clear any existing selection
  try {
    store.updateSlice(
      "selection",
      (selection) => ({ ...selection, items: [], bounds: null, region: null, mode: "replace" }),
      { reason: "template:new:selection" }
    );
  } catch (_) {}

  // Reset history so the new project starts with a clean timeline
  try {
    history.clear({ reason: "template:new" });
  } catch (_) {}

  if (eventBus) {
    try {
      eventBus.emit("project:new", { template: { ...tpl } });
    } catch (_) {}
  }

  return { template: { ...tpl } };
}

export default { getTemplates, getTemplateById, createProjectFromTemplate };
