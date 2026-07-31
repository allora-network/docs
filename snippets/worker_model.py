"""Train a small BTC/USD price model for Allora's sandbox topic (ID 69).

Topic 69 asks for the BTC/USD price 24 hours ahead. This script:
1. fetches hourly BTC/USDT candles from Binance's public REST API,
2. builds log-return features over several look-back horizons,
3. trains a gradient-boosted tree model to predict the log return
   24 hours ahead, with walk-forward validation,
4. converts the predicted log return back into a price.
"""

import numpy as np
import pandas as pd
import requests
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.model_selection import TimeSeriesSplit

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
SYMBOL = "BTCUSDT"
INTERVAL = "1h"                   # hourly candles
CANDLES = 1000                    # max candles per request (~41 days of history)
TARGET_BARS = 24                  # predict 24 hours ahead
RETURN_HORIZONS = [1, 6, 12, 24]  # look-back horizons, in hours

FEATURE_COLS = [f"log_return_{h}h" for h in RETURN_HORIZONS] + ["volatility_24h"]


def fetch_candles(limit: int = CANDLES) -> pd.DataFrame:
    """Fetch hourly OHLCV candles from Binance's public market data API."""
    response = requests.get(
        BINANCE_KLINES_URL,
        params={"symbol": SYMBOL, "interval": INTERVAL, "limit": limit},
        timeout=10,
    )
    response.raise_for_status()
    columns = [
        "open_time", "open", "high", "low", "close", "volume", "close_time",
        "quote_volume", "n_trades", "taker_base_volume", "taker_quote_volume", "unused",
    ]
    df = pd.DataFrame(response.json(), columns=columns)
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    df["close"] = df["close"].astype(float)
    return df[["open_time", "close"]]


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add log-return features, rolling volatility, and the training target."""
    out = df.copy()
    log_close = np.log(out["close"])
    for horizon in RETURN_HORIZONS:
        out[f"log_return_{horizon}h"] = log_close.diff(horizon)
    out["volatility_24h"] = log_close.diff().rolling(24).std()
    # Target: the log return over the NEXT TARGET_BARS hours (NaN for recent rows)
    out["target"] = log_close.shift(-TARGET_BARS) - log_close
    return out


def make_model() -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        max_iter=300,
        learning_rate=0.05,
        max_depth=3,
        max_leaf_nodes=15,
        random_state=42,
    )


def train() -> HistGradientBoostingRegressor:
    """Train the model with walk-forward validation, then fit on all data."""
    df = build_features(fetch_candles()).dropna()
    print(f"Dataset: {len(df)} hourly samples "
          f"({df['open_time'].iloc[0]} to {df['open_time'].iloc[-1]})")

    # Walk-forward cross-validation with a TARGET_BARS embargo between
    # train and test folds, so the target never leaks across the split.
    tscv = TimeSeriesSplit(n_splits=3, gap=TARGET_BARS)
    for fold, (train_idx, test_idx) in enumerate(tscv.split(df), start=1):
        model = make_model()
        model.fit(df.iloc[train_idx][FEATURE_COLS], df.iloc[train_idx]["target"])
        preds = model.predict(df.iloc[test_idx][FEATURE_COLS])
        actual = df.iloc[test_idx]["target"].to_numpy()
        mae = np.mean(np.abs(preds - actual))
        directional = np.mean(np.sign(preds) == np.sign(actual))
        print(f"Fold {fold}: MAE (log return) = {mae:.5f} | "
              f"directional accuracy = {directional:.1%}")

    final_model = make_model()
    final_model.fit(df[FEATURE_COLS], df["target"])
    print(f"Final model trained on {len(df)} samples")
    return final_model


def predict_price(model: HistGradientBoostingRegressor) -> float:
    """Predict the BTC/USD price TARGET_BARS hours from now."""
    features = build_features(fetch_candles())
    current_price = float(features["close"].iloc[-1])
    predicted_log_return = float(model.predict(features[FEATURE_COLS].iloc[[-1]])[0])
    # Convert the predicted log return back into a price
    return current_price * float(np.exp(predicted_log_return))


if __name__ == "__main__":
    model = train()
    price = predict_price(model)
    print(f"Predicted BTC/USD price in {TARGET_BARS} hours: {price:,.2f}")
