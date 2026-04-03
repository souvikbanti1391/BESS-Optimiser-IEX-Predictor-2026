# -*- coding: utf-8 -*-
"""
MODULE 1: PREDICTION INFERENCE LAYER
Adapted for BESS Optimiser App
Exact logic from user's provided code.
"""

import sys
import os
import pandas as pd
import numpy as np
import joblib
import json
import glob
from datetime import datetime
from sklearn.metrics import mean_absolute_error, mean_squared_error

# ================================
# CONFIGURATION & INPUTS
# ================================

# Default values if not provided via CLI
FORECAST_DAYS = 7
TIME_RES = 'H'
PLOT_DAYS = 31
DATA_PATH = None
MODEL_DIR = "./models"

if len(sys.argv) > 1:
    try:
        args = json.loads(sys.argv[1])
        FORECAST_DAYS = int(args.get("forecast_days", 7))
        TIME_RES = args.get("time_res", "H").upper()
        PLOT_DAYS = int(args.get("plot_days", 31))
        DATA_PATH = args.get("data_path")
        MODEL_DIR = args.get("model_dir", "./models")
    except Exception as e:
        print(json.dumps({"error": f"Invalid arguments: {str(e)}"}))
        sys.exit(1)

if not DATA_PATH:
    print(json.dumps({"error": "No data path provided"}))
    sys.exit(1)

# ================================
# AUTO-DETECT PIPELINE ARTIFACT
# ================================

# Try direct files first (downloaded from Drive)
pipeline_candidates = glob.glob(os.path.join(MODEL_DIR, "*.pkl"))

# Then check subfolders (original structure)
if not pipeline_candidates:
    pipeline_candidates = glob.glob(
        os.path.join(MODEL_DIR, "RandomForest_PIPELINE_*", "RandomForest_pipeline_*.pkl")
    )

MODEL_ERROR = None
if not pipeline_candidates:
    HAS_MODEL = False
    MODEL_ERROR = "No .pkl files found in models directory."
else:
    PIPELINE_PATH = sorted(pipeline_candidates)[-1]
    try:
        # Check if the file is actually an HTML page (Google Drive warning)
        with open(PIPELINE_PATH, 'rb') as f:
            header = f.read(100)
            if b'<!DOCTYPE html>' in header or b'<html>' in header:
                HAS_MODEL = False
                MODEL_ERROR = f"The model file at {PIPELINE_PATH} is corrupted (it appears to be an HTML page from Google Drive). Please delete it and try downloading again."
            else:
                artifact = joblib.load(PIPELINE_PATH)
                if isinstance(artifact, dict) and "model" in artifact:
                    rf_model = artifact["model"]
                    scaler_x = artifact["scaler"]
                    feature_cols = artifact["feature_columns"]
                    if hasattr(rf_model, 'set_params'):
                        rf_model.set_params(max_depth=None, min_samples_leaf=1, min_samples_split=2)
                    HAS_MODEL = True
                elif hasattr(artifact, 'predict'):
                    # Fallback: maybe it's just the model object itself
                    rf_model = artifact
                    # We don't have scaler or feature_cols, so we'll have to assume defaults or fail gracefully
                    HAS_MODEL = False
                    MODEL_ERROR = f"Artifact at {PIPELINE_PATH} is a model object but missing 'scaler' and 'feature_columns' metadata. Please ensure the .pkl is the full pipeline dictionary."
                else:
                    HAS_MODEL = False
                    MODEL_ERROR = f"Artifact at {PIPELINE_PATH} is not in the expected dictionary format."
    except Exception as e:
        HAS_MODEL = False
        MODEL_ERROR = f"Error loading {PIPELINE_PATH}: {str(e)}"

# ================================
# ROBUST HEADER DETECTION (EXACTLY AS PROVIDED)
# ================================

def detect_true_header_row(filepath, max_scan_rows=30):
    if filepath.endswith(".csv"):
        # For CSV, we can still scan first few rows
        temp = pd.read_csv(filepath, header=None, nrows=max_scan_rows)
    else:
        temp = pd.read_excel(filepath, header=None, nrows=max_scan_rows)
        
    for i in range(max_scan_rows):
        row = temp.iloc[i].astype(str)
        valid = [c for c in row if c.strip() and not c.lower().startswith("unnamed")]
        if len(valid) >= 3 and any(k in " ".join(valid).lower() for k in ["hour","mcp","price"]):
            return i
    return 0 # Default to 0 if not found

# ================================
# DATA LOADING & CLEANING (EXACTLY AS PROVIDED)
# ================================

