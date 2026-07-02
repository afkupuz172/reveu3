import { useMemo, useState } from "react";

// Generic sortable-table hook: give each column a value extractor; clicking a
// header toggles asc/desc. Nulls always sort last.
export function useSort<T>(rows: T[], columns: Record<string, (row: T) => string | number | null>, initial: string) {
  const [key, setKey] = useState(initial);
  const [dir, setDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    const get = columns[key];
    if (!get) return rows;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return (typeof va === "string" ? va.localeCompare(String(vb)) : va - (vb as number)) * dir;
    });
  }, [rows, key, dir, columns]);

  const toggle = (k: string) => {
    if (k === key) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setKey(k);
      setDir(-1);
    }
  };

  const indicator = (k: string) => (k === key ? (dir === 1 ? " ↑" : " ↓") : "");
  return { sorted, toggle, indicator };
}
