/**
 * @section imports:externals
 */

import { z } from "zod";

/**
 * @section imports:internals
 */

// empty

/**
 * @section consts
 */

const LAYER_TYPE_SCHEMA = z.enum(["dense", "lstm", "gru"]);
const TIMEFRAME_SCHEMA = z.enum(["5m", "15m"]);
const ACTIVATION_SCHEMA = z.enum(["relu", "tanh", "sigmoid", "softmax", "linear", "elu", "selu", "swish", "gelu"]);
const INITIALIZER_SCHEMA = z.enum(["glorotUniform", "heNormal", "heUniform", "lecunNormal", "zeros", "ones", "orthogonal"]);
const OPTIMIZER_SCHEMA = z.enum(["adam", "adamW", "rmsprop", "sgd", "adagrad", "adamax", "nadam"]);
const LOSS_SCHEMA = z.enum([
  "binaryCrossentropy",
  "categoricalCrossentropy",
  "sparseCategoricalCrossentropy",
  "meanSquaredError",
  "meanAbsoluteError",
  "huber",
  "focalCrossentropy"
]);
const METRIC_SCHEMA = z.enum(["accuracy", "precision", "recall", "auc", "f1", "meanAbsoluteError", "meanSquaredError"]);
const SCALING_SCHEMA = z.enum(["none", "standard", "minmax", "robust"]);
const MISSING_VALUE_STRATEGY_SCHEMA = z.enum(["drop", "forwardFill", "backwardFill", "zero", "mean", "median"]);
const OUTLIER_STRATEGY_SCHEMA = z.enum(["none", "winsorize", "clip", "zscoreFilter"]);
const SCHEDULER_TYPE_SCHEMA = z.enum(["none", "reduceOnPlateau", "cosineDecay", "exponentialDecay", "oneCycle"]);
const CHECKPOINT_MODE_SCHEMA = z.enum(["best", "all"]);
const OBJECTIVE_DIRECTION_SCHEMA = z.enum(["minimize", "maximize"]);
const SAVE_FORMAT_SCHEMA = z.enum(["tfjsLayers", "savedModel", "onnx"]);
const QUANTIZATION_SCHEMA = z.enum(["none", "float16", "int8"]);
const DEVICE_PREFERENCE_SCHEMA = z.enum(["auto", "cpu", "gpu"]);

const REGULARIZATION_SCHEMA = z.object({ l1: z.number().min(0).default(0), l2: z.number().min(0).default(0), maxNorm: z.number().positive().optional() });
const EARLY_STOPPING_SCHEMA = z.object({
  isEnabled: z.boolean().default(true),
  monitor: METRIC_SCHEMA.default("auc"),
  mode: OBJECTIVE_DIRECTION_SCHEMA.default("maximize"),
  patienceEpochs: z.number().int().min(1).default(8),
  minDelta: z.number().min(0).default(0),
  restoreBestWeights: z.boolean().default(true)
});
const LEARNING_RATE_SCHEDULER_SCHEMA = z.object({
  type: SCHEDULER_TYPE_SCHEMA.default("reduceOnPlateau"),
  factor: z.number().gt(0).lt(1).default(0.5),
  patienceEpochs: z.number().int().min(1).default(4),
  minLearningRate: z.number().positive().default(0.000001),
  decaySteps: z.number().int().positive().optional(),
  warmupEpochs: z.number().int().min(0).default(0)
});
const CHECKPOINTING_SCHEMA = z.object({
  isEnabled: z.boolean().default(true),
  monitor: METRIC_SCHEMA.default("auc"),
  mode: OBJECTIVE_DIRECTION_SCHEMA.default("maximize"),
  saveMode: CHECKPOINT_MODE_SCHEMA.default("best"),
  directoryPath: z.string().min(1).default("artifacts/checkpoints")
});
const DATA_SPLIT_SCHEMA = z
  .object({
    trainRatio: z.number().gt(0).lt(1).default(0.7),
    validationRatio: z.number().gt(0).lt(1).default(0.15),
    testRatio: z.number().gt(0).lt(1).default(0.15)
  })
  .superRefine((value, context) => {
    const ratioSum = value.trainRatio + value.validationRatio + value.testRatio;
    if (Math.abs(ratioSum - 1) > 0.0001) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "trainRatio + validationRatio + testRatio must equal 1", path: ["trainRatio"] });
    }
  });
