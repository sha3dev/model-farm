/**
 * @section imports:externals
 */

import { createHash } from "node:crypto";

/**
 * @section imports:internals
 */

import { featureSpecVersion, targetSpecVersion } from "../dataset/feature-target-builder.ts";
import { ModelConfigResolverService } from "../model/model-config-resolver.service.ts";
import { ModelArtifactRepository } from "../model-catalog/model-artifact.repository.ts";
import { ModelMetadataRepository } from "../model-catalog/model-metadata.repository.ts";
import type { BacktestStats, ModelArtifactState, PersistedModelMetadata, TrainModelOptions, TrainModelResult } from "../model-catalog/model-catalog.types.ts";
import { TensorflowSequenceDatasetService } from "./tensorflow-sequence-dataset.service.ts";
import { TensorflowRuntimeService } from "./tensorflow-runtime.service.ts";

/**
 * @section consts
 */

const DEFAULT_BACKTEST_STATS: BacktestStats = {
  lastRunTs: null,
  sampleWindowCount: 0,
  auc: null,
  f1: null,
  accuracy: null,
  precision: null,
  recall: null,
  logLoss: null,
  resolvedOutcome: null,
  firstRelevantPrediction: null
};

/**
 * @section types
 */

type ModelTrainerServiceOptions = {
  artifactRepository: ModelArtifactRepository;
  metadataRepository: ModelMetadataRepository;
  modelConfigResolverService?: ModelConfigResolverService;
  tensorflowSequenceDatasetService?: TensorflowSequenceDatasetService;
  tensorflowRuntimeService?: TensorflowRuntimeService;
};

export class ModelTrainerService {
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
  private readonly metadataRepository: ModelMetadataRepository;
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

  public constructor(options: ModelTrainerServiceOptions) {
    this.artifactRepository = options.artifactRepository;
    this.metadataRepository = options.metadataRepository;
    this.modelConfigResolverService = options.modelConfigResolverService ?? ModelConfigResolverService.create();
    this.tensorflowSequenceDatasetService = options.tensorflowSequenceDatasetService ?? TensorflowSequenceDatasetService.create();
    this.tensorflowRuntimeService = options.tensorflowRuntimeService ?? TensorflowRuntimeService.create();
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): ModelTrainerService {
    const modelTrainerService = new ModelTrainerService({
      artifactRepository: ModelArtifactRepository.createDefault(),
      metadataRepository: ModelMetadataRepository.create(),
      modelConfigResolverService: ModelConfigResolverService.create(),
      tensorflowSequenceDatasetService: TensorflowSequenceDatasetService.create(),
      tensorflowRuntimeService: TensorflowRuntimeService.create()
    });
    return modelTrainerService;
  }

  public static create(options: ModelTrainerServiceOptions): ModelTrainerService {
    const modelTrainerService = new ModelTrainerService(options);
    return modelTrainerService;
  }

  /**
   * @section private:methods
   */

  private buildConfigHash(options: TrainModelOptions): string {
    const modelConfig = this.modelConfigResolverService.resolveByWindow(options.window);
    const configFingerprint = JSON.stringify({
      modelId: options.modelId,
      modelVersion: options.modelVersion,
      asset: options.asset,
      window: options.window,
      featureSpecVersion,
      targetSpecVersion,
      modelConfig
    });
    const configHash = createHash("sha256").update(configFingerprint).digest("hex");
    return configHash;
  }

