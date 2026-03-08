/**
 * @section imports:externals
 */

import type * as TensorflowNamespace from "@tensorflow/tfjs-node";
import type { History, LayersModel, Sequential, Tensor2D, Tensor3D } from "@tensorflow/tfjs-node";

/**
 * @section imports:internals
 */

import type { ModelConfig } from "../model/model-config.schema.ts";

/**
 * @section consts
 */

const MODEL_FILE_NAME = "model.json";
const OUTPUT_UNIT_COUNT = 1;

/**
 * @section types
 */

type TensorflowModule = typeof TensorflowNamespace;
type TensorflowSequentialModel = Sequential;
type TensorflowLayersModel = LayersModel;
type TensorflowHistory = History;
type CreateModelOptions = { modelConfig: ModelConfig; featureCount: number };
type TrainModelOptions = {
  model: TensorflowSequentialModel;
  trainInputs: number[][][];
  trainLabels: number[];
  validationInputs: number[][][];
  validationLabels: number[];
  modelConfig: ModelConfig;
};
type TensorflowTrainingSummary = { epochCount: number; finalLoss: number | null; finalValidationLoss: number | null };

export class TensorflowRuntimeService {
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

  private tensorflowModulePromise: Promise<TensorflowModule> | null;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor() {
    this.tensorflowModulePromise = null;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): TensorflowRuntimeService {
    const tensorflowRuntimeService = new TensorflowRuntimeService();
    return tensorflowRuntimeService;
  }

  /**
   * @section private:methods
   */

  private async loadTensorflowModule(): Promise<TensorflowModule> {
    if (this.tensorflowModulePromise === null) {
      this.tensorflowModulePromise = import("@tensorflow/tfjs-node");
    }
    const tensorflowModule = await this.tensorflowModulePromise;
    return tensorflowModule;
  }

  private addInputRecurrentLayer(model: TensorflowSequentialModel, tf: TensorflowModule, modelConfig: ModelConfig, featureCount: number, units: number): void {
    const layerOptions = {
      units,
      returnSequences: modelConfig.architecture.recurrentLayerUnits.length > 1,
      activation: modelConfig.architecture.activation,
      recurrentActivation: modelConfig.architecture.recurrentActivation,
      useBias: modelConfig.architecture.useBias,
      kernelInitializer: modelConfig.architecture.kernelInitializer,
      recurrentInitializer: modelConfig.architecture.recurrentInitializer,
      dropout: modelConfig.architecture.dropoutRate,
      recurrentDropout: modelConfig.architecture.recurrentDropoutRate,
      inputShape: [modelConfig.sequence.lookbackCandles, featureCount] as [number, number]
    };
    if (modelConfig.architecture.modelType === "gru") {
      model.add(tf.layers.gru(layerOptions));
    } else {
      model.add(tf.layers.lstm(layerOptions));
    }
  }

  private addHiddenRecurrentLayers(model: TensorflowSequentialModel, tf: TensorflowModule, modelConfig: ModelConfig): void {
    for (let layerIndex = 1; layerIndex < modelConfig.architecture.recurrentLayerUnits.length; layerIndex += 1) {
      const units = modelConfig.architecture.recurrentLayerUnits[layerIndex] ?? 0;
      const isLastLayer = layerIndex === modelConfig.architecture.recurrentLayerUnits.length - 1;
      const layerOptions = {
        units,
        returnSequences: !isLastLayer,
        activation: modelConfig.architecture.activation,
        recurrentActivation: modelConfig.architecture.recurrentActivation,
        useBias: modelConfig.architecture.useBias,
        kernelInitializer: modelConfig.architecture.kernelInitializer,
        recurrentInitializer: modelConfig.architecture.recurrentInitializer,
        dropout: modelConfig.architecture.dropoutRate,
        recurrentDropout: modelConfig.architecture.recurrentDropoutRate
      };
      if (modelConfig.architecture.modelType === "gru") {
        model.add(tf.layers.gru(layerOptions));
      } else {
        model.add(tf.layers.lstm(layerOptions));
      }
      if (modelConfig.architecture.useBatchNormalization) {
        model.add(tf.layers.batchNormalization());
      }
    }
  }

  private addDenseHead(model: TensorflowSequentialModel, tf: TensorflowModule, modelConfig: ModelConfig): void {
    for (const units of modelConfig.architecture.denseHeadUnits) {
      model.add(
        tf.layers.dense({ units, activation: "relu", useBias: modelConfig.architecture.useBias, kernelInitializer: modelConfig.architecture.kernelInitializer })
      );
      if (modelConfig.architecture.dropoutRate > 0) {
        model.add(tf.layers.dropout({ rate: modelConfig.architecture.dropoutRate }));
      }
    }
    model.add(tf.layers.dense({ units: OUTPUT_UNIT_COUNT, activation: modelConfig.architecture.outputActivation }));
  }

  private createOptimizer(tf: TensorflowModule, modelConfig: ModelConfig) {
    const learningRate = modelConfig.training.learningRate;
    let optimizer;
    if (modelConfig.training.optimizer === "sgd") {
      optimizer = tf.train.sgd(learningRate);
    } else if (modelConfig.training.optimizer === "rmsprop") {
      optimizer = tf.train.rmsprop(learningRate);
    } else {
      optimizer = tf.train.adam(learningRate);
    }
    return optimizer;
  }

