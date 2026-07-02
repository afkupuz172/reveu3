// Fuzzy matching between a HubSpot company and Stripe/QBO customers. Billing
// records are messy (legal suffixes, abbreviations, stale names), so instead
// of exact joins we score every candidate and expose the score + reasons to
// the UI; candidates ≥ AUTO_SELECT are included in totals by default and the
// user can override per source.
import type { MatchReason, SourceCandidate } from "../shared/types.js";

export const AUTO_SELECT = 55;
export const SHOW_THRESHOLD = 20;

const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co",
  "company", "gmbh", "plc", "sa", "the", "and", "group", "holdings",
]);

export function normalizeTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !LEGAL_SUFFIXES.has(t));
}

const compact = (name: string) => normalizeTokens(name).join("");

function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cur = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return dp[a.length];
}

export interface CompanyIdentity {
  name: string;
  domain: string | null;
  contactDomains: string[]; // email domains of the company's HubSpot contacts
}

export function scoreCandidate(
  company: CompanyIdentity,
  cand: { name: string | null; email: string | null; extraText?: string | null },
): { score: number; reasons: MatchReason[] } {
  const reasons: MatchReason[] = [];
  const cName = compact(company.name);
  const candName = cand.name ? compact(cand.name) : "";
  const cTokens = new Set(normalizeTokens(company.name));
  const candTokens = new Set(cand.name ? normalizeTokens(cand.name) : []);

  if (candName && candName === cName) {
    reasons.push({ label: "Exact name match", points: 60 });
  } else if (candName) {
    const overlap = [...candTokens].filter((t) => cTokens.has(t)).length;
    const union = new Set([...cTokens, ...candTokens]).size;
    if (overlap > 0 && union > 0) {
      const pts = Math.round((overlap / union) * 45);
      if (pts > 0) reasons.push({ label: `Name tokens overlap (${overlap}/${union})`, points: pts });
    }
    // Catches abbreviations/typos: "Bluepeak SW" vs "Bluepeak Software"
    if (overlap === 0 || candName.startsWith(cName.slice(0, 5))) {
      const dist = levenshtein(cName, candName);
      if (dist <= 2 && cName.length >= 5) reasons.push({ label: `Near-identical name (edit distance ${dist})`, points: 40 });
      else if (candName.includes(cName) || cName.includes(candName))
        reasons.push({ label: "Name contained in the other", points: 25 });
    }
  }

  const emailDomain = cand.email?.split("@")[1]?.toLowerCase() ?? null;
  if (emailDomain) {
    // Weighted to clear AUTO_SELECT on its own: billing emails at the
    // company's exact domain are near-certain matches even when names differ.
    if (company.domain && emailDomain === company.domain.toLowerCase())
      reasons.push({ label: `Email domain = company domain (${emailDomain})`, points: 55 });
    else if (company.contactDomains.includes(emailDomain))
      reasons.push({ label: `Email domain matches a HubSpot contact (${emailDomain})`, points: 40 });
  }

  if (company.domain && cand.extraText?.toLowerCase().includes(company.domain.toLowerCase()))
    reasons.push({ label: "Company domain found in record", points: 30 });

  const score = Math.min(100, reasons.reduce((s, r) => s + r.points, 0));
  return { score, reasons };
}

export function toCandidate(
  source: "stripe" | "quickbooks",
  id: string,
  name: string | null,
  email: string | null,
  meta: string | null,
  scored: { score: number; reasons: MatchReason[] },
): SourceCandidate {
  return {
    source,
    id,
    name: name || "(unnamed)",
    email,
    score: scored.score,
    reasons: scored.reasons,
    autoSelected: scored.score >= AUTO_SELECT,
    meta,
  };
}
