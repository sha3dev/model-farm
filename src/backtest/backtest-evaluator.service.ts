/**
 * @section imports:externals
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import { ModelConfigResolverService } from "../model/model-config-resolver.service.ts";
import { ModelArtifactRepository } from "../model-catalog/model-artifact.repository.ts";
import type {
  BacktestEvaluationOptions,
  BacktestEvaluationResult,
  BacktestStats,
  RelevantPrediction,
  ResolvedOutcome
} from "../model-catalog/model-catalog.types.ts";
import type { SequenceMetadata } from "../training/tensorflow-sequence-dataset.service.ts";
import { TensorflowSequenceDatasetService } from "../training/tensorflow-sequence-dataset.service.ts";
import { TensorflowRuntimeService } from "../training/tensorflow-runtime.service.ts";

/**
 * @section consts
 */

const MINIMUM_BACKTEST_SNAPSHOTS = 1;

/**
 * @section types
 */

type BacktestEvaluatorServiceOptions = {
  artifactRepository: ModelArtifactRepository;
  modelConfigResolverService: ModelConfigResolverService;
  tensorflowSequenceDatasetService: TensorflowSequenceDatasetService;
  tensorflowRuntimeService: TensorflowRuntimeService;
};

export class BacktestEvaluatorService {
  /**
   * @section private:attributes
   */

  // empty

  /**
   * @section protected:attributes
   */

  // empty

  /**
   * @section private:properties
   */

