import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import type { StrategyBasicFilter } from "./api";

export type AssetType = "stock" | "etf";

const STORAGE_KEY = "nextleek_universe";

export function parseUniverse(value: string | null | undefined): AssetType {
  return value === "etf" ? "etf" : "stock";
}

export function readStoredUniverse(): AssetType {
  try {
    return parseUniverse(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "stock";
  }
}

export function writeStoredUniverse(value: AssetType) {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore quota / private mode */
  }
}

export function defaultBasicFilter(assetType: AssetType): StrategyBasicFilter {
  if (assetType === "etf") {
    return {
      price_min: 0.5,
      price_max: 20,
      market_cap_min: null,
      amount_min: 0.05e8,
      exclude_st: false,
      boards: [],
    };
  }
  return {
    price_min: 3,
    price_max: 300,
    market_cap_min: 10e8,
    amount_min: 0.2e8,
    exclude_st: true,
    boards: ["沪主板", "深主板", "创业板", "科创板", "北交所"],
  };
}

export function useUniverse() {
  const [params, setParams] = useSearchParams();
  const universe = parseUniverse(params.get("universe") ?? readStoredUniverse());

  useEffect(() => {
    writeStoredUniverse(universe);
    const current = params.get("universe");
    if (universe === "etf" && current !== "etf") {
      const next = new URLSearchParams(params);
      next.set("universe", "etf");
      setParams(next, { replace: true });
    }
    if (universe === "stock" && current) {
      const next = new URLSearchParams(params);
      next.delete("universe");
      setParams(next, { replace: true });
    }
  }, [universe, params, setParams]);

  function setUniverse(next: AssetType) {
    if (next === universe) return;
    writeStoredUniverse(next);
    const nextParams = new URLSearchParams(params);
    if (next === "stock") nextParams.delete("universe");
    else nextParams.set("universe", next);
    setParams(nextParams, { replace: true });
  }

  return { universe, setUniverse };
}