try:
    header_row = detect_true_header_row(DATA_PATH)
    if DATA_PATH.endswith(".xlsx") or DATA_PATH.endswith(".xls"):
        raw_df = pd.read_excel(DATA_PATH, header=header_row)
    else:
        raw_df = pd.read_csv(DATA_PATH, header=header_row)

    def find_col(df, keys):
        for c in df.columns:
            if any(k in str(c).lower() for k in keys):
                return c
        return None

    date_col = find_col(raw_df, ["date"])
    hour_col = find_col(raw_df, ["hour"])
    mcp_col  = find_col(raw_df, ["mcp", "price"])

    if any(v is None for v in [date_col, hour_col, mcp_col]):
        raise ValueError("Date / Hour / MCP columns not detected")

    df = raw_df[[date_col, hour_col, mcp_col]].copy()
    df.columns = ["date","hour","MCP"]

    # Detect unit (Rs/MWh vs Rs/kWh)
    df["MCP"] = pd.to_numeric(df["MCP"], errors="coerce")
    df = df.dropna(subset=["MCP"])
    
    # Heuristic: If mean MCP > 100, it's likely Rs/MWh, so divide by 1000
    # If it's < 100, it's likely already Rs/kWh
    detected_unit = "Rs/kWh"
    if df["MCP"].mean() > 100:
        df["MCP"] = df["MCP"] / 1000.0
        detected_unit = "Rs/MWh (Converted to Rs/kWh)"

    df["hour"] = pd.to_numeric(df["hour"], errors="coerce")
    df = df.dropna(subset=["hour"])
    df["hour"] = df["hour"].astype(int) - 1

    # Robust date parsing
    def parse_dates(date_series):
        # Try DD-MM-YYYY first (Indian standard)
        parsed = pd.to_datetime(date_series, errors="coerce", dayfirst=True)
        # If any failed, try without dayfirst
        if parsed.isna().any():
            parsed_standard = pd.to_datetime(date_series, errors="coerce")
            parsed = parsed.fillna(parsed_standard)
        return parsed

    df["datetime"] = parse_dates(df["date"])
    
    # Handle cases where hour is already in the date string
    if df["datetime"].dt.hour.sum() == 0:
        df["datetime"] = df["datetime"] + pd.to_timedelta(df["hour"], unit="h")
    
    df = df.dropna(subset=["datetime"])
    df = df.sort_values("datetime").reset_index(drop=True)

except Exception as e:
    print(json.dumps({"error": f"Data processing error: {str(e)}"}))
    sys.exit(1)

# ================================
# FEATURE ENGINEERING (EXACTLY AS PROVIDED)
# ================================

PEAK_HOURS = list(range(7,11)) + list(range(18,22))

def get_india_season(month):
    if month in [11,12,1,2]: return "Winter"
    elif month in [3,4,5,6]: return "Summer"
    else: return "Monsoon"

def create_eda_aligned_features(series):
    df_fe = pd.DataFrame(index=series.index)
    df_fe["target"] = series.values

    for lag in [1,6,12,24,48,168]:
        df_fe[f"lag_{lag}"] = df_fe["target"].shift(lag)

    for w in [6,24,48]:
        df_fe[f"mean_{w}"] = df_fe["target"].rolling(w).mean().shift(1)
        df_fe[f"std_{w}"]  = df_fe["target"].rolling(w).std().shift(1)

    for span in [12,24]:
        df_fe[f"ewma_{span}"] = df_fe["target"].ewm(span=span, adjust=False).mean().shift(1)

    df_fe["diff_1"]  = df_fe["target"].diff(1)
    df_fe["diff_24"] = df_fe["target"].diff(24)

    df_fe["hour"]  = series.index.hour
    df_fe["dow"]   = series.index.dayofweek
    df_fe["month"] = series.index.month

    df_fe["hour_sin"] = np.sin(2*np.pi*df_fe["hour"]/24)
    df_fe["hour_cos"] = np.cos(2*np.pi*df_fe["hour"]/24)
    df_fe["dow_sin"]  = np.sin(2*np.pi*df_fe["dow"]/7)
    df_fe["dow_cos"]  = np.cos(2*np.pi*df_fe["dow"]/7)

    df_fe["is_weekend"] = (df_fe["dow"]>=5).astype(int)
    df_fe["is_peak"]    = df_fe["hour"].isin(PEAK_HOURS).astype(int)
    df_fe["is_morning_peak"] = df_fe["hour"].isin(range(7,11)).astype(int)
    df_fe["is_evening_peak"] = df_fe["hour"].isin(range(18,22)).astype(int)

    sm = df_fe["month"].map({m:get_india_season(m) for m in range(1,13)})
    df_fe["is_summer"]  = (sm=="Summer").astype(int)
    df_fe["is_monsoon"] = (sm=="Monsoon").astype(int)
    df_fe["is_winter"]  = (sm=="Winter").astype(int)

    peak_only = df_fe["target"].where(df_fe["is_peak"]==1)
    df_fe["rolling_peak_mean_12h"] = peak_only.rolling(12,1).mean().ffill().fillna(0)

    offpeak_only = df_fe["target"].where(df_fe["is_peak"]==0)
    df_fe["rolling_offpeak_mean_168h"] = offpeak_only.rolling(168,1).mean().ffill().fillna(0)

    return df_fe.dropna()

