/**
 * @section imports:externals
 */

import type { MarketRecord, MarketSnapshot } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import { buildFeatures, buildTarget } from "../dataset/feature-target-builder.ts";
import type { ModelConfig } from "../model/model-config.schema.ts";
import type { ModelArtifactState, ModelWindowDataset } from "../model-catalog/model-catalog.types.ts";

/**
 * @section consts
 */

const MINIMUM_SEQUENCE_COUNT = 1;
const MINIMUM_STANDARD_DEVIATION = 0.000001;

/**
 * @section types
 */

type TrainingSlice = { inputs: number[][][]; labels: number[] };
type ScalingState = { inputScaling: "none" | "standard"; featureMeans: number[]; featureStds: number[] };
type SequenceMetadata = {
  snapshotTs: number;
  marketSlug: string;
  marketStartTs: number;
  marketEndTs: number;
  pmUpPrice: number | null;
  pmDownPrice: number | null;
};
type ValidSnapshotFeatureRows = { featureRows: number[][]; validSnapshots: MarketSnapshot[] };
type BuildTargetDatasetOptions = { snapshots: readonly MarketSnapshot[]; market: Pick<MarketRecord, "priceToBeat" | "finalPrice">; modelConfig: ModelConfig };
type BuildTrainingDatasetOptions = BuildTargetDatasetOptions;
type BuildEvaluationDatasetOptions = BuildTargetDatasetOptions & { artifactState: ModelArtifactState };
type BuildPredictionSequenceOptions = { snapshots: readonly MarketSnapshot[]; modelConfig: ModelConfig; artifactState: ModelArtifactState };
type BuildTrainingDatasetForWindowsOptions = { windows: readonly ModelWindowDataset[]; modelConfig: ModelConfig };
type BuildEvaluationDatasetForWindowsOptions = { windows: readonly ModelWindowDataset[]; modelConfig: ModelConfig; artifactState: ModelArtifactState };
export type PreparedTrainingDataset = {
  featureCount: number;
  lookbackCandles: number;
  minimumValidFeatureRowCount: number;
  scalingState: ScalingState;
  train: TrainingSlice;
  validation: TrainingSlice;
  test: TrainingSlice;
  totalSequenceCount: number;
};
export type PreparedEvaluationDataset = {
  inputs: number[][][];
  labels: number[];
  featureCount: number;
  totalSequenceCount: number;
  sequenceMetadata: SequenceMetadata[];
};
export type PreparedPredictionSequence = { input: number[][][]; featureCount: number };

type SequenceBuildResult = {
  sequences: number[][][];
  labels: number[];
  featureCount: number;
  validFeatureRowCount: number;
  sequenceMetadata: SequenceMetadata[];
};

export class TensorflowSequenceDatasetService {
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