  private createMetrics(modelConfig: ModelConfig): string[] {
    const metrics = modelConfig.training.metrics
      .filter((metricName) => {
        return metricName === "accuracy";
      })
      .map(() => {
        return "binaryAccuracy";
      });
    const normalizedMetrics = metrics.length === 0 ? ["binaryAccuracy"] : metrics;
    return normalizedMetrics;
  }

  private readLastHistoryMetric(history: TensorflowHistory, metricName: string): number | null {
    const values = history.history[metricName] ?? [];
    const lastValue = values.length > 0 ? values[values.length - 1] : null;
    const normalizedLastValue = typeof lastValue === "number" ? lastValue : null;
    return normalizedLastValue;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async createModel(options: CreateModelOptions): Promise<TensorflowSequentialModel> {
    const tf = await this.loadTensorflowModule();
    const model = tf.sequential();
    const inputUnits = options.modelConfig.architecture.recurrentLayerUnits[0] ?? 0;
    if (options.modelConfig.architecture.modelType === "dense") {
      model.add(tf.layers.flatten({ inputShape: [options.modelConfig.sequence.lookbackCandles, options.featureCount] }));
      model.add(tf.layers.dense({ units: inputUnits, activation: options.modelConfig.architecture.activation }));
    } else {
      this.addInputRecurrentLayer(model, tf, options.modelConfig, options.featureCount, inputUnits);
      this.addHiddenRecurrentLayers(model, tf, options.modelConfig);
    }
    if (options.modelConfig.architecture.useBatchNormalization) {
      model.add(tf.layers.batchNormalization());
    }
    this.addDenseHead(model, tf, options.modelConfig);
    model.compile({
      optimizer: this.createOptimizer(tf, options.modelConfig),
      loss: options.modelConfig.training.loss,
      metrics: this.createMetrics(options.modelConfig)
    });
    return model;
  }

  public async trainModel(options: TrainModelOptions): Promise<TensorflowTrainingSummary> {
    const tf = await this.loadTensorflowModule();
    const trainInputsTensor = tf.tensor3d(options.trainInputs);
    const trainLabelsTensor = tf.tensor2d(options.trainLabels, [options.trainLabels.length, 1]);
    const validationInputsTensor = options.validationInputs.length > 0 ? tf.tensor3d(options.validationInputs) : null;
    const validationLabelsTensor = options.validationLabels.length > 0 ? tf.tensor2d(options.validationLabels, [options.validationLabels.length, 1]) : null;
    const hasValidationData = validationInputsTensor !== null && validationLabelsTensor !== null;
    const fitOptions = {
      batchSize: options.modelConfig.training.batchSize,
      epochs: options.modelConfig.training.maxEpochs,
      shuffle: options.modelConfig.data.shuffleTrainingWindows,
      verbose: 0,
      ...(hasValidationData ? { validationData: [validationInputsTensor, validationLabelsTensor] as [Tensor3D, Tensor2D] } : {})
    };
    const history = await options.model.fit(trainInputsTensor, trainLabelsTensor, fitOptions);
    trainInputsTensor.dispose();
    trainLabelsTensor.dispose();
    if (validationInputsTensor !== null) {
      validationInputsTensor.dispose();
    }
    if (validationLabelsTensor !== null) {
      validationLabelsTensor.dispose();
    }
    const tensorflowTrainingSummary: TensorflowTrainingSummary = {
      epochCount: history.epoch.length,
      finalLoss: this.readLastHistoryMetric(history, "loss"),
      finalValidationLoss: this.readLastHistoryMetric(history, "val_loss")
    };
    return tensorflowTrainingSummary;
  }

  public async saveModel(model: TensorflowLayersModel, artifactPath: string): Promise<void> {
    const fileUrl = `file://${artifactPath}`;
    await model.save(fileUrl);
  }

  public async loadModel(artifactPath: string): Promise<TensorflowLayersModel> {
    const tf = await this.loadTensorflowModule();
    const model = await tf.loadLayersModel(`file://${artifactPath}/${MODEL_FILE_NAME}`);
    return model;
  }

  public async predictProbabilities(model: TensorflowLayersModel, inputs: number[][][]): Promise<number[]> {
    const tf = await this.loadTensorflowModule();
    const inputsTensor = tf.tensor3d(inputs);
    const predictionTensor = model.predict(inputsTensor);
    const outputTensor = Array.isArray(predictionTensor) ? (predictionTensor[0] ?? null) : predictionTensor;
    if (outputTensor === null) {
      throw new Error("Tensorflow runtime failed because model.predict returned no tensor output");
    }
    const probabilities = Array.from(await outputTensor.data());
    inputsTensor.dispose();
    outputTensor.dispose();
    const normalizedProbabilities = probabilities.map((probability) => {
      return Number(probability);
    });
    return normalizedProbabilities;
  }

  /**
   * @section static:methods
   */

  // empty
}

export type { TensorflowLayersModel, TensorflowTrainingSummary };
