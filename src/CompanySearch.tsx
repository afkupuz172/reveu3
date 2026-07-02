import { useEffect, useRef, useState } from "react";
import type { CompanyHit } from "../shared/types";
import { apiCompanies } from "./api";

// Debounced combobox over HubSpot company search (server caches per query).
// `label` syncs the input text when the company is set from outside (e.g. a
// company link on the Overview tab).
export default function CompanySearch({ onSelect, label }: { onSelect: (c: CompanyHit) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CompanyHit[]>([]);
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (label !== undefined) {
      setQ(label);
      setOpen(false);
    }
  }, [label]);

  useEffect(() => {
    const t = setTimeout(() => {
      apiCompanies(q)
        .then((r) => {
          setHits(r);
          setHl(0);
        })
        .catch(() => setHits([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (c: CompanyHit) => {
    setQ(c.name);
    setOpen(false);
    onSelect(c);
  };

  return (
    <div className="searchbox" ref={box}>
      <input
        placeholder="Search HubSpot companies…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHl((h) => Math.min(h + 1, hits.length - 1));
          else if (e.key === "ArrowUp") setHl((h) => Math.max(h - 1, 0));
          else if (e.key === "Enter" && hits[hl]) pick(hits[hl]);
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && hits.length > 0 && (
        <div className="menu">
          {hits.map((c, i) => (
            <button key={c.id} className={i === hl ? "hl" : ""} onMouseEnter={() => setHl(i)} onClick={() => pick(c)}>
              <span>{c.name}</span>
              <span className="domain">{c.domain ?? ""}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
