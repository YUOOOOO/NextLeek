from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from openbb import obb

app = FastAPI(title="NextLeek Data API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to NextLeek Data API"}

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "data-api"}


# 大盘指数行情 (上证、深证、创业板)
INDEX_SYMBOLS = {
    "000001.SS": "上证指数",
    "399001.SZ": "深证成指",
    "399006.SZ": "创业板指",
}


@app.get("/api/indices")
def get_indices():
    symbols = ",".join(INDEX_SYMBOLS.keys())
    result = obb.equity.price.quote(symbols, provider="yfinance")
    data = result.to_df().reset_index()
    items = []
    for _, row in data.iterrows():
        symbol = row.get("symbol", "")
        items.append({
            "name": INDEX_SYMBOLS.get(symbol, symbol),
            "code": symbol,
            "price": round(float(row.get("last_price", 0)), 2),
            "change": round(float(row.get("change_percent", 0)), 2),
        })
    return items


# 个股实时报价
@app.get("/api/quote")
def get_quote(symbol: str = Query(..., description="股票代码，如 600519.SS")):
    result = obb.equity.price.quote(symbol, provider="yfinance")
    row = result.to_df().reset_index().iloc[0]
    return {
        "symbol": str(row.get("symbol", "")),
        "name": str(row.get("name", "")),
        "price": round(float(row.get("last_price", 0)), 2),
        "open": round(float(row.get("open", 0)), 2),
        "prev_close": round(float(row.get("prev_close", 0)), 2),
        "high": round(float(row.get("high", 0)), 2),
        "low": round(float(row.get("low", 0)), 2),
        "volume": int(row.get("volume", 0)),
        "change_percent": round(float(row.get("change_percent", 0)), 2),
    }


# 历史K线数据
@app.get("/api/history")
def get_history(
    symbol: str = Query(..., description="股票代码"),
    start_date: str = Query("", description="开始日期 YYYY-MM-DD"),
    end_date: str = Query("", description="结束日期 YYYY-MM-DD"),
):
    kwargs: dict = {"provider": "yfinance"}
    if start_date:
        kwargs["start_date"] = start_date
    if end_date:
        kwargs["end_date"] = end_date
    result = obb.equity.price.historical(symbol, **kwargs)
    df = result.to_df().reset_index()
    records = []
    for _, row in df.iterrows():
        records.append({
            "date": str(row["date"])[:10],
            "open": round(float(row["open"]), 2),
            "high": round(float(row["high"]), 2),
            "low": round(float(row["low"]), 2),
            "close": round(float(row["close"]), 2),
            "volume": int(row["volume"]),
        })
    return records

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
