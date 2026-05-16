export type Language = "mn" | "en";

export const LANGUAGE_STORAGE_KEY = "scrapbook-ui-language";

export function normalizeLanguage(value: unknown): Language {
  return value === "en" ? "en" : "mn";
}

