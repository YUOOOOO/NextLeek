import type { ReactNode } from "react";
import { useUniverse, type AssetType } from "../lib/universe";

const TABS: Array<{ id: AssetType; label: string }> = [
  { id: "stock", label: "股票" },
  { id: "etf", label: "ETF" },
];

export function UniverseBar() {
  const { universe, setUniverse } = useUniverse();
  return (
    <div className="universe-bar" role="tablist" aria-label="标的池">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={universe === tab.id}
          className={`universe-tab${universe === tab.id ? " is-active" : ""}`}
          onClick={() => setUniverse(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function UniverseShell({ children }: { children: ReactNode }) {
  return (
    <div className="universe-shell">
      <UniverseBar />
      {children}
    </div>
  );
}
