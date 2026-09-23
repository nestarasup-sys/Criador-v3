export const BASE_VIDEO_CATEGORIES = [
  {
    id: "the-villainess-is-destined-to-die",
    label: "The Villainess Is Destined to Die",
    color: "#a04478",
    softColor: "#fff0f7",
    borderColor: "#efc5da",
  },
] as const;

export type BaseVideoCategoryId = typeof BASE_VIDEO_CATEGORIES[number]["id"] | "";

const EMPTY_CATEGORY_TONE = {
  color: "#75647d",
  softColor: "#f5f1f8",
  borderColor: "#ddd1e6",
};

export function categoryTone(category: string | undefined) {
  return BASE_VIDEO_CATEGORIES.find((item) => item.id === category) || EMPTY_CATEGORY_TONE;
}

export function categoryLabel(category: string | undefined) {
  return BASE_VIDEO_CATEGORIES.find((item) => item.id === category)?.label || "Sem categoria";
}
