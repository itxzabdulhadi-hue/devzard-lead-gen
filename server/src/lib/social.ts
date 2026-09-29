/**
 * Social link classification: extract instagram/facebook/linkedin URLs from
 * arbitrary public URL lists (Overture `socials`, website links, etc.).
 */

export interface SocialLinks {
  instagram: string | null;
  facebook: string | null;
  linkedin: string | null;
}

const MATCHERS: Array<{ key: keyof SocialLinks; test: (host: string) => boolean }> = [
  { key: 'instagram', test: (h) => h === 'instagram.com' || h.endsWith('.instagram.com') },
  {
    key: 'facebook',
    test: (h) =>
      h === 'facebook.com' ||
      h.endsWith('.facebook.com') ||
      h === 'fb.com' ||
      h.endsWith('.fb.com') ||
      h === 'fb.me' ||
      h === 'm.facebook.com',
  },
  {
    key: 'linkedin',
    test: (h) => h === 'linkedin.com' || h.endsWith('.linkedin.com') || h === 'lnkd.in',
  },
];

/** Pick the first social URL matching each network from a list of URLs. */
export function classifySocials(urls: Array<string | null | undefined>): SocialLinks {
  const result: SocialLinks = { instagram: null, facebook: null, linkedin: null };
  for (const raw of urls) {
    if (!raw) continue;
    const value = String(raw).trim();
    if (!value || !/^https?:\/\//i.test(value)) continue;
    try {
      const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
      for (const m of MATCHERS) {
        if (!result[m.key] && m.test(host)) {
          // Normalize to https and strip query strings.
          result[m.key] = value.replace(/^http:\/\//i, 'https://').split('?')[0] ?? value;
          break;
        }
      }
    } catch {
      // ignore malformed URLs
    }
  }
  return result;
}

export function hasAnySocial(s: SocialLinks): boolean {
  return Boolean(s.instagram || s.facebook || s.linkedin);
}