const ARCHITECTURE_SCHEMA = z
  .object({
    modelType: LAYER_TYPE_SCHEMA,
    recurrentLayerUnits: z.array(z.number().int().positive()).nonempty(),
    denseHeadUnits: z.array(z.number().int().positive()).default([]),
    layerCount: z.number().int().min(1),
    dropoutRate: z.number().min(0).max(0.9).default(0.2),
    recurrentDropoutRate: z.number().min(0).max(0.9).default(0),
    useBidirectional: z.boolean().default(false),
    useBatchNormalization: z.boolean().default(false),
    useLayerNormalization: z.boolean().default(false),
    activation: ACTIVATION_SCHEMA.default("tanh"),
    recurrentActivation: ACTIVATION_SCHEMA.default("sigmoid"),
    outputActivation: ACTIVATION_SCHEMA.default("sigmoid"),
    kernelInitializer: INITIALIZER_SCHEMA.default("glorotUniform"),
    recurrentInitializer: INITIALIZER_SCHEMA.default("orthogonal"),
    useBias: z.boolean().default(true),
    regularization: REGULARIZATION_SCHEMA.default({ l1: 0, l2: 0 })
  })
  .superRefine((value, context) => {
    if (value.layerCount !== value.recurrentLayerUnits.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "layerCount must match recurrentLayerUnits length", path: ["layerCount"] });
    }
  });

/**
 * @section types
 */

// empty

export const modelConfigSchema = z.object({
  modelId: z.string().min(1),
  modelVersion: z.string().min(1).default("0.1.0"),
  market: z.object({
    marketSource: z.literal("polymarket"),
    assetSymbol: z.string().min(2),
    timeframe: TIMEFRAME_SCHEMA,
    predictionHorizonCandles: z.number().int().positive().default(1)
  }),
  sequence: z.object({
    lookbackCandles: z.number().int().positive(),
    strideCandles: z.number().int().positive().default(1),
    featureColumns: z.array(z.string().min(1)).min(1),
    labelColumn: z.string().min(1)
  }),
  architecture: ARCHITECTURE_SCHEMA,
  training: z
    .object({
      optimizer: OPTIMIZER_SCHEMA.default("adam"),
      learningRate: z.number().positive().default(0.001),
      weightDecay: z.number().min(0).default(0),
      loss: LOSS_SCHEMA.default("binaryCrossentropy"),
      metrics: z.array(METRIC_SCHEMA).nonempty().default(["accuracy", "auc"]),
      batchSize: z.number().int().positive().default(64),
      maxEpochs: z.number().int().positive().default(100),
      gradientClipNorm: z.number().positive().optional(),
      gradientClipValue: z.number().positive().optional(),
      labelSmoothing: z.number().min(0).max(1).default(0),
      mixedPrecision: z.boolean().default(false),
      randomSeed: z.number().int().default(42),
      earlyStopping: EARLY_STOPPING_SCHEMA.default({}),
      learningRateScheduler: LEARNING_RATE_SCHEDULER_SCHEMA.default({}),
      checkpointing: CHECKPOINTING_SCHEMA.default({})
    })
    .default({}),
  data: z
    .object({
      split: DATA_SPLIT_SCHEMA.default({}),
      inputScaling: SCALING_SCHEMA.default("standard"),
      targetScaling: SCALING_SCHEMA.default("none"),
      missingValueStrategy: MISSING_VALUE_STRATEGY_SCHEMA.default("forwardFill"),
      outlierStrategy: OUTLIER_STRATEGY_SCHEMA.default("clip"),
      outlierThreshold: z.number().positive().default(3),
      shuffleTrainingWindows: z.boolean().default(true),
      leakageGuards: z
        .object({
          enforceTemporalOrdering: z.boolean().default(true),
          disallowFutureFeatures: z.boolean().default(true),
          disallowGlobalFitOnValidationOrTest: z.boolean().default(true)
        })
        .default({})
    })
    .default({}),
  search: z
    .object({
      isEnabled: z.boolean().default(false),
      maxTrials: z.number().int().positive().default(30),
      parallelTrials: z.number().int().positive().default(1),
      objectiveMetric: METRIC_SCHEMA.default("auc"),
      objectiveDirection: OBJECTIVE_DIRECTION_SCHEMA.default("maximize")
    })
    .default({}),
  inference: z
    .object({
      decisionThreshold: z.number().min(0).max(1).default(0.5),
      useMonteCarloDropout: z.boolean().default(false),
      monteCarloSamples: z.number().int().positive().default(30),
      calibrationWindowSize: z.number().int().positive().default(500)
    })
    .default({}),
  deployment: z
    .object({
      saveFormat: SAVE_FORMAT_SCHEMA.default("tfjsLayers"),
      quantization: QUANTIZATION_SCHEMA.default("none"),
      devicePreference: DEVICE_PREFERENCE_SCHEMA.default("auto")
    })
    .default({})
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;