  private resolveTrainingWindows(options: TrainModelOptions) {
    const hasExplicitWindows = Array.isArray(options.windows) && options.windows.length > 0;
    const hasLegacyWindow = Array.isArray(options.snapshots) && options.snapshots.length > 0 && options.market !== undefined;
    let trainingWindows = options.windows ?? [];
    if (!hasExplicitWindows && hasLegacyWindow && options.market) {
      trainingWindows = [
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
    if (trainingWindows.length === 0) {
      throw new Error(`Trainer requires at least one training window for model ${options.modelId}`);
    }
    return trainingWindows;
  }

  private buildArtifactState(
    options: TrainModelOptions,
    featureCount: number,
    minimumValidFeatureRowCount: number,
    totalSequenceCount: number,
    trainSequenceCount: number,
    validationSequenceCount: number,
    testSequenceCount: number,
    epochCount: number,
    finalLoss: number | null,
    finalValidationLoss: number | null
  ): ModelArtifactState {
    const modelConfig = this.modelConfigResolverService.resolveByWindow(options.window);
    const modelArtifactState: ModelArtifactState = {
      updatedAtTs: Date.now(),
      tensorflow: { modelFileName: "model.json", featureCount },
      preprocessing: { inputScaling: modelConfig.data.inputScaling === "standard" ? "standard" : "none", featureMeans: [], featureStds: [] },
      inference: {
        lookbackCandles: modelConfig.sequence.lookbackCandles,
        minimumValidFeatureRowCount,
        decisionThreshold: modelConfig.inference.decisionThreshold
      },
      training: { totalSequenceCount, trainSequenceCount, validationSequenceCount, testSequenceCount, epochCount, finalLoss, finalValidationLoss }
    };
    return modelArtifactState;
  }

  private buildMetadata(options: TrainModelOptions, artifactPath: string, minimumSnapshotCount: number): PersistedModelMetadata {
    const trainingWindows = this.resolveTrainingWindows(options);
    const firstWindow = trainingWindows[0] ?? null;
    const lastWindow = trainingWindows[trainingWindows.length - 1] ?? null;
    const trainedWindowCount = (options.previousMetadata?.trainedWindowCount ?? 0) + trainingWindows.length;
    const persistedModelMetadata: PersistedModelMetadata = {
      modelId: options.modelId,
      modelVersion: options.modelVersion,
      asset: options.asset,
      window: options.window,
      trainedWindowCount,
      lastTrainedWindowStartTs: firstWindow?.marketStartTs ?? null,
      lastTrainedWindowEndTs: lastWindow?.marketEndTs ?? null,
      lastTrainingTs: Date.now(),
      latestBacktest: options.previousMetadata?.latestBacktest ?? DEFAULT_BACKTEST_STATS,
      score: options.previousMetadata?.score ?? 0,
      status: "ready",
      artifactPath,
      minimumSnapshotCount,
      featureSpecVersion,
      targetSpecVersion,
      configHash: this.buildConfigHash(options)
    };
    return persistedModelMetadata;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async train(options: TrainModelOptions): Promise<TrainModelResult> {
    const trainingWindows = this.resolveTrainingWindows(options);
    const modelConfig = this.modelConfigResolverService.resolveByWindow(options.window);
    const preparedTrainingDataset = this.tensorflowSequenceDatasetService.buildTrainingDatasetForWindows({ windows: trainingWindows, modelConfig });
    const artifactPath = this.artifactRepository.buildArtifactPath(options.asset, options.window, options.modelId, options.modelVersion);
    const model = await this.tensorflowRuntimeService.createModel({ modelConfig, featureCount: preparedTrainingDataset.featureCount });
    const trainSummary = await this.tensorflowRuntimeService.trainModel({
      model,
      trainInputs: preparedTrainingDataset.train.inputs,
      trainLabels: preparedTrainingDataset.train.labels,
      validationInputs: preparedTrainingDataset.validation.inputs,
      validationLabels: preparedTrainingDataset.validation.labels,
      modelConfig
    });
    const artifactState = this.buildArtifactState(
      options,
      preparedTrainingDataset.featureCount,
      preparedTrainingDataset.minimumValidFeatureRowCount,
      preparedTrainingDataset.totalSequenceCount,
      preparedTrainingDataset.train.inputs.length,
      preparedTrainingDataset.validation.inputs.length,
      preparedTrainingDataset.test.inputs.length,
      trainSummary.epochCount,
      trainSummary.finalLoss,
      trainSummary.finalValidationLoss
    );
    artifactState.preprocessing.featureMeans = [...preparedTrainingDataset.scalingState.featureMeans];
    artifactState.preprocessing.featureStds = [...preparedTrainingDataset.scalingState.featureStds];
    this.artifactRepository.ensureArtifactPath(artifactPath);
    await this.tensorflowRuntimeService.saveModel(model, artifactPath);
    this.artifactRepository.saveArtifact({ artifactPath, state: artifactState });
    model.dispose();
    const minimumSnapshotCount = preparedTrainingDataset.minimumValidFeatureRowCount;
    const persistedModelMetadata = this.buildMetadata(options, artifactPath, minimumSnapshotCount);
    const metadataPath = this.metadataRepository.buildMetadataPath(artifactPath);
    this.metadataRepository.writeMetadata(metadataPath, persistedModelMetadata);
    const trainModelResult: TrainModelResult = { metadata: persistedModelMetadata, artifactState };
    return trainModelResult;
  }

  /**
   * @section static:methods
   */

  // empty
}
