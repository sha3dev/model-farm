/**
 * @section imports:externals
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AssetSymbol, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import type { ModelConfigResolverService } from "../model/model-config-resolver.service.ts";
import type { ModelArtifactRepository } from "./model-artifact.repository.ts";
import type { BacktestStats, PredictResult, TrainingStats } from "./model-catalog.types.ts";
import type { TensorflowSequenceDatasetService } from "../training/tensorflow-sequence-dataset.service.ts";
import type { TensorflowRuntimeService } from "../training/tensorflow-runtime.service.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

type PredictiveModelOptions = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  score: number;
  trainingStats: TrainingStats;
  backtestStats: BacktestStats;
  minimumSnapshotCount: number;
  artifactPath: string;
  artifactRepository: ModelArtifactRepository;
  modelConfigResolverService: ModelConfigResolverService;
  tensorflowSequenceDatasetService: TensorflowSequenceDatasetService;
  tensorflowRuntimeService: TensorflowRuntimeService;
};

export class PredictiveModel {
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

  private readonly minimumSnapshotCount: number;
  private readonly artifactPath: string;
  private readonly artifactRepository: ModelArtifactRepository;
  private readonly modelConfigResolverService: ModelConfigResolverService;
  private readonly tensorflowSequenceDatasetService: TensorflowSequenceDatasetService;
  private readonly tensorflowRuntimeService: TensorflowRuntimeService;

  /**
   * @section public:properties
   */

  public readonly modelId: string;
  public readonly modelVersion: string;
  public readonly asset: AssetSymbol;
  public readonly window: MarketWindow;
  public readonly score: number;
  public readonly trainingStats: TrainingStats;
  public readonly backtestStats: BacktestStats;

  /**
   * @section constructor
   */

  public constructor(options: PredictiveModelOptions) {
    this.modelId = options.modelId;
    this.modelVersion = options.modelVersion;
    this.asset = options.asset;
    this.window = options.window;
    this.score = options.score;
    this.trainingStats = options.trainingStats;
    this.backtestStats = options.backtestStats;
    this.minimumSnapshotCount = options.minimumSnapshotCount;
    this.artifactPath = options.artifactPath;
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

  public static create(options: PredictiveModelOptions): PredictiveModel {
    const predictiveModel = new PredictiveModel(options);
    return predictiveModel;
  }

  /**
   * @section private:methods
   */

  private assertSnapshotOrder(snapshots: readonly MarketSnapshot[]): void {
    for (let index = 1; index < snapshots.length; index += 1) {
      const previousSnapshot = snapshots[index - 1];
      const currentSnapshot = snapshots[index];
      if (!previousSnapshot || !currentSnapshot) {
        throw new Error(`Model ${this.modelId} failed to compare snapshot order due to missing values`);
      }
      const previousTs = previousSnapshot.snapshotTs;
      const currentTs = currentSnapshot.snapshotTs;
      if (currentTs < previousTs) {
        throw new Error(`Model ${this.modelId} requires snapshotTs ascending order`);
      }
    }
  }

  private assertSnapshotScope(snapshots: readonly MarketSnapshot[]): void {
    const hasMismatchedSnapshot = snapshots.some((snapshot) => {
      const isMismatchedSnapshot = snapshot.asset !== this.asset || snapshot.window !== this.window;
      return isMismatchedSnapshot;
    });
    if (hasMismatchedSnapshot) {
      throw new Error(`Model ${this.modelId} expects snapshots for ${this.asset}/${this.window} only`);
    }
  }

  private buildPredictionResult(rawProbability: number, decisionThreshold: number): PredictResult {
    const finalPriceProbUp = rawProbability;
    const finalPriceProbDown = 1 - finalPriceProbUp;
    const predictedClass: "up" | "down" = finalPriceProbUp >= decisionThreshold ? "up" : "down";
    const confidence = Math.max(finalPriceProbUp, finalPriceProbDown);
    const predictResult: PredictResult = {
      finalPriceProbUp,
      finalPriceProbDown,
      probabilityUp: finalPriceProbUp,
      probabilityDown: finalPriceProbDown,
      predictedClass,
      confidence,
      modelId: this.modelId,
      modelVersion: this.modelVersion,
      inferenceTs: Date.now()
    };
    return predictResult;
  }

  private hasTensorflowArtifact(): boolean {
    const modelFilePath = join(this.artifactPath, "model.json");
    const hasTensorflowArtifact = existsSync(modelFilePath);
    return hasTensorflowArtifact;
  }

  private buildFallbackProbability(lastFeatureRow: readonly number[]): number {
    const artifactState = this.artifactRepository.readArtifactState(this.artifactPath);
    const featureSum = lastFeatureRow.reduce((sum, value) => sum + value, 0);
    const scale = artifactState.scale ?? 0.01;
    const bias = artifactState.bias ?? 0;
    const rawScore = bias + scale * featureSum;
    const probability = 1 / (1 + Math.exp(-rawScore));
    return probability;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async predict(snapshots: readonly MarketSnapshot[]): Promise<PredictResult | null> {
    this.assertSnapshotOrder(snapshots);
    this.assertSnapshotScope(snapshots);
    const artifactState = this.artifactRepository.readArtifactState(this.artifactPath);
    const modelConfig = this.modelConfigResolverService.resolveByWindow(this.window);
    const hasMinimumSnapshots = snapshots.length >= this.minimumSnapshotCount;
    const preparedPredictionSequence = hasMinimumSnapshots
      ? this.tensorflowSequenceDatasetService.buildPredictionSequence({ snapshots, modelConfig, artifactState })
      : null;
    let predictResult: PredictResult | null = null;
    if (preparedPredictionSequence) {
      let probabilityUp = 0.5;
      if (this.hasTensorflowArtifact()) {
        const model = await this.tensorflowRuntimeService.loadModel(this.artifactPath);
        const probabilities = await this.tensorflowRuntimeService.predictProbabilities(model, preparedPredictionSequence.input);
        model.dispose();
        probabilityUp = probabilities[0] ?? 0.5;
      } else {
        const lastFeatureRow = preparedPredictionSequence.input[0]?.[preparedPredictionSequence.input[0].length - 1] ?? null;
        if (lastFeatureRow !== null) {
          probabilityUp = this.buildFallbackProbability(lastFeatureRow);
        }
      }
      predictResult = this.buildPredictionResult(probabilityUp, artifactState.inference.decisionThreshold);
    }
    return predictResult;
  }

  /**
   * @section static:methods
   */

  // empty
}
