import sys
import json
import pandas as pd
import numpy as np
from pulp import (
    LpProblem, LpMaximize, LpVariable,
    lpSum, PULP_CBC_CMD
)

def run_milp_optimization(prices_data, config):
    try:
        # 1. Extract Inputs
        P_MAX_MW = float(config.get("capacityMw", 100))
        DURATION_HR = float(config.get("duration", 2))
        E_MAX_MWH = P_MAX_MW * DURATION_HR
        
        SOC_MIN = float(config.get("socMin", 10)) / 100
        SOC_MAX = float(config.get("socMax", 90)) / 100
        SOC_INIT = float(config.get("socInit", 50)) / 100
        
        ETA_C = float(config.get("etaC", 95)) / 100
        ETA_D = float(config.get("etaD", 95)) / 100
        
        C_DEG_KWH = float(config.get("degradation", config.get("cDeg", 0.5)))
        MAX_CYCLES_PER_DAY = float(config.get("cycles", 1))
        
        rolling_days = int(config.get("rollingDays", 7))
        
        # 2. Prepare Data
        forecast_df = pd.DataFrame(prices_data)
        forecast_df["datetime"] = pd.to_datetime(forecast_df["datetime"])
        forecast_df = forecast_df.sort_values("datetime").reset_index(drop=True)
        
        # Determine time resolution
        dt_hours = 1.0
        if len(forecast_df) > 1:
            dt_hours = (forecast_df["datetime"].iloc[1] - forecast_df["datetime"].iloc[0]).total_seconds() / 3600
        
        blocks_per_day = int(round(24 / dt_hours))
        T_full = len(forecast_df)
        rolling_blocks = int(rolling_days * blocks_per_day)
        T_sim = min(T_full, rolling_blocks)
        num_days_full = T_sim * dt_hours / 24
        
        # 3. Rolling Optimization
        current_SOC = SOC_INIT
        cumulative_discharge_energy = 0.0
        cum_profit = 0.0
        results = []
        
        # We optimize in daily steps
        for start in range(0, T_sim, blocks_per_day):
            # Window for optimization
            window_end = min(start + rolling_blocks, T_full)
            window_df = forecast_df.iloc[start:window_end].reset_index(drop=True)
            T = len(window_df)
            
            if T == 0:
                break
                
            model = LpProblem("BESS_Arbitrage_Optimiser", LpMaximize)
            
            P_charge = LpVariable.dicts("P_charge", range(T), 0, P_MAX_MW)
            P_discharge = LpVariable.dicts("P_discharge", range(T), 0, P_MAX_MW)
            SOC = LpVariable.dicts("SOC", range(T+1), SOC_MIN, SOC_MAX)
            y_c = LpVariable.dicts("y_charge", range(T), 0, 1, cat="Binary")
            y_d = LpVariable.dicts("y_discharge", range(T), 0, 1, cat="Binary")
            
            model += SOC[0] == current_SOC
            
            # Objective: Maximize Profit
            # Profit = (Discharge * Price * η_d - Charge * Price / η_c - DegCost * (Charge + Discharge)) * dt
            model += lpSum(
                (
                    P_discharge[t] * 1000 * window_df.loc[t, "mcp"] * ETA_D
                    - P_charge[t] * 1000 * window_df.loc[t, "mcp"] / ETA_C
                    - C_DEG_KWH * 1000 * (P_charge[t] + P_discharge[t])
                ) * dt_hours
                for t in range(T)
            )
            
            for t in range(T):
                # SOC Balance
                model += (
                    SOC[t+1]
                    == SOC[t]
                    + (
                        P_charge[t] * ETA_C
                        - P_discharge[t] / ETA_D
                    ) * dt_hours / E_MAX_MWH
                )
                
                # Exclusivity and Power Limits
                model += P_charge[t] <= y_c[t] * P_MAX_MW
                model += P_discharge[t] <= y_d[t] * P_MAX_MW
                model += y_c[t] + y_d[t] <= 1
            
            # Cycle Constraint (over the rolling window)
            # Total discharge energy <= MaxCycles * Capacity * Days
            window_days = T * dt_hours / 24
            model += lpSum(
                P_discharge[t] * dt_hours for t in range(T)
            ) <= MAX_CYCLES_PER_DAY * E_MAX_MWH * window_days
            
            # Solve
            try:
                solver = PULP_CBC_CMD(msg=0)
                model.solve(solver)
            except:
                model.solve()
            
            # Execute ONLY the first day of the optimized window
            exec_steps = min(blocks_per_day, T)
            for t in range(exec_steps):
                global_idx = start + t
                price = forecast_df.loc[global_idx, "mcp"]
                
                pc = float(P_charge[t].varValue or 0.0)
                pd_ = float(P_discharge[t].varValue or 0.0)
                
                mode = "IDLE"
                if pc > 1e-4:
                    mode = "CHARGE"
                elif pd_ > 1e-4:
                    mode = "DISCHARGE"
                    
                profit = (
                    pd_ * 1000 * price * ETA_D
                    - pc * 1000 * price / ETA_C
                    - C_DEG_KWH * 1000 * (pc + pd_)
                ) * dt_hours
                
                cum_profit += profit
                cumulative_discharge_energy += pd_ * dt_hours
                
                # Update SOC for next step
                current_SOC = current_SOC + (pc * ETA_C - pd_ / ETA_D) * dt_hours / E_MAX_MWH
                current_SOC = max(SOC_MIN, min(SOC_MAX, current_SOC))
                
                results.append({
                    "datetime": forecast_df.loc[global_idx, "datetime"].strftime("%Y-%m-%d %H:%M"),
                    "mcp": float(price),
                    "mode": mode,
                    "action": mode.lower(),
                    "charge_mw": float(pc),
                    "discharge_mw": float(pd_),
                    "soc": float(current_SOC * 100),
                    "profit": float(profit),
                    "cum_profit": float(cum_profit)
                })
                
        # 4. Forecast Diagnostics
        prices_only = forecast_df["mcp"]
        price_mean = float(prices_only.mean())
        price_std = float(prices_only.std())
        price_min = float(prices_only.min())
        price_max = float(prices_only.max())
        price_range = price_max - price_min
        
        p10 = float(np.percentile(prices_only, 10))
        p90 = float(np.percentile(prices_only, 90))
        spread_p90_p10 = p90 - p10
        
        forecast_df["date"] = forecast_df["datetime"].dt.date
        daily_spread = forecast_df.groupby("date")["mcp"].agg(lambda x: x.max() - x.min())
        avg_daily_spread = float(daily_spread.mean())
        max_daily_spread = float(daily_spread.max())
        
        diagnostics = {
            "meanPrice": f"{price_mean:.3f}",
            "stdDev": f"{price_std:.3f}",
            "minPrice": f"{price_min:.3f}",
            "maxPrice": f"{price_max:.3f}",
            "priceRange": f"{price_range:.3f}",
            "p90p10Spread": f"{spread_p90_p10:.3f}",
            "avgDailySpread": f"{avg_daily_spread:.3f}",
            "maxDailySpread": f"{max_daily_spread:.3f}"
        }
        
        # 5. Final KPIs
        total_cycles = cumulative_discharge_energy / E_MAX_MWH
        avg_cycles_per_day = total_cycles / num_days_full if num_days_full > 0 else 0
        
        charge_duration = sum(1 for r in results if r["mode"] == "CHARGE") * dt_hours
        discharge_duration = sum(1 for r in results if r["mode"] == "DISCHARGE") * dt_hours
        idle_duration = sum(1 for r in results if r["mode"] == "IDLE") * dt_hours
        
        best_discharge = sorted([r for r in results if r["mode"] == "DISCHARGE"], key=lambda x: x["mcp"], reverse=True)
        best_charge = sorted([r for r in results if r["mode"] == "CHARGE"], key=lambda x: x["mcp"])
        
        output = {
            "results": results,
            "diagnostics": diagnostics,
            "summary": {
                "totalProfit": f"{cum_profit:.2f}",
                "totalCycles": f"{total_cycles:.2f}",
                "avgCyclesPerDay": f"{avg_cycles_per_day:.2f}",
                "chargeDuration": f"{charge_duration:.2f}",
                "dischargeDuration": f"{discharge_duration:.2f}",
                "idleDuration": f"{idle_duration:.2f}",
                "bestDischargeWindow": best_discharge[0]["datetime"] if best_discharge else "N/A",
                "bestDischargePrice": f"{best_discharge[0]['mcp']:.2f}" if best_discharge else "0.00",
                "bestChargeWindow": best_charge[0]["datetime"] if best_charge else "N/A",
                "bestChargePrice": f"{best_charge[0]['mcp']:.2f}" if best_charge else "0.00",
                "dailyRevenue": f"{(cum_profit / num_days_full):.2f}" if num_days_full > 0 else "0.00",
                "weeklyRevenue": f"{(cum_profit / num_days_full * 7):.2f}" if num_days_full > 0 else "0.00",
                "annualRevenue": f"{(cum_profit / num_days_full * 365):.2f}" if num_days_full > 0 else "0.00"
            }
        }
        return output

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        prices = input_data.get("prices", [])
        config = input_data.get("config", {})
        
        result = run_milp_optimization(prices, config)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
