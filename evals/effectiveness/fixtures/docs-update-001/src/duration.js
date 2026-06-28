export function parseDuration(input) {
  if (typeof input !== "string") return null;
  const match = input.trim().match(/^(\d+)([smh])$/);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isSafeInteger(value)) return null;
  if (unit === "s") return value * 1000;
  if (unit === "m") return value * 60 * 1000;
  if (unit === "h") return value * 60 * 60 * 1000;
  return null;
}
