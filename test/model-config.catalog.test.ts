import * as assert from "node:assert/strict";
import { test } from "node:test";

import { modelConfigById, modelConfigCatalog } from "../src/model/configuration/model-config.catalog.ts";

test("modelConfigCatalog registers two initial GRU presets", () => {
  assert.equal(modelConfigCatalog.length, 2);

  const modelTypes = modelConfigCatalog.map((config) => {
    return config.architecture.modelType;
  });
  assert.deepEqual(modelTypes, ["gru", "gru"]);

  const timeframes = modelConfigCatalog.map((config) => {
    return config.market.timeframe;
  });
  assert.deepEqual(timeframes, ["5m", "15m"]);
});

test("modelConfigById exposes the 5m and 15m model presets", () => {
  const fiveMinuteConfig = modelConfigById.get("polymarket-crypto-gru-5m-v1");
  const fifteenMinuteConfig = modelConfigById.get("polymarket-crypto-gru-15m-v1");

  assert.notEqual(fiveMinuteConfig, undefined);
  assert.notEqual(fifteenMinuteConfig, undefined);

  if (fiveMinuteConfig && fifteenMinuteConfig) {
    assert.equal(fiveMinuteConfig.sequence.lookbackCandles, 16);
    assert.equal(fifteenMinuteConfig.sequence.lookbackCandles, 24);
    assert.equal(fiveMinuteConfig.training.batchSize, 128);
    assert.equal(fifteenMinuteConfig.training.batchSize, 128);
  }
});
