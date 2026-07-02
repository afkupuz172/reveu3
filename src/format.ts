export const fmtMoney = (v: number | null | undefined, digits = 0): string =>
  v === null || v === undefined
    ? "—"
    : v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: digits, minimumFractionDigits: 0 });

export const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—";

export const fmtPct = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${v}%`);

export const nrrColor = (nrr: number | null): string =>
  nrr === null ? "var(--muted)" : nrr > 100 ? "var(--good)" : nrr === 100 ? "var(--info)" : nrr > 0 ? "var(--warn)" : "var(--bad)";
