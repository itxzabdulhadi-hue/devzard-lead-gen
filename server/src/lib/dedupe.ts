/**
 * Deduplication keys for business records.
 * Primary identity: (source, source_id).
 * Secondary signal: normalized website domain (a real-world business has one
 * website; records sharing a domain are treated as the same lead on import).
 */

export function dedupeKey(source: string, sourceId: string): string {
  return `${String(source).trim().toLowerCase()}::${String(sourceId).trim()}`;
}

export function websiteDedupeKey(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const host = new URL(website).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}
