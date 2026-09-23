export const BASE_VIDEO_CATEGORIES = [
  { id: "the-villainess-is-destined-to-die", label: "The Villainess Is Destined to Die" },
] as const;

export type BaseVideoCategoryId = typeof BASE_VIDEO_CATEGORIES[number]["id"] | "";

export function categoryLabel(category: string | undefined) {
  return BASE_VIDEO_CATEGORIES.find((item) => item.id === category)?.label || "Sem categoria";
}