  private readonly artifactRepository: ModelArtifactRepository;
  private readonly modelConfigResolverService: ModelConfigResolverService;
  private readonly tensorflowSequenceDatasetService: TensorflowSequenceDatasetService;
  private readonly tensorflowRuntimeService: TensorflowRuntimeService;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: BacktestEvaluatorServiceOptions) {
    this.artifactRepository = options.artifactRepository;
    this.modelConfigResolverService = options.modelConfigResolverService;
    this.tensorflowSequenceDatasetService = options.tensorflowSequenceDatasetService;
    this.tensorflowRuntimeService = options.tensorflowRuntimeService;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): BacktestEvaluatorService {
    const backtestEvaluatorService = new BacktestEvaluatorService({
      artifactRepository: ModelArtifactRepository.createDefault(),
      modelConfigResolverService: ModelConfigResolverService.create(),
      tensorflowSequenceDatasetService: TensorflowSequenceDatasetService.create(),
      tensorflowRuntimeService: TensorflowRuntimeService.create()
    });
    return backtestEvaluatorService;
  }

  /**
   * @section private:methods
   */

  private assertMinimumSnapshots(snapshotCount: number): void {
    if (snapshotCount < MINIMUM_BACKTEST_SNAPSHOTS) {
      throw new Error(`Backtesting requires at least ${MINIMUM_BACKTEST_SNAPSHOTS} snapshots`);
    }
  }

  private calculateAuc(labels: readonly number[], probabilities: readonly number[]): number | null {
    const positiveScores = probabilities.filter((_, index) => {
      return labels[index] === 1;
    });
    const negativeScores = probabilities.filter((_, index) => {
      return labels[index] === 0;
    });
    let auc: number | null = null;
    if (positiveScores.length > 0 && negativeScores.length > 0) {
      let winCount = 0;
      let comparisonCount = 0;
      for (const positiveScore of positiveScores) {
        for (const negativeScore of negativeScores) {
          if (positiveScore > negativeScore) {
            winCount += 1;
          } else if (positiveScore === negativeScore) {
            winCount += 0.5;
          }
          comparisonCount += 1;
        }
      }
      auc = comparisonCount === 0 ? null : winCount / comparisonCount;
    }
    return auc;
  }

  private hasTensorflowArtifact(artifactPath: string): boolean {
    const modelFilePath = join(artifactPath, "model.json");
    const hasTensorflowArtifact = existsSync(modelFilePath);
    return hasTensorflowArtifact;
  }

  private calculateSyntheticProbabilities(inputs: readonly number[][][]): number[] {
    const probabilities = inputs.map((sequence) => {
      const lastFeatureRow = sequence[sequence.length - 1] ?? [];
      const rowSum = lastFeatureRow.reduce((sum, value) => sum + value, 0);
      const probability = 1 / (1 + Math.exp(-(rowSum / 100)));
      return probability;
    });
    return probabilities;
  }

  private calculateLogLoss(labels: readonly number[], probabilities: readonly number[]): number {
    const clippedProbabilities = probabilities.map((probability) => {
      const clippedProbability = Math.min(0.999999, Math.max(0.000001, probability));
      return clippedProbability;
    });
    const logLoss =
      clippedProbabilities.reduce((sum, probability, index) => {
        const label = labels[index] ?? 0;
        const nextValue = label === 1 ? -Math.log(probability) : -Math.log(1 - probability);
        return sum + nextValue;
      }, 0) / clippedProbabilities.length;
    return logLoss;
  }

  private resolveOutcome(market: BacktestEvaluationOptions["market"]): ResolvedOutcome {
    const resolvedMarket = market ?? { finalPrice: 0, priceToBeat: 0 };
    const targetDelta = (resolvedMarket.finalPrice ?? 0) - (resolvedMarket.priceToBeat ?? 0);
    let resolvedOutcome: ResolvedOutcome = "flat";
    if (targetDelta > 0) {
      resolvedOutcome = "up";
    } else if (targetDelta < 0) {
      resolvedOutcome = "down";
    }
    return resolvedOutcome;
  }

  private formatMinuteOffsetLabel(sequenceMetadata: SequenceMetadata): string {
    const elapsedMs = Math.max(0, sequenceMetadata.snapshotTs - sequenceMetadata.marketStartTs);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    const minutes = Math.floor(elapsedSeconds / 60);
    const seconds = elapsedSeconds % 60;
    const minuteOffsetLabel = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return minuteOffsetLabel;
  }

  private buildRelevantPrediction(
    probabilities: readonly number[],
    sequenceMetadata: readonly SequenceMetadata[],
    resolvedOutcome: ResolvedOutcome
  ): RelevantPrediction | null {
    const relevantConfidenceThreshold = CONFIG.MODEL_BACKTEST_RELEVANT_CONFIDENCE_THRESHOLD;
    let relevantPrediction: RelevantPrediction | null = null;
    for (let index = 0; index < probabilities.length && relevantPrediction === null; index += 1) {
      const finalPriceProbUp = probabilities[index] ?? 0.5;
      const finalPriceProbDown = 1 - finalPriceProbUp;
      const confidence = Math.max(finalPriceProbUp, finalPriceProbDown);
      const metadata = sequenceMetadata[index] ?? null;
      if (confidence >= relevantConfidenceThreshold && metadata !== null) {
        const predictedClass: "up" | "down" = finalPriceProbUp >= finalPriceProbDown ? "up" : "down";
        const isCorrect = resolvedOutcome === "flat" ? null : predictedClass === resolvedOutcome;
        relevantPrediction = {
          snapshotTs: metadata.snapshotTs,
          minuteOffsetLabel: this.formatMinuteOffsetLabel(metadata),
          predictedClass,
          confidence,
          finalPriceProbUp,
          finalPriceProbDown,
          probabilityUp: finalPriceProbUp,
          probabilityDown: finalPriceProbDown,
          pmUpPrice: metadata.pmUpPrice,
          pmDownPrice: metadata.pmDownPrice,
          isCorrect
        };
      }
    }
    return relevantPrediction;
  }

  private resolveEvaluationWindows(options: BacktestEvaluationOptions) {
    const hasExplicitWindows = Array.isArray(options.windows) && options.windows.length > 0;
    const hasLegacyWindow = Array.isArray(options.snapshots) && options.snapshots.length > 0 && options.market !== undefined;
    let evaluationWindows = options.windows ?? [];
    if (!hasExplicitWindows && hasLegacyWindow && options.market) {
      evaluationWindows = [
        {
          marketSlug: options.snapshots?.[0]
            ? `${options.snapshots[0].asset}-${options.snapshots[0].window}-${options.snapshots[0].marketStartTs}-${options.snapshots[0].marketEndTs}`
            : "unknown-market",
          marketStartTs: options.snapshots?.[0]?.marketStartTs ?? 0,
          marketEndTs: options.snapshots?.[0]?.marketEndTs ?? 0,
          snapshots: options.snapshots ?? [],
          market: options.market
        }
      ];
    }
    if (evaluationWindows.length === 0) {
      throw new Error(`Backtest evaluation requires at least one window for ${options.asset}/${options.window}`);
    }
    return evaluationWindows;
  }

  private buildBacktestStats(
    evaluationDataset: ReturnType<TensorflowSequenceDatasetService["buildEvaluationDataset"]>,
    probabilities: readonly number[],
    artifactPath: string,
    latestMarket: NonNullable<BacktestEvaluationOptions["market"]>
  ): BacktestStats {
    const artifactState = this.artifactRepository.readArtifactState(artifactPath);
    const predictedUps: number[] = probabilities.map((probability) => {
      const predictedUp = probability >= artifactState.inference.decisionThreshold ? 1 : 0;
      return predictedUp;
    });
    const classMatches = predictedUps.map((predictedUp, index) => {
      const label = evaluationDataset.labels[index] ?? 0;
      const isMatch = predictedUp === label;
      const matchAsNumber = isMatch ? 1 : 0;
      return matchAsNumber;
    });
    const tp = predictedUps.reduce((sum: number, predictedUp, index) => {
      const label = evaluationDataset.labels[index] ?? 0;
      const nextValue = predictedUp === 1 && label === 1 ? 1 : 0;
      return sum + nextValue;
    }, 0);
    const fp = predictedUps.reduce((sum: number, predictedUp, index) => {
      const label = evaluationDataset.labels[index] ?? 0;
      const nextValue = predictedUp === 1 && label === 0 ? 1 : 0;
      return sum + nextValue;
    }, 0);
    const fn = predictedUps.reduce((sum: number, predictedUp, index) => {
      const label = evaluationDataset.labels[index] ?? 0;
      const nextValue = predictedUp === 0 && label === 1 ? 1 : 0;
      return sum + nextValue;
    }, 0);
    const accuracy = classMatches.length === 0 ? 0 : classMatches.reduce((sum: number, value) => sum + value, 0) / classMatches.length;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const logLoss = probabilities.length === 0 ? 0 : this.calculateLogLoss(evaluationDataset.labels, probabilities);
    const auc = this.calculateAuc(evaluationDataset.labels, probabilities);
    const latestMarketEndTs = Math.max(...evaluationDataset.sequenceMetadata.map((metadata) => metadata.marketEndTs));
    const latestProbabilities = probabilities.filter((_, index) => {
      return (evaluationDataset.sequenceMetadata[index]?.marketEndTs ?? 0) === latestMarketEndTs;
    });
    const latestSequenceMetadata = evaluationDataset.sequenceMetadata.filter((metadata) => metadata.marketEndTs === latestMarketEndTs);
    const resolvedOutcome = this.resolveOutcome(latestMarket);
    const firstRelevantPrediction = this.buildRelevantPrediction(latestProbabilities, latestSequenceMetadata, resolvedOutcome);
    const backtestStats: BacktestStats = {
      lastRunTs: Date.now(),
      sampleWindowCount: evaluationDataset.inputs.length,
      auc,
      f1,
      accuracy,
      precision,
      recall,
      logLoss,
      resolvedOutcome,
      firstRelevantPrediction
    };
    return backtestStats;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async evaluate(options: BacktestEvaluationOptions): Promise<BacktestEvaluationResult> {
    const evaluationWindows = this.resolveEvaluationWindows(options);
    const latestWindow = evaluationWindows[evaluationWindows.length - 1];
    if (!latestWindow) {
      throw new Error(`Backtest evaluation requires a latest window for ${options.asset}/${options.window}`);
    }
    this.assertMinimumSnapshots(evaluationWindows.reduce((sum, windowDataset) => sum + windowDataset.snapshots.length, 0));
    const modelConfig = this.modelConfigResolverService.resolveByWindow(options.window);
    const artifactState = this.artifactRepository.readArtifactState(options.artifactPath);
    const evaluationDataset = this.tensorflowSequenceDatasetService.buildEvaluationDatasetForWindows({
      windows: evaluationWindows,
      modelConfig,
      artifactState
    });
    let probabilities: number[] = [];
    if (this.hasTensorflowArtifact(options.artifactPath)) {
      const model = await this.tensorflowRuntimeService.loadModel(options.artifactPath);
      probabilities = await this.tensorflowRuntimeService.predictProbabilities(model, evaluationDataset.inputs);
      model.dispose();
    } else {
      probabilities = this.calculateSyntheticProbabilities(evaluationDataset.inputs);
    }
    const stats = this.buildBacktestStats(evaluationDataset, probabilities, options.artifactPath, latestWindow.market);
    const stabilityFactor = Math.min(1, Math.max(0, 1 - Math.abs(0.5 - (stats.accuracy ?? 0))));
    const backtestEvaluationResult: BacktestEvaluationResult = { stats, stabilityFactor };
    return backtestEvaluationResult;
  }

  /**
   * @section static:methods
   */

  // empty
}
