import * as assert from "node:assert/strict";
import { test } from "node:test";

import { modelConfigSchema } from "../src/model/model-config.schema.ts";

test("modelConfigSchema parses a valid TensorFlow model configuration", () => {
  const parsed = modelConfigSchema.parse({
    modelId: "btc-5m-direction-v1",
    market: { marketSource: "polymarket", assetSymbol: "BTC", timeframe: "5m", predictionHorizonCandles: 1 },
    sequence: { lookbackCandles: 96, strideCandles: 1, featureColumns: ["open", "high", "low", "close", "volume", "fundingRate"], labelColumn: "targetUp" },
    architecture: { modelType: "gru", recurrentLayerUnits: [128, 64], denseHeadUnits: [32], layerCount: 2 }
  });

  assert.equal(parsed.architecture.modelType, "gru");
  assert.equal(parsed.market.timeframe, "5m");
  assert.equal(parsed.training.optimizer, "adam");
  assert.equal(parsed.data.split.trainRatio + parsed.data.split.validationRatio + parsed.data.split.testRatio, 1);
});

test("modelConfigSchema rejects layerCount mismatch", () => {
  const result = modelConfigSchema.safeParse({
    modelId: "btc-15m-direction-v1",
    market: { marketSource: "polymarket", assetSymbol: "BTC", timeframe: "15m" },
    sequence: { lookbackCandles: 72, featureColumns: ["open", "high", "low", "close"], labelColumn: "targetUp" },
    architecture: { modelType: "lstm", recurrentLayerUnits: [128, 64], layerCount: 3 }
  });

  assert.equal(result.success, false);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message);
    assert.ok(issues.includes("layerCount must match recurrentLayerUnits length"));
  }
});

test("modelConfigSchema rejects invalid data split totals", () => {
  const result = modelConfigSchema.safeParse({
    modelId: "btc-5m-direction-v2",
    market: { marketSource: "polymarket", assetSymbol: "BTC", timeframe: "5m" },
    sequence: { lookbackCandles: 48, featureColumns: ["open", "high", "low", "close"], labelColumn: "targetUp" },
    architecture: { modelType: "dense", recurrentLayerUnits: [64], layerCount: 1 },
    data: { split: { trainRatio: 0.8, validationRatio: 0.15, testRatio: 0.15 } }
  });

  assert.equal(result.success, false);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => issue.message);
    assert.ok(issues.includes("trainRatio + validationRatio + testRatio must equal 1"));
  }
});
