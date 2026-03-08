/**
 * @section imports:externals
 */

import type { AssetSymbol, MarketRecord, MarketSnapshot, MarketWindow } from "@sha3/click-collector";
import type { BacktestStats } from "../model-catalog/model-catalog.types.ts";

/**
 * @section imports:internals
 */

// empty

/**
 * @section consts
 */

export const validationStatusValues = ["pass", "warning", "fail"] as const;

/**
 * @section types
 */

export type ValidationStatus = (typeof validationStatusValues)[number];
export type ValidationCryptoSourceName = "binance" | "coinbase" | "kraken" | "okx" | "chainlink";

export type CollectorValidationRunOptions = {
  asset: "btc";
  windows: readonly ("5m" | "15m")[];
  marketLimitPerWindow: number;
  reportLabel: string;
  reportDirectoryPath?: string;
};

export type SnapshotAvailabilityStats = {
  hasPriceEventCount: number;
  hasOrderbookEventCount: number;
  priceCoverageRatio: number;
  orderbookCoverageRatio: number;
};

export type SnapshotAnalysisResult = {
  snapshotCount: number;
  firstSnapshotTs: number | null;
  lastSnapshotTs: number | null;
  durationCoveredMs: number;
  isAscendingByTimestamp: boolean;
  hasMixedAsset: boolean;
  hasMixedWindow: boolean;
  hasMissingPriceToBeat: boolean;
  maxGapMs: number;
  spotSourceAvailability: Record<ValidationCryptoSourceName, SnapshotAvailabilityStats>;
  pmBookAvailability: Record<"up" | "down", SnapshotAvailabilityStats>;
  pmPriceAvailability: Record<"up" | "down", SnapshotAvailabilityStats>;
  failures: readonly string[];
  warnings: readonly string[];
};

export type FeatureValueStats = {
  min: number | null;
  max: number | null;
  mean: number | null;
  isConstant: boolean;
  hasNonFiniteValue: boolean;
  maxAbsValue: number | null;
};

export type FeatureSampleRecord = {
  snapshotTs: number;
  windowProgressApprox: number;
  priceToBeat: number | null;
  finalPrice: number | null;
  targetDelta: number;
  featureRow: readonly number[];
  featureMap: Record<string, number>;
  pmUpMid: number | null;
  pmDownMid: number | null;
  distanceToStrikeBySource: Partial<Record<ValidationCryptoSourceName, number>>;
  return5sBySource: Partial<Record<ValidationCryptoSourceName, number>>;
  return20sBySource: Partial<Record<ValidationCryptoSourceName, number>>;
};

export type CorrelationStats = { correlation: number | null; pairCount: number };

export type CoherenceAnalysisResult = {
  directionalAgreementRatioBySource: Partial<Record<ValidationCryptoSourceName, number>>;
  pmComplementDeviation: { min: number | null; max: number | null; meanAbsDeviation: number | null };
  probabilityMomentumAgreementBySource: Partial<Record<ValidationCryptoSourceName, number>>;
  probabilityMomentumCorrelationBySource: Partial<Record<ValidationCryptoSourceName, CorrelationStats>>;
  strikeDistanceSensitivityBySource: Partial<Record<ValidationCryptoSourceName, CorrelationStats>>;
  timeToExpirySensitivity: CorrelationStats;
  orderbookConsistencyFailureCount: number;
  warnings: readonly string[];
  failures: readonly string[];
};

export type FeatureAnalysisResult = {
  featureRowCount: number;
  nullRowCount: number;
  validRowCount: number;
  nullRowRatio: number;
  featureLengthMismatchCount: number;
  featureSpecVersion: string;
  featureOrder: readonly string[];
  featureStatsByName: Record<string, FeatureValueStats>;
  randomSamples: readonly FeatureSampleRecord[];
  coherence: CoherenceAnalysisResult;
  failures: readonly string[];
  warnings: readonly string[];
};

export type TrainingExecutionResult = {
  modelId: string;
  modelVersion: string;
  artifactPath: string;
  metadataPath: string;
  backtestMode: "synthetic_v1";
  backtestStats: BacktestStats;
  score: number;
  predictionProbabilitySummary: { min: number | null; max: number | null; mean: number | null };
  classDistribution: { upCount: number; downCount: number };
  targetDeltaSign: "up" | "down" | "flat";
  validFeatureRowCount: number;
};

export type ProcessedMarketReport = {
  slug: string;
  asset: AssetSymbol;
  window: MarketWindow;
  marketStartTs: number;
  marketEndTs: number;
  priceToBeat: number | null;
  finalPrice: number | null;
  snapshotAnalysis: SnapshotAnalysisResult;
  featureAnalysis: FeatureAnalysisResult;
  trainingExecution: TrainingExecutionResult | null;
  status: ValidationStatus;
  failures: readonly string[];
  warnings: readonly string[];
};

export type RejectedMarketReport = {
  slug: string;
  asset: AssetSymbol;
  window: MarketWindow;
  reason: string;
  snapshotCount: number;
  failures: readonly string[];
  warnings: readonly string[];
};

export type WindowValidationReport = {
  asset: AssetSymbol;
  window: MarketWindow;
  processedMarkets: readonly ProcessedMarketReport[];
  rejectedMarkets: readonly RejectedMarketReport[];
  status: ValidationStatus;
  warningCount: number;
  failureCount: number;
};

export type CollectorValidationRunResult = {
  runTs: number;
  asset: AssetSymbol;
  windows: readonly MarketWindow[];
  collectorHost: string;
  reportRootPath: string;
  summaryFilePath: string;
  consoleSummaryFilePath: string;
  windowReportFilePaths: readonly string[];
  processedMarketCount: number;
  rejectedMarketCount: number;
  trainingExecutionCount: number;
  backtestExecutionCount: number;
  warnings: readonly string[];
  failures: readonly string[];
};

export type SelectedMarket = { market: MarketRecord; snapshots: readonly MarketSnapshot[] };