# ================================
# PREDICTION & FORECAST (EXACTLY AS PROVIDED)
# ================================

series = df.set_index("datetime")["MCP"]

# Calculate minimum historical value for lower bound capping (last 31 days)
# We assume 24 blocks per day as per the rest of the script's logic
historical_lookback = 31 * 24
min_historical = float(series.iloc[-historical_lookback:].min()) if len(series) > 0 else 0.0

fe = create_eda_aligned_features(series)

if HAS_MODEL:
    X = fe[feature_cols]
    X_scaled = scaler_x.transform(X)
    fe["predicted_MCP"] = rf_model.predict(X_scaled)
else:
    # Mock prediction if model missing
    fe["predicted_MCP"] = fe["target"] * (0.95 + 0.1 * np.random.random(len(fe)))

# Apply the lower bound cap to backtest predictions as well
fe["predicted_MCP"] = fe["predicted_MCP"].clip(lower=min_historical)

# Metrics
actual = fe["target"]
pred   = fe["predicted_MCP"]
mae  = mean_absolute_error(actual, pred)
rmse = np.sqrt(mean_squared_error(actual, pred))
mape = np.mean(np.abs((actual - pred) / actual)) * 100
dir_acc = (np.sign(actual.diff().iloc[1:]) == np.sign(pred.diff().iloc[1:])).mean() * 100

# Commercial Forecast Logic
recent_30d = series.iloc[-30*24:]
pat = recent_30d.to_frame("MCP")
pat["hour"] = pat.index.hour
pat["dow"]  = pat.index.dayofweek
hour_dow_pattern = pat.groupby(["dow","hour"])["MCP"].mean()
hour_pattern = pat.groupby("hour")["MCP"].mean()
pat["residual"] = pat.apply(
    lambda r: r["MCP"] - hour_dow_pattern.loc[(r["dow"], r["hour"])],
    axis=1
)
residual_sigma = pat.groupby("hour")["residual"].std().fillna(pat["residual"].std())

# Forecast Loop
steps = FORECAST_DAYS * 24
delta = pd.Timedelta(hours=1)
future_vals = []
hybrid_series = series.iloc[-(168+24):].copy()

for _ in range(steps):
    future_ts = hybrid_series.index[-1] + delta
    hour = future_ts.hour
    dow  = future_ts.dayofweek
    baseline = hour_dow_pattern.get((dow,hour), hour_pattern.loc[hour])
    
    fe_tmp = create_eda_aligned_features(hybrid_series)
    
    if HAS_MODEL:
        X_last = scaler_x.transform(fe_tmp.iloc[-1:][feature_cols])
        ml_pred = rf_model.predict(X_last)[0]
    else:
        ml_pred = baseline * (0.98 + 0.04 * np.random.random())
        
    level = 0.65*ml_pred + 0.35*baseline
    noise = np.random.normal(0.0, residual_sigma.loc[hour])
    final_pred = max(min_historical, level + noise) # Ensure doesn't go below historical min
    hybrid_series.loc[future_ts] = final_pred
    future_vals.append(final_pred)

# Prepare Output
forecast_results = []
for ts, val in zip(hybrid_series.index[-steps:], future_vals):
    forecast_results.append({
        "datetime": ts.strftime("%Y-%m-%d %H:%M"),
        "mcp": float(max(min_historical, val)) # Ensure doesn't go below historical min
    })

backtest_results = []
# Return last PLOT_DAYS of history + backtest
plot_start = fe.index.max() - pd.Timedelta(days=PLOT_DAYS)
plot_fe = fe[fe.index >= plot_start]
for ts, row in plot_fe.iterrows():
    backtest_results.append({
        "datetime": ts.strftime("%Y-%m-%d %H:%M"),
        "actual": float(max(0.0, row["target"])),
        "predicted": float(max(min_historical, row["predicted_MCP"])) # Ensure doesn't go below historical min
    })

output = {
    "modelUsed": "Real Model" if HAS_MODEL else "Mock Model",
    "metrics": {
        "mae": float(mae),
        "rmse": float(rmse),
        "mape": float(mape),
        "dir_acc": float(dir_acc)
    },
    "forecast": forecast_results,
    "backtest": backtest_results,
    "hasModel": HAS_MODEL,
    "modelError": MODEL_ERROR,
    "detectedUnit": detected_unit
}

if not HAS_MODEL:
    output["warning"] = "No pipeline artifact found in ./models. Using fallback logic."

print(json.dumps(output))
