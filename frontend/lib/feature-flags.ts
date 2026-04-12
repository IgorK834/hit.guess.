/**
 * Dev / QA feature gate. Set `NEXT_PUBLIC_DEV_MODE=true` in `.env.local` to enable.
 * Production builds should omit this or leave it unset/false.
 */
export const ENABLE_STRICT_CATEGORY_LOGIC =
  process.env.NEXT_PUBLIC_DEV_MODE === "true";
