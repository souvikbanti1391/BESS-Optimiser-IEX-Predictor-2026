export interface PriceData {
  datetime: string;
  mcp: number; // Rs/MWh or Rs/kWh
  bidVol?: number;
  saleVol?: number;
}

export interface PredictionResult {
  datetime: string;
  predicted: number;
  actual?: number;
}

export interface OptimizationResult {
  datetime: string;
  mcp: number;
  action: 'charge' | 'discharge' | 'idle';
  soc: number;
}

export interface BessConfig {
  capacityMw: number;
  energyMwh: number;
  cyclesPerDay: number;
  hoursPerCycle: number;
  socMin: number;
  socMax: number;
  degradation: number;
}
