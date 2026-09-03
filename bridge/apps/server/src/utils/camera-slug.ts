export function cameraSlug(name: string, did: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\bcamera\b/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || did;
}

export function cameraRtspPath(name: string, did: string): string {
  return `live/${cameraSlug(name, did)}`;
}
