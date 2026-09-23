export const BASE_VIDEO_CATEGORIES = [
  {
    id: "the-villainess-is-destined-to-die",
    label: "The Villainess Is Destined to Die",
    color: "#a04478",
    softColor: "#fff0f7",
    borderColor: "#efc5da",
  },
] as const;

export type CustomVideoCategory = {
  id: string;
  label: string;
  color: string;
  softColor: string;
  borderColor: string;
};

const CUSTOM_CATEGORIES_KEY = "nymi-base-video-categories-v1";
const CUSTOM_CATEGORY_COLORS = [
  ["#356f9d", "#edf7ff", "#c3dfef"],
  ["#7a5a9e", "#f5efff", "#dfccef"],
  ["#b26932", "#fff4e9", "#f0d2b7"],
  ["#37806d", "#ecfaf5", "#c1e6da"],
  ["#9a4e4e", "#fff0f0", "#efc6c6"],
] as const;

export type BaseVideoCategoryId = typeof BASE_VIDEO_CATEGORIES[number]["id"] | "";

export function readCustomCategories(): CustomVideoCategory[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(CUSTOM_CATEGORIES_KEY) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CustomVideoCategory => Boolean(item) && typeof item === "object" && typeof (item as CustomVideoCategory).id === "string" && typeof (item as CustomVideoCategory).label === "string" && typeof (item as CustomVideoCategory).color === "string" && typeof (item as CustomVideoCategory).softColor === "string" && typeof (item as CustomVideoCategory).borderColor === "string");
  } catch {
    return [];
  }
}

export function categoryOptions(customCategories = readCustomCategories()) {
  return [...BASE_VIDEO_CATEGORIES, ...customCategories];
}

export function addCustomCategory(label: string): CustomVideoCategory | null {
  const cleanLabel = label.trim().replace(/\s+/g, " ");
  if (!cleanLabel || typeof window === "undefined") return null;
  const existing = readCustomCategories();
  const alreadyExists = categoryOptions(existing).some((item) => item.label.toLocaleLowerCase("pt-BR") === cleanLabel.toLocaleLowerCase("pt-BR"));
  if (alreadyExists) return existing.find((item) => item.label.toLocaleLowerCase("pt-BR") === cleanLabel.toLocaleLowerCase("pt-BR") ) || null;
  const [color, softColor, borderColor] = CUSTOM_CATEGORY_COLORS[existing.length % CUSTOM_CATEGORY_COLORS.length];
  const id = `custom-${cleanLabel.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`;
  const category = { id, label: cleanLabel, color, softColor, borderColor } satisfies CustomVideoCategory;
  window.localStorage.setItem(CUSTOM_CATEGORIES_KEY, JSON.stringify([...existing, category]));
  return category;
}

const EMPTY_CATEGORY_TONE = {
  color: "#75647d",
  softColor: "#f5f1f8",
  borderColor: "#ddd1e6",
};

export function categoryTone(category: string | undefined, customCategories = readCustomCategories()) {
  return categoryOptions(customCategories).find((item) => item.id === category) || EMPTY_CATEGORY_TONE;
}

export function categoryLabel(category: string | undefined, customCategories = readCustomCategories()) {
  return categoryOptions(customCategories).find((item) => item.id === category)?.label || "Sem categoria";
}
