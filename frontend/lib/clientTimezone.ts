export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

export function gameApiHeaders(): Record<string, string> {
  return { "X-Client-Timezone": getBrowserTimeZone() };
}
