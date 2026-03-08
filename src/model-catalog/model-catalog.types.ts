/**
 * @section imports:externals
 */

import type { AssetSymbol, MarketRecord, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

// empty

/**
 * @section consts
 */

export const MODEL_STATUS_VALUES = ["ready", "training", "failed", "stale"] as const;

/**
 * @section types
 */

export type ModelStatus = (typeof MODEL_STATUS_VALUES)[number];

export type ResolvedOutcome = "up" | "down" | "flat";

export type RelevantPrediction = {
  snapshotTs: number;
  minuteOffsetLabel: string;
  predictedClass: "up" | "down";
  confidence: number;
  finalPriceProbUp: number;
  finalPriceProbDown: number;
  probabilityUp: number;
  probabilityDown: number;
  pmUpPrice: number | null;
  pmDownPrice: number | null;
  isCorrect: boolean | null;
};

export type BacktestStats = {
  lastRunTs: number | null;
  sampleWindowCount: number;
  auc: number | null;
  f1: number | null;
  accuracy: number | null;
  precision: number | null;
  recall: number | null;
  logLoss: number | null;
  resolvedOutcome: ResolvedOutcome | null;
  firstRelevantPrediction: RelevantPrediction | null;
};

export type TrainingStats = {
  trainedWindowCount: number;
  lastTrainedWindowStartTs: number | null;
  lastTrainedWindowEndTs: number | null;
  lastTrainingTs: number | null;
};

export type PredictResult = {
  finalPriceProbUp: number;
  finalPriceProbDown: number;
  probabilityUp: number;
  probabilityDown: number;
  predictedClass: "up" | "down";
  confidence: number;
  modelId: string;
  modelVersion: string;
  inferenceTs: number;
};

export type ListModelsOptions = { asset: AssetSymbol; window: MarketWindow; limit?: number; includeInactive?: boolean };

export type PredictiveModel = {
  readonly modelId: string;
  readonly modelVersion: string;
  readonly asset: AssetSymbol;
  readonly window: MarketWindow;
  readonly score: number;
  readonly trainingStats: TrainingStats;
  readonly backtestStats: BacktestStats;
  predict(snapshots: readonly MarketSnapshot[]): Promise<PredictResult | null>;
};

export type PersistedModelMetadata = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  trainedWindowCount: number;
  lastTrainedWindowStartTs: number | null;
  lastTrainedWindowEndTs: number | null;
  lastTrainingTs: number | null;
  latestBacktest: BacktestStats;
  score: number;
  status: ModelStatus;
  artifactPath: string;
  minimumSnapshotCount: number;
  featureSpecVersion: string;
  targetSpecVersion: string;
  configHash: string;
};

export type PersistedModelCatalogItem = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  score: number;
  status: ModelStatus;
  artifactPath: string;
  metadataPath: string;
  trainingStats: TrainingStats;
  backtestStats: BacktestStats;
  minimumSnapshotCount: number;
};

export type PersistedModelCatalog = { generatedAtTs: number; models: PersistedModelCatalogItem[] };

export type ModelArtifactState = {
  bias?: number;
  scale?: number;
  updatedAtTs: number;
  tensorflow: { modelFileName: string; featureCount: number };
  preprocessing: { inputScaling: "none" | "standard"; featureMeans: number[]; featureStds: number[] };
  inference: { lookbackCandles: number; minimumValidFeatureRowCount: number; decisionThreshold: number };
  training: {
    totalSequenceCount: number;
    trainSequenceCount: number;
    validationSequenceCount: number;
    testSequenceCount: number;
    epochCount: number;
    finalLoss: number | null;
    finalValidationLoss: number | null;
  };
};

export type ModelWindowDataset = {
  marketSlug: string;
  marketStartTs: number;
  marketEndTs: number;
  snapshots: readonly MarketSnapshot[];
  market: Pick<MarketRecord, "priceToBeat" | "finalPrice">;
};

export type TrainModelOptions = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  windows?: readonly ModelWindowDataset[];
  snapshots?: readonly MarketSnapshot[];
  market?: Pick<MarketRecord, "priceToBeat" | "finalPrice">;
  previousMetadata: PersistedModelMetadata | null;
};

export type TrainModelResult = { metadata: PersistedModelMetadata; artifactState: ModelArtifactState };

export type BacktestEvaluationOptions = {
  asset: AssetSymbol;
  window: MarketWindow;
  windows?: readonly ModelWindowDataset[];
  snapshots?: readonly MarketSnapshot[];
  market?: Pick<MarketRecord, "priceToBeat" | "finalPrice">;
  artifactPath: string;
};

export type BacktestEvaluationResult = { stats: BacktestStats; stabilityFactor: number };