  // empty

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  // empty

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): TensorflowSequenceDatasetService {
    const tensorflowSequenceDatasetService = new TensorflowSequenceDatasetService();
    return tensorflowSequenceDatasetService;
  }

  /**
   * @section private:methods
   */

  private buildValidSnapshotFeatureRows(snapshots: readonly MarketSnapshot[]): ValidSnapshotFeatureRows {
    const builtFeatureRows = buildFeatures(snapshots);
    const featureRows: number[][] = [];
    const validSnapshots: MarketSnapshot[] = [];
    for (let index = 0; index < builtFeatureRows.length; index += 1) {
      const featureRow = builtFeatureRows[index] ?? null;
      const snapshot = snapshots[index] ?? null;
      if (featureRow !== null && snapshot !== null) {
        featureRows.push([...featureRow]);
        validSnapshots.push(snapshot);
      }
    }
    const validSnapshotFeatureRows: ValidSnapshotFeatureRows = { featureRows, validSnapshots };
    return validSnapshotFeatureRows;
  }

  private buildBinaryLabels(targetValues: readonly number[]): number[] {
    const binaryLabels = targetValues.map((targetValue) => {
      const binaryLabel = targetValue >= 0 ? 1 : 0;
      return binaryLabel;
    });
    return binaryLabels;
  }

  private buildSequenceMetadata(snapshot: MarketSnapshot): SequenceMetadata {
    const sequenceMetadata: SequenceMetadata = {
      snapshotTs: snapshot.snapshotTs,
      marketSlug: `${snapshot.asset}-${snapshot.window}-${snapshot.marketStartTs}-${snapshot.marketEndTs}`,
      marketStartTs: snapshot.marketStartTs,
      marketEndTs: snapshot.marketEndTs,
      pmUpPrice: snapshot.polymarket.up.price?.price ?? null,
      pmDownPrice: snapshot.polymarket.down.price?.price ?? null
    };
    return sequenceMetadata;
  }

  private buildSequences(
    featureRows: readonly number[][],
    labels: readonly number[],
    validSnapshots: readonly MarketSnapshot[],
    modelConfig: ModelConfig
  ): SequenceBuildResult {
    const lookbackCandles = modelConfig.sequence.lookbackCandles;
    const strideCandles = modelConfig.sequence.strideCandles;
    const sequences: number[][][] = [];
    const sequenceLabels: number[] = [];
    const sequenceMetadata: SequenceMetadata[] = [];
    for (let endIndex = lookbackCandles - 1; endIndex < featureRows.length; endIndex += strideCandles) {
      const sequenceStartIndex = endIndex - lookbackCandles + 1;
      const nextSequence = featureRows.slice(sequenceStartIndex, endIndex + 1).map((featureRow) => {
        return [...featureRow];
      });
      const label = labels[endIndex] ?? null;
      const snapshot = validSnapshots[endIndex] ?? null;
      if (label === null || snapshot === null) {
        throw new Error("Tensorflow dataset builder failed because sequence labels did not align with feature rows");
      }
      sequences.push(nextSequence);
      sequenceLabels.push(label);
      sequenceMetadata.push(this.buildSequenceMetadata(snapshot));
    }
    if (sequences.length < MINIMUM_SEQUENCE_COUNT) {
      throw new Error(`Tensorflow dataset builder requires at least ${lookbackCandles} valid feature rows to build one sequence`);
    }
    const featureCount = featureRows[0]?.length ?? 0;
    const sequenceBuildResult: SequenceBuildResult = {
      sequences,
      labels: sequenceLabels,
      featureCount,
      validFeatureRowCount: featureRows.length,
      sequenceMetadata
    };
    return sequenceBuildResult;
  }

  private buildWindowSequenceBuildResult(windowDataset: ModelWindowDataset, modelConfig: ModelConfig): SequenceBuildResult {
    const validSnapshotFeatureRows = this.buildValidSnapshotFeatureRows(windowDataset.snapshots);
    const targetValues = buildTarget({ market: windowDataset.market, sampleCount: validSnapshotFeatureRows.featureRows.length });
    const binaryLabels = this.buildBinaryLabels(targetValues);
    const windowSequenceBuildResult = this.buildSequences(
      validSnapshotFeatureRows.featureRows,
      binaryLabels,
      validSnapshotFeatureRows.validSnapshots,
      modelConfig
    );
    return windowSequenceBuildResult;
  }

  private buildCombinedSequenceBuildResult(windows: readonly ModelWindowDataset[], modelConfig: ModelConfig): SequenceBuildResult {
    const sequences: number[][][] = [];
    const labels: number[] = [];
    const sequenceMetadata: SequenceMetadata[] = [];
    let featureCount = 0;
    let validFeatureRowCount = 0;
    for (const windowDataset of windows) {
      const windowSequenceBuildResult = this.buildWindowSequenceBuildResult(windowDataset, modelConfig);
      const nextFeatureCount = windowSequenceBuildResult.featureCount;
      const isFeatureCountMismatch = featureCount !== 0 && nextFeatureCount !== featureCount;
      if (isFeatureCountMismatch) {
        throw new Error("Tensorflow dataset builder failed because window feature counts did not match");
      }
      featureCount = nextFeatureCount;
      validFeatureRowCount += windowSequenceBuildResult.validFeatureRowCount;
      sequences.push(...windowSequenceBuildResult.sequences.map((sequence) => sequence.map((featureRow) => [...featureRow])));
      labels.push(...windowSequenceBuildResult.labels);
      sequenceMetadata.push(...windowSequenceBuildResult.sequenceMetadata.map((metadata) => ({ ...metadata })));
    }
    if (sequences.length < MINIMUM_SEQUENCE_COUNT) {
      throw new Error("Tensorflow dataset builder requires at least one valid sequence across the provided windows");
    }
    const combinedSequenceBuildResult: SequenceBuildResult = { sequences, labels, featureCount, validFeatureRowCount, sequenceMetadata };
    return combinedSequenceBuildResult;
  }

  private resolveTrainCount(totalSequenceCount: number, modelConfig: ModelConfig): number {
    const requestedTrainCount = Math.floor(totalSequenceCount * modelConfig.data.split.trainRatio);
    const trainCount = Math.max(1, Math.min(totalSequenceCount, requestedTrainCount));
    return trainCount;
  }

  private resolveValidationCount(totalSequenceCount: number, trainCount: number, modelConfig: ModelConfig): number {
    const remainingCount = Math.max(0, totalSequenceCount - trainCount);
    const requestedValidationCount = Math.floor(totalSequenceCount * modelConfig.data.split.validationRatio);
    const validationCount = Math.max(0, Math.min(remainingCount, requestedValidationCount));
    return validationCount;
  }

  private buildSplit(sequences: readonly number[][][], labels: readonly number[], startIndex: number, endIndex: number): TrainingSlice {
    const inputs = sequences.slice(startIndex, endIndex).map((sequence) => {
      return sequence.map((featureRow) => {
        return [...featureRow];
      });
    });
    const nextLabels = labels.slice(startIndex, endIndex);
    const trainingSlice: TrainingSlice = { inputs, labels: nextLabels };
    return trainingSlice;
  }

  private calculateFeatureMeans(trainInputs: readonly number[][][], featureCount: number): number[] {
    const featureMeans = Array.from({ length: featureCount }, () => 0);
    let observationCount = 0;
    for (const sequence of trainInputs) {
      for (const featureRow of sequence) {
        for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
          const value = featureRow[featureIndex] ?? 0;
          featureMeans[featureIndex] = (featureMeans[featureIndex] ?? 0) + value;
        }
        observationCount += 1;
      }
    }
    const normalizedFeatureMeans = featureMeans.map((featureMean) => {
      const normalizedFeatureMean = observationCount === 0 ? 0 : featureMean / observationCount;
      return normalizedFeatureMean;
    });
    return normalizedFeatureMeans;
  }

  private calculateFeatureStds(trainInputs: readonly number[][][], featureMeans: readonly number[]): number[] {
    const featureStds = Array.from({ length: featureMeans.length }, () => 0);
    let observationCount = 0;
    for (const sequence of trainInputs) {
      for (const featureRow of sequence) {
        for (let featureIndex = 0; featureIndex < featureMeans.length; featureIndex += 1) {
          const value = featureRow[featureIndex] ?? 0;
          const mean = featureMeans[featureIndex] ?? 0;
          featureStds[featureIndex] = (featureStds[featureIndex] ?? 0) + (value - mean) ** 2;
        }
        observationCount += 1;
      }
    }
    const normalizedFeatureStds = featureStds.map((featureVarianceSum) => {
      const variance = observationCount === 0 ? 0 : featureVarianceSum / observationCount;
      const std = Math.sqrt(variance);
      const normalizedStd = Math.max(MINIMUM_STANDARD_DEVIATION, std);
      return normalizedStd;
    });
    return normalizedFeatureStds;
  }

  private buildScalingState(trainInputs: readonly number[][][], featureCount: number, modelConfig: ModelConfig): ScalingState {
    let scalingState: ScalingState = {
      inputScaling: "none",
      featureMeans: Array.from({ length: featureCount }, () => 0),
      featureStds: Array.from({ length: featureCount }, () => 1)
    };
    if (modelConfig.data.inputScaling === "standard") {
      const featureMeans = this.calculateFeatureMeans(trainInputs, featureCount);
      const featureStds = this.calculateFeatureStds(trainInputs, featureMeans);
      scalingState = { inputScaling: "standard", featureMeans, featureStds };
    }
    return scalingState;
  }

  private applyScalingToInputs(inputs: readonly number[][][], scalingState: ScalingState): number[][][] {
    const scaledInputs = inputs.map((sequence) => {
      const scaledSequence = sequence.map((featureRow) => {
        const scaledFeatureRow = featureRow.map((featureValue, featureIndex) => {
          const mean = scalingState.featureMeans[featureIndex] ?? 0;
          const std = scalingState.featureStds[featureIndex] ?? 1;
          const nextFeatureValue = scalingState.inputScaling === "standard" ? (featureValue - mean) / std : featureValue;
          return nextFeatureValue;
        });
        return scaledFeatureRow;
      });
      return scaledSequence;
    });
    return scaledInputs;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public buildTrainingDataset(options: BuildTrainingDatasetOptions): PreparedTrainingDataset {
    const windows: readonly ModelWindowDataset[] = [
      {
        marketSlug: options.snapshots[0]
          ? `${options.snapshots[0].asset}-${options.snapshots[0].window}-${options.snapshots[0].marketStartTs}-${options.snapshots[0].marketEndTs}`
          : "unknown-market",
        marketStartTs: options.snapshots[0]?.marketStartTs ?? 0,
        marketEndTs: options.snapshots[0]?.marketEndTs ?? 0,
        snapshots: options.snapshots,
        market: options.market
      }
    ];
    const preparedTrainingDataset = this.buildTrainingDatasetForWindows({ windows, modelConfig: options.modelConfig });
    return preparedTrainingDataset;
  }

  public buildTrainingDatasetForWindows(options: BuildTrainingDatasetForWindowsOptions): PreparedTrainingDataset {
    const sequenceBuildResult = this.buildCombinedSequenceBuildResult(options.windows, options.modelConfig);
    const totalSequenceCount = sequenceBuildResult.sequences.length;
    const trainCount = this.resolveTrainCount(totalSequenceCount, options.modelConfig);
    const validationCount = this.resolveValidationCount(totalSequenceCount, trainCount, options.modelConfig);
    const trainSlice = this.buildSplit(sequenceBuildResult.sequences, sequenceBuildResult.labels, 0, trainCount);
    const validationSlice = this.buildSplit(sequenceBuildResult.sequences, sequenceBuildResult.labels, trainCount, trainCount + validationCount);
    const testSlice = this.buildSplit(sequenceBuildResult.sequences, sequenceBuildResult.labels, trainCount + validationCount, totalSequenceCount);
    const scalingState = this.buildScalingState(trainSlice.inputs, sequenceBuildResult.featureCount, options.modelConfig);
    const preparedTrainingDataset: PreparedTrainingDataset = {
      featureCount: sequenceBuildResult.featureCount,
      lookbackCandles: options.modelConfig.sequence.lookbackCandles,
      minimumValidFeatureRowCount: options.modelConfig.sequence.lookbackCandles,
      scalingState,
      train: { inputs: this.applyScalingToInputs(trainSlice.inputs, scalingState), labels: [...trainSlice.labels] },
      validation: { inputs: this.applyScalingToInputs(validationSlice.inputs, scalingState), labels: [...validationSlice.labels] },
      test: { inputs: this.applyScalingToInputs(testSlice.inputs, scalingState), labels: [...testSlice.labels] },
      totalSequenceCount
    };
    return preparedTrainingDataset;
  }

  public buildEvaluationDataset(options: BuildEvaluationDatasetOptions): PreparedEvaluationDataset {
    const windows: readonly ModelWindowDataset[] = [
      {
        marketSlug: options.snapshots[0]
          ? `${options.snapshots[0].asset}-${options.snapshots[0].window}-${options.snapshots[0].marketStartTs}-${options.snapshots[0].marketEndTs}`
          : "unknown-market",
        marketStartTs: options.snapshots[0]?.marketStartTs ?? 0,
        marketEndTs: options.snapshots[0]?.marketEndTs ?? 0,
        snapshots: options.snapshots,
        market: options.market
      }
    ];
    const preparedEvaluationDataset = this.buildEvaluationDatasetForWindows({
      windows,
      modelConfig: options.modelConfig,
      artifactState: options.artifactState
    });
    return preparedEvaluationDataset;
  }

  public buildEvaluationDatasetForWindows(options: BuildEvaluationDatasetForWindowsOptions): PreparedEvaluationDataset {
    const sequenceBuildResult = this.buildCombinedSequenceBuildResult(options.windows, options.modelConfig);
    const totalSequenceCount = sequenceBuildResult.sequences.length;
    const inputs = this.applyScalingToInputs(sequenceBuildResult.sequences, options.artifactState.preprocessing);
    const preparedEvaluationDataset: PreparedEvaluationDataset = {
      inputs,
      labels: [...sequenceBuildResult.labels],
      featureCount: sequenceBuildResult.featureCount,
      totalSequenceCount,
      sequenceMetadata: sequenceBuildResult.sequenceMetadata.map((metadata) => ({ ...metadata }))
    };
    return preparedEvaluationDataset;
  }

  public buildPredictionSequence(options: BuildPredictionSequenceOptions): PreparedPredictionSequence | null {
    const validSnapshotFeatureRows = this.buildValidSnapshotFeatureRows(options.snapshots);
    const hasEnoughFeatureRows = validSnapshotFeatureRows.featureRows.length >= options.artifactState.inference.minimumValidFeatureRowCount;
    let preparedPredictionSequence: PreparedPredictionSequence | null = null;
    if (hasEnoughFeatureRows) {
      const sequenceStartIndex = validSnapshotFeatureRows.featureRows.length - options.artifactState.inference.lookbackCandles;
      const sequence = validSnapshotFeatureRows.featureRows.slice(sequenceStartIndex).map((featureRow) => {
        return [...featureRow];
      });
      const input = this.applyScalingToInputs([sequence], options.artifactState.preprocessing);
      preparedPredictionSequence = { input, featureCount: sequence[0]?.length ?? 0 };
    }
    return preparedPredictionSequence;
  }

  /**
   * @section static:methods
   */

  // empty
}

export type { BuildEvaluationDatasetOptions, BuildPredictionSequenceOptions, BuildTrainingDatasetOptions, ScalingState, SequenceMetadata };
