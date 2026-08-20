from __future__ import annotations


def market_of(code: str) -> str:
    c = code.split(".")[0].lower().removeprefix("sh").removeprefix("sz")
    if c.startswith(("5", "6", "9")):
        return "SH"
    return "SZ"


def normalize_code(symbol: str) -> str:
    s = symbol.strip().upper().replace(" ", "")
    if s.startswith("SH") or s.startswith("SZ"):
        s = s[2:]
    if "." in s:
        s = s.split(".")[0]
    return s


def dotted(code: str) -> str:
    c = normalize_code(code)
    return f"{c}.{market_of(c)}"


def parquet_stem(code: str) -> str:
    c = normalize_code(code)
    return f"{c}.{market_of(c)}_daily_ohlcv"
