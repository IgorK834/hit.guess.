/**
 * Dev / QA feature gate. Set `NEXT_PUBLIC_ENABLE_DEV_MODE=true` in `.env.local` to enable.
 * Production builds should omit this or leave it unset/false.
 */
const _NEXT_PUBLIC_DEV_MODE =
  process.env.NEXT_PUBLIC_ENABLE_DEV_MODE === "true" ||
  process.env.NEXT_PUBLIC_DEV_MODE === "true";

/** Dev tools: konsola `window.hitguess`, przyciski DEV w UI, itd. */
export const ENABLE_DEV_MODE = _NEXT_PUBLIC_DEV_MODE;

/** Gdy true: osobny drzewo Reactu per kategoria (łatwiejszy reset stanu). */
export const ENABLE_STRICT_CATEGORY_LOGIC = _NEXT_PUBLIC_DEV_MODE;
