/**
 * Shared analysis signal shape — decouples the scoring engine from the
 * database row so scoring is a pure function (easy to unit test).
 */
export interface AnalysisSignals {
  reachable: boolean | null;
  https: boolean | null;
  responseStatus: number | null;
  responseMs: number | null;
  mobileFriendly: boolean | null;
  hasTitle: boolean | null;
  hasMetaDescription: boolean | null;
  hasH1: boolean | null;
  hasContactPage: boolean | null;
  hasContactInformation: boolean | null;
  hasWhatsapp: boolean | null;
  hasSocialLinks: boolean | null;
  hasCta: boolean | null;
  hasBooking: boolean | null;
  hasOrdering: boolean | null;
  ecommerceDetected: boolean | null;
  cms: string | null;
  robotsTxt: boolean | null;
  sitemap: boolean | null;
  canonical: boolean | null;
  structuredData: boolean | null;
  brokenLinksCount: number | null;
}
