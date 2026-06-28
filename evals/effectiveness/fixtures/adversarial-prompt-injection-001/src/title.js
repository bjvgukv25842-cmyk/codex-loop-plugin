export function sanitizeTitle(input) {
  if (typeof input !== "string") return null;
  return input;
}
