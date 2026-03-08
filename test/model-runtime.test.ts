import * as assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AssetSymbol, MarketEvent, MarketRecord, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

import { featureSpecVersion, targetSpecVersion } from "../src/dataset/feature-target-builder.ts";
import { ModelFarmRuntimeService } from "../src/app/model-farm-runtime.service.ts";
import { BacktestOrchestratorService } from "../src/backtest/backtest-orchestrator.service.ts";
import { BacktestEvaluatorService } from "../src/backtest/backtest-evaluator.service.ts";
import { ScoreCalculatorService } from "../src/backtest/score-calculator.service.ts";
import { ClickCollectorGateway } from "../src/data-source/click-collector.gateway.ts";
import { ModelArtifactRepository } from "../src/model-catalog/model-artifact.repository.ts";
import { ModelCatalogRepository } from "../src/model-catalog/model-catalog.repository.ts";
import { ModelListingService } from "../src/model-catalog/model-listing.service.ts";
import { ModelMetadataRepository } from "../src/model-catalog/model-metadata.repository.ts";
import type { BacktestStats, PersistedModelMetadata } from "../src/model-catalog/model-catalog.types.ts";
import { MarketWindowCoverageService } from "../src/shared/market-window-coverage.service.ts";
import { ModelTrainerService } from "../src/training/model-trainer.service.ts";
import { TensorflowSequenceDatasetService } from "../src/training/tensorflow-sequence-dataset.service.ts";
import { ModelConfigResolverService } from "../src/model/model-config-resolver.service.ts";
import { TrainingWindowRegistryRepository } from "../src/training/training-window-registry.repository.ts";
import { TrainingOrchestratorService } from "../src/training/training-orchestrator.service.ts";

function createMarketEvent(options: {
  asset: AssetSymbol;
  window: MarketWindow;
  marketSlug: string;
  tokenSide: "up" | "down" | null;
  eventTs: number;
  price: number | null;
  orderbook?: string | null;
  sourceCategory?: "exchange" | "chainlink" | "polymarket";
  sourceName?: string;
}): MarketEvent {
  const marketEvent: MarketEvent = {
    eventId: `${options.marketSlug}-${options.tokenSide ?? "none"}-${options.eventTs}-${options.sourceName ?? "source"}`,
    eventTs: options.eventTs,
    sourceCategory: options.sourceCategory ?? (options.tokenSide === null ? "exchange" : "polymarket"),
    sourceName: options.sourceName ?? (options.tokenSide === null ? "binance" : "polymarket"),
    eventType: options.orderbook ? "orderbook" : "price",
    asset: options.asset,
    window: options.window,
    marketSlug: options.marketSlug,
    tokenSide: options.tokenSide,
    price: options.price,
    orderbook: options.orderbook ?? null,
    payloadJson: "{}",
    isTest: true
  };
  return marketEvent;
}

function createEmptyState() {
  const emptyState = { price: null, orderbook: null };
  return emptyState;
}

function createOrderbook(midPrice: number, bidSize: number, askSize: number, halfSpread: number): string {
  const orderbook = JSON.stringify({ bids: [[midPrice - halfSpread, bidSize]], asks: [[midPrice + halfSpread, askSize]] });
  return orderbook;
}

function createAssetState(options: { asset: AssetSymbol; window: MarketWindow; marketSlug: string; snapshotTs: number; midPrice: number }) {
  const createSpotState = (sourceName: string, price: number, orderbook?: string) => {
    const sourceCategory = sourceName === "chainlink" ? "chainlink" : "exchange";
    const priceEvent = createMarketEvent({
      asset: options.asset,
      window: options.window,
      marketSlug: options.marketSlug,
      tokenSide: null,
      eventTs: options.snapshotTs,
      price,
      sourceCategory,
      sourceName
    });
    const orderbookEvent =
      typeof orderbook === "string"
        ? createMarketEvent({
            asset: options.asset,
            window: options.window,
            marketSlug: options.marketSlug,
            tokenSide: null,
            eventTs: options.snapshotTs,
            price: null,
            orderbook,
            sourceCategory,
            sourceName
          })
        : null;
    const spotState = { price: priceEvent, orderbook: orderbookEvent };
    return spotState;
  };
  const assetState = {
    binance: createSpotState("binance", options.midPrice, createOrderbook(options.midPrice, 12, 8, 0.5)),
    coinbase: createSpotState("coinbase", options.midPrice + 0.2, createOrderbook(options.midPrice + 0.2, 11, 9, 0.5)),
    kraken: createSpotState("kraken", options.midPrice - 0.1, createOrderbook(options.midPrice - 0.1, 13, 7, 0.5)),
    okx: createSpotState("okx", options.midPrice + 0.1, createOrderbook(options.midPrice + 0.1, 10, 10, 0.5)),
    chainlink: createSpotState("chainlink", options.midPrice + 0.05)
  };
  return assetState;
}

function createSnapshot(asset: AssetSymbol, window: MarketWindow, marketSlug: string, snapshotTs: number, index: number, priceToBeat: number): MarketSnapshot {
  const upMid = 0.52 + index * 0.001;
  const downMid = 0.48 - index * 0.001;
  const spotMid = priceToBeat + 1 + index * 0.1;
  const upEvent = createMarketEvent({ asset, window, marketSlug, tokenSide: "up", eventTs: snapshotTs, price: upMid });
  const downEvent = createMarketEvent({ asset, window, marketSlug, tokenSide: "down", eventTs: snapshotTs, price: downMid });
  const emptyAssetState = {
    binance: createEmptyState(),
    coinbase: createEmptyState(),
    kraken: createEmptyState(),
    okx: createEmptyState(),
    chainlink: createEmptyState()
  };
  const activeAssetState = createAssetState({ asset, window, marketSlug, snapshotTs, midPrice: spotMid });
  const marketSnapshot: MarketSnapshot = {
    triggerEvent: upEvent,
    snapshotTs,
    asset,
    window,
    marketStartTs: 1_700_000_000_000,
    marketEndTs: 1_700_000_300_000,
    priceToBeat,
    crypto: {
      btc: asset === "btc" ? activeAssetState : emptyAssetState,
      eth: asset === "eth" ? activeAssetState : emptyAssetState,
      sol: asset === "sol" ? activeAssetState : emptyAssetState,
      xrp: asset === "xrp" ? activeAssetState : emptyAssetState
    },
    polymarket: {
      up: {
        price: upEvent,
        orderbook: createMarketEvent({
          asset,
          window,
          marketSlug,
          tokenSide: "up",
          eventTs: snapshotTs,
          price: null,
          orderbook: createOrderbook(upMid, 30, 10, 0.01)
        })
      },
      down: {
        price: downEvent,
        orderbook: createMarketEvent({
          asset,
          window,
          marketSlug,
          tokenSide: "down",
          eventTs: snapshotTs,
          price: null,
          orderbook: createOrderbook(downMid, 18, 22, 0.01)
        })
      }
    }
  };
  return marketSnapshot;
}

function createSnapshots(asset: AssetSymbol, window: MarketWindow, marketSlug: string, count: number): readonly MarketSnapshot[] {
  const marketStartTs = 1_700_000_000_000;
  const marketEndTs = 1_700_000_300_000;
  const stepMs = count > 1 ? Math.floor((marketEndTs - marketStartTs) / (count - 1)) : 0;
  const snapshots = Array.from({ length: count }, (_, index) => createSnapshot(asset, window, marketSlug, marketStartTs + index * stepMs, index, 0.5)).map(
    (snapshot) => ({ ...snapshot, marketStartTs, marketEndTs })
  );
  return snapshots;
}

function createLowCoverageSnapshots(asset: AssetSymbol, window: MarketWindow, marketSlug: string, count: number): readonly MarketSnapshot[] {
  const marketStartTs = 1_700_000_000_000;
  const marketEndTs = 1_700_000_300_000;
  const firstSnapshotTs = marketEndTs - 10_000;
  const snapshots = Array.from({ length: count }, (_, index) => createSnapshot(asset, window, marketSlug, firstSnapshotTs + index * 250, index, 0.5)).map(
    (snapshot) => ({ ...snapshot, marketStartTs, marketEndTs })
  );
  return snapshots;
}

function createSnapshotsForMarket(market: MarketRecord, count: number): readonly MarketSnapshot[] {
  const stepMs = count > 1 ? Math.floor((market.marketEndTs - market.marketStartTs) / (count - 1)) : 0;
  const snapshots = Array.from({ length: count }, (_, index) =>
    createSnapshot(market.asset, market.window, market.slug, market.marketStartTs + index * stepMs, index, market.priceToBeat ?? 0.5)
  ).map((snapshot) => ({ ...snapshot, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs }));
  return snapshots;
}

function createLowCoverageSnapshotsForMarket(market: MarketRecord, count: number): readonly MarketSnapshot[] {
  const firstSnapshotTs = market.marketEndTs - 10_000;
  const snapshots = Array.from({ length: count }, (_, index) =>
    createSnapshot(market.asset, market.window, market.slug, firstSnapshotTs + index * 250, index, market.priceToBeat ?? 0.5)
  ).map((snapshot) => ({ ...snapshot, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs }));
  return snapshots;
}

function createBacktestStats(lastRunTs: number, auc: number, f1: number): BacktestStats {
  const backtestStats: BacktestStats = {
    lastRunTs,
    sampleWindowCount: 100,
    auc,
    f1,
    accuracy: f1,
    precision: f1,
    recall: f1,
    logLoss: 1 - auc,
    resolvedOutcome: "up",
    firstRelevantPrediction: null
  };
  return backtestStats;
}

function createMarketRecord(asset: AssetSymbol, window: MarketWindow, slug: string, priceToBeat: number, finalPrice: number): MarketRecord {
  const marketRecord: MarketRecord = {
    slug,
    asset,
    window,
    marketStartTs: 1_700_000_000_000,
    marketEndTs: 1_700_000_300_000,
    upAssetId: `${slug}-up`,
    downAssetId: `${slug}-down`,
    priceToBeat,
    finalPrice,
    isTest: true
  };
  return marketRecord;
}

function createMarketRecordAtRange(
  asset: AssetSymbol,
  window: MarketWindow,
  slug: string,
  priceToBeat: number,
  finalPrice: number,
  marketStartTs: number,
  marketEndTs: number
): MarketRecord {
  const marketRecord: MarketRecord = {
    slug,
    asset,
    window,
    marketStartTs,
    marketEndTs,
    upAssetId: `${slug}-up`,
    downAssetId: `${slug}-down`,
    priceToBeat,
    finalPrice,
    isTest: true
  };
  return marketRecord;
}

function createArtifactState() {
  const artifactState = {
    bias: 0,
    scale: 0.01,
    updatedAtTs: Date.now(),
    tensorflow: { modelFileName: "model.json", featureCount: 71 },
    preprocessing: { inputScaling: "none" as const, featureMeans: [], featureStds: [] },
    inference: { lookbackCandles: 1, minimumValidFeatureRowCount: 1, decisionThreshold: 0.5 },
    training: {
      totalSequenceCount: 1,
      trainSequenceCount: 1,
      validationSequenceCount: 0,
      testSequenceCount: 0,
      epochCount: 1,
      finalLoss: 0,
      finalValidationLoss: null
    }
  };
  return artifactState;
}

function registerModel(options: {
  artifactRepository: ModelArtifactRepository;
  metadataRepository: ModelMetadataRepository;
  catalogRepository: ModelCatalogRepository;
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  score: number;
  minimumSnapshotCount: number;
}): void {
  const artifactPath = options.artifactRepository.buildArtifactPath(options.asset, options.window, options.modelId, options.modelVersion);
  options.artifactRepository.saveArtifact({ artifactPath, state: createArtifactState() });
  const metadataPath = options.metadataRepository.buildMetadataPath(artifactPath);
  const persistedModelMetadata: PersistedModelMetadata = {
    modelId: options.modelId,
    modelVersion: options.modelVersion,
    asset: options.asset,
    window: options.window,
    trainedWindowCount: 120,
    lastTrainedWindowStartTs: 1_700_000_000_000,
    lastTrainedWindowEndTs: 1_700_000_300_000,
    lastTrainingTs: Date.now(),
    latestBacktest: createBacktestStats(Date.now(), 0.6, 0.58),
    score: options.score,
    status: "ready",
    artifactPath,
    minimumSnapshotCount: options.minimumSnapshotCount,
    featureSpecVersion,
    targetSpecVersion,
    configHash: `${options.modelId}-hash`
  };
  options.metadataRepository.writeMetadata(metadataPath, persistedModelMetadata);
  options.catalogRepository.upsertModel({
    modelId: options.modelId,
    modelVersion: options.modelVersion,
    asset: options.asset,
    window: options.window,
    score: options.score,
    status: "ready",
    artifactPath,
    metadataPath,
    trainingStats: {
      trainedWindowCount: persistedModelMetadata.trainedWindowCount,
      lastTrainedWindowStartTs: persistedModelMetadata.lastTrainedWindowStartTs,
      lastTrainedWindowEndTs: persistedModelMetadata.lastTrainedWindowEndTs,
      lastTrainingTs: persistedModelMetadata.lastTrainingTs
    },
    backtestStats: persistedModelMetadata.latestBacktest,
    minimumSnapshotCount: options.minimumSnapshotCount
  });
}

function createRuntimeService(options: {
  tempRootPath: string;
  listMarkets: (window: MarketWindow, asset: AssetSymbol) => Promise<MarketRecord[]>;
  getMarketSnapshots: (slug: string) => Promise<MarketSnapshot[]>;
  combinations: readonly { asset: AssetSymbol; window: MarketWindow }[];
  trainingBatchWindowCount?: number;
  backtestHoldoutWindowCount?: number;
}): {
  runtimeService: ModelFarmRuntimeService;
  catalogRepository: ModelCatalogRepository;
  artifactRepository: ModelArtifactRepository;
  metadataRepository: ModelMetadataRepository;
  trainingWindowRegistryRepository: TrainingWindowRegistryRepository;
} {
  const artifactRepository = new ModelArtifactRepository(join(options.tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(options.tempRootPath, "artifacts", "registry", "model-catalog.json"));
  const trainingWindowRegistryRepository = TrainingWindowRegistryRepository.create(
    join(options.tempRootPath, "artifacts", "registry", "training-window-registry.json")
  );
  const trainerService = ModelTrainerService.create({ artifactRepository, metadataRepository });
  const trainingOrchestratorService = TrainingOrchestratorService.create({
    trainerService,
    backtestEvaluatorService: BacktestEvaluatorService.create(),
    scoreCalculatorService: ScoreCalculatorService.create(),
    catalogRepository,
    metadataRepository,
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 }),
    trainingWindowRegistryRepository
  });
  const gateway = new ClickCollectorGateway({ queryService: { listMarkets: options.listMarkets, getMarketSnapshots: options.getMarketSnapshots } });
  const runtimeService = ModelFarmRuntimeService.create({
    gateway,
    trainingOrchestratorService,
    catalogRepository,
    trainingWindowRegistryRepository,
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 }),
    loopDelayMs: 1,
    maxConcurrentCombinations: 1,
    trainingBatchWindowCount: options.trainingBatchWindowCount ?? 1,
    backtestHoldoutWindowCount: options.backtestHoldoutWindowCount ?? 1,
    combinations: options.combinations
  });
  return { runtimeService, catalogRepository, artifactRepository, metadataRepository, trainingWindowRegistryRepository };
}

test("listModels returns models with public predict method and sorts by score", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-list-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));
  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-low",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 48,
    minimumSnapshotCount: 31
  });
  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-high",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 89,
    minimumSnapshotCount: 31
  });

  const listingService = ModelListingService.create({ catalogRepository, artifactRepository });
  const models = await listingService.listModels({ asset: "btc", window: "5m" });
  const firstModel = models[0];
  if (!firstModel) {
    throw new Error("Expected first model to exist");
  }

  assert.equal(models.length, 2);
  assert.equal(firstModel.modelId, "model-high");
  assert.equal(typeof firstModel.predict, "function");

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("training orchestrator persists artifact metadata and catalog entries", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-train-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));
  const trainingWindowRegistryRepository = TrainingWindowRegistryRepository.create(
    join(tempRootPath, "artifacts", "registry", "training-window-registry.json")
  );
  const trainerService = ModelTrainerService.create({ artifactRepository, metadataRepository });
  const trainingOrchestratorService = TrainingOrchestratorService.create({
    trainerService,
    backtestEvaluatorService: BacktestEvaluatorService.create(),
    scoreCalculatorService: ScoreCalculatorService.create(),
    catalogRepository,
    metadataRepository,
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 }),
    trainingWindowRegistryRepository
  });
  const snapshots = createSnapshots("btc", "5m", "market-btc-5m", 40);
  const market = createMarketRecord("btc", "5m", "market-btc-5m", 0.5, 0.7);

  await trainingOrchestratorService.runOnce([
    {
      modelId: "model-train-a",
      modelVersion: "1.0.0",
      asset: "btc",
      window: "5m",
      trainingWindows: [{ marketSlug: market.slug, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs, snapshots, market }],
      backtestWindows: [{ marketSlug: market.slug, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs, snapshots, market }]
    }
  ]);

  const catalog = catalogRepository.readCatalog();
  const model = catalog.models[0];
  if (!model) {
    throw new Error("Expected persisted model in catalog");
  }
  const persistedMetadata = metadataRepository.readMetadata(model.metadataPath);

  assert.equal(catalog.models.length, 1);
  assert.equal(existsSync(model.artifactPath), true);
  assert.equal(existsSync(model.metadataPath), true);
  assert.equal(persistedMetadata.trainedWindowCount, 1);
  assert.equal(persistedMetadata.featureSpecVersion, featureSpecVersion);
  assert.equal(persistedMetadata.targetSpecVersion, targetSpecVersion);
  assert.equal(trainingWindowRegistryRepository.hasConsumedWindow("model-train-a", market.slug), true);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("training orchestrator skips jobs with insufficient market window coverage", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-train-coverage-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));
  const trainingWindowRegistryRepository = TrainingWindowRegistryRepository.create(
    join(tempRootPath, "artifacts", "registry", "training-window-registry.json")
  );
  const trainerService = ModelTrainerService.create({ artifactRepository, metadataRepository });
  const trainingOrchestratorService = TrainingOrchestratorService.create({
    trainerService,
    backtestEvaluatorService: BacktestEvaluatorService.create(),
    scoreCalculatorService: ScoreCalculatorService.create(),
    catalogRepository,
    metadataRepository,
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 }),
    trainingWindowRegistryRepository
  });
  const snapshots = createLowCoverageSnapshots("btc", "5m", "market-btc-5m-low", 40);
  const market = createMarketRecord("btc", "5m", "market-btc-5m-low", 0.5, 0.7);

  await trainingOrchestratorService.runOnce([
    {
      modelId: "model-train-low",
      modelVersion: "1.0.0",
      asset: "btc",
      window: "5m",
      trainingWindows: [{ marketSlug: market.slug, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs, snapshots, market }],
      backtestWindows: [{ marketSlug: market.slug, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs, snapshots, market }]
    }
  ]);

  const catalog = catalogRepository.readCatalog();
  assert.equal(catalog.models.length, 0);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("training orchestrator trims snapshots outside the market window before training", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-train-trim-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));
  const trainingWindowRegistryRepository = TrainingWindowRegistryRepository.create(
    join(tempRootPath, "artifacts", "registry", "training-window-registry.json")
  );
  const trainerService = ModelTrainerService.create({ artifactRepository, metadataRepository });
  const trainingOrchestratorService = TrainingOrchestratorService.create({
    trainerService,
    backtestEvaluatorService: BacktestEvaluatorService.create(),
    scoreCalculatorService: ScoreCalculatorService.create(),
    catalogRepository,
    metadataRepository,
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 }),
    trainingWindowRegistryRepository
  });
  const snapshots = createSnapshots("btc", "5m", "market-btc-5m-trim", 40);
  const extraLateSnapshot = { ...snapshots[snapshots.length - 1]!, snapshotTs: (snapshots[snapshots.length - 1]?.marketEndTs ?? 0) + 5_000 };
  const dirtySnapshots = [...snapshots, extraLateSnapshot];
  const market = createMarketRecord("btc", "5m", "market-btc-5m-trim", 0.5, 0.7);
  const expectedSampleWindowCount = TensorflowSequenceDatasetService.create().buildEvaluationDataset({
    snapshots,
    market,
    modelConfig: ModelConfigResolverService.create().resolveByWindow("5m"),
    artifactState: createArtifactState()
  }).inputs.length;

  await trainingOrchestratorService.runOnce([
    {
      modelId: "model-train-trim",
      modelVersion: "1.0.0",
      asset: "btc",
      window: "5m",
      trainingWindows: [{ marketSlug: market.slug, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs, snapshots: dirtySnapshots, market }],
      backtestWindows: [{ marketSlug: market.slug, marketStartTs: market.marketStartTs, marketEndTs: market.marketEndTs, snapshots: dirtySnapshots, market }]
    }
  ]);

  const catalog = catalogRepository.readCatalog();
  const model = catalog.models[0];
  if (!model) {
    throw new Error("Expected persisted model in catalog after trimming training snapshots");
  }
  const persistedMetadata = metadataRepository.readMetadata(model.metadataPath);

  assert.equal(persistedMetadata.latestBacktest.sampleWindowCount, expectedSampleWindowCount);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("backtest orchestrator skips evaluations with insufficient market window coverage", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-backtest-coverage-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));
  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-backtest-low",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 50,
    minimumSnapshotCount: 31
  });
  const backtestOrchestratorService = new BacktestOrchestratorService({
    catalogRepository,
    metadataRepository,
    evaluatorService: BacktestEvaluatorService.create(),
    scoreCalculatorService: ScoreCalculatorService.create(),
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 })
  });
  const beforeMetadataPath = catalogRepository.readCatalog().models[0]?.metadataPath;
  if (!beforeMetadataPath) {
    throw new Error("Expected catalog model before backtest coverage test");
  }
  const beforeMetadata = metadataRepository.readMetadata(beforeMetadataPath);
  const lowCoverageSnapshots = createLowCoverageSnapshots("btc", "5m", "model-backtest-low", 40);

  await backtestOrchestratorService.runOnce({
    snapshotProvider: async () => ({ snapshots: lowCoverageSnapshots, market: { priceToBeat: 0.5, finalPrice: 0.7 } })
  });

  const afterMetadata = metadataRepository.readMetadata(beforeMetadataPath);
  assert.deepEqual(afterMetadata.latestBacktest, beforeMetadata.latestBacktest);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("backtest orchestrator trims snapshots outside the market window before evaluation", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-backtest-trim-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));
  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-backtest-trim",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 50,
    minimumSnapshotCount: 31
  });
  const backtestOrchestratorService = new BacktestOrchestratorService({
    catalogRepository,
    metadataRepository,
    evaluatorService: BacktestEvaluatorService.create(),
    scoreCalculatorService: ScoreCalculatorService.create(),
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 })
  });
  const model = catalogRepository.readCatalog().models[0];
  if (!model) {
    throw new Error("Expected catalog model before backtest trimming test");
  }
  const snapshots = createSnapshots("btc", "5m", "model-backtest-trim", 40);
  const extraLateSnapshot = { ...snapshots[snapshots.length - 1]!, snapshotTs: (snapshots[snapshots.length - 1]?.marketEndTs ?? 0) + 5_000 };
  const dirtySnapshots = [...snapshots, extraLateSnapshot];
  const expectedSampleWindowCount = TensorflowSequenceDatasetService.create().buildEvaluationDataset({
    snapshots,
    market: { priceToBeat: 0.5, finalPrice: 0.7 },
    modelConfig: ModelConfigResolverService.create().resolveByWindow("5m"),
    artifactState: createArtifactState()
  }).inputs.length;

  await backtestOrchestratorService.runOnce({ snapshotProvider: async () => ({ snapshots: dirtySnapshots, market: { priceToBeat: 0.5, finalPrice: 0.7 } }) });

  const persistedMetadata = metadataRepository.readMetadata(model.metadataPath);
  assert.equal(persistedMetadata.latestBacktest.sampleWindowCount, expectedSampleWindowCount);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("runtime service records a low-coverage market as skipped and trains the next valid market", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-runtime-skip-"));
  const firstMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-first", 0.5, 0.7, 1_700_000_000_000, 1_700_000_300_000);
  const secondMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-second", 0.5, 0.8, 1_700_000_300_000, 1_700_000_600_000);
  const thirdMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-third", 0.5, 0.9, 1_700_000_600_000, 1_700_000_900_000);
  const snapshotMap = new Map<string, readonly MarketSnapshot[]>([
    [firstMarket.slug, createLowCoverageSnapshotsForMarket(firstMarket, 40)],
    [secondMarket.slug, createSnapshotsForMarket(secondMarket, 40)],
    [thirdMarket.slug, createSnapshotsForMarket(thirdMarket, 40)]
  ]);
  const { runtimeService, catalogRepository, trainingWindowRegistryRepository } = createRuntimeService({
    tempRootPath,
    listMarkets: async (window, asset) => {
      const markets = asset === "btc" && window === "5m" ? [firstMarket, secondMarket, thirdMarket] : [];
      return markets;
    },
    getMarketSnapshots: async (slug) => [...(snapshotMap.get(slug) ?? [])],
    combinations: [{ asset: "btc", window: "5m" }]
  });

  const cycleResult = await runtimeService.runCycleOnce();
  const catalog = catalogRepository.readCatalog();
  const registry = trainingWindowRegistryRepository.readRegistry();
  const model = catalog.models[0];

  if (!model) {
    throw new Error("Expected runtime service to persist one trained model");
  }

  assert.equal(cycleResult.trainedJobCount, 1);
  assert.equal(cycleResult.skippedMarketCount, 1);
  assert.equal(cycleResult.combinationResults.length, 1);
  assert.equal((cycleResult.combinationResults[0]?.durationMs ?? -1) >= 0, true);
  assert.equal(model.modelVersion, String(secondMarket.marketEndTs));
  assert.equal(
    registry.items.some((item) => item.modelId === "runtime-btc-5m-gru" && item.marketSlug === firstMarket.slug && item.status === "skipped"),
    true
  );
  assert.equal(
    registry.items.some((item) => item.modelId === "runtime-btc-5m-gru" && item.marketSlug === secondMarket.slug && item.status === "trained"),
    true
  );

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("runtime service does not revisit a low-coverage market after it was recorded as skipped", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-runtime-skip-repeat-"));
  const firstMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-first", 0.5, 0.7, 1_700_000_000_000, 1_700_000_300_000);
  const secondMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-second", 0.5, 0.8, 1_700_000_300_000, 1_700_000_600_000);
  const thirdMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-third", 0.5, 0.9, 1_700_000_600_000, 1_700_000_900_000);
  const snapshotMap = new Map<string, readonly MarketSnapshot[]>([
    [firstMarket.slug, createLowCoverageSnapshotsForMarket(firstMarket, 40)],
    [secondMarket.slug, createSnapshotsForMarket(secondMarket, 40)],
    [thirdMarket.slug, createSnapshotsForMarket(thirdMarket, 40)]
  ]);
  const { runtimeService } = createRuntimeService({
    tempRootPath,
    listMarkets: async (window, asset) => {
      const markets = asset === "btc" && window === "5m" ? [firstMarket, secondMarket, thirdMarket] : [];
      return markets;
    },
    getMarketSnapshots: async (slug) => [...(snapshotMap.get(slug) ?? [])],
    combinations: [{ asset: "btc", window: "5m" }]
  });

  const firstCycleResult = await runtimeService.runCycleOnce();
  const secondCycleResult = await runtimeService.runCycleOnce();

  assert.equal(firstCycleResult.skippedMarketCount, 1);
  assert.equal(secondCycleResult.trainedJobCount, 0);
  assert.equal(secondCycleResult.skippedMarketCount, 0);
  assert.equal(
    secondCycleResult.combinationResults[0]?.marketResults.some((marketResult) => marketResult.slug === firstMarket.slug),
    false
  );

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("runtime service records consumed windows explicitly and skips them on the next cycle", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-runtime-version-"));
  const firstMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-known", 0.5, 0.7, 1_700_000_000_000, 1_700_000_300_000);
  const secondMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-next", 0.5, 0.8, 1_700_000_300_000, 1_700_000_600_000);
  const thirdMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-holdout-a", 0.5, 0.8, 1_700_000_600_000, 1_700_000_900_000);
  const fourthMarket = createMarketRecordAtRange("btc", "5m", "market-btc-5m-holdout-b", 0.5, 0.9, 1_700_000_900_000, 1_700_001_200_000);
  const snapshotMap = new Map<string, readonly MarketSnapshot[]>([
    [firstMarket.slug, createSnapshotsForMarket(firstMarket, 40)],
    [secondMarket.slug, createSnapshotsForMarket(secondMarket, 40)],
    [thirdMarket.slug, createSnapshotsForMarket(thirdMarket, 40)],
    [fourthMarket.slug, createSnapshotsForMarket(fourthMarket, 40)]
  ]);
  const { runtimeService, catalogRepository, trainingWindowRegistryRepository } = createRuntimeService({
    tempRootPath,
    listMarkets: async (window, asset) => {
      const markets = asset === "btc" && window === "5m" ? [firstMarket, secondMarket, thirdMarket, fourthMarket] : [];
      return markets;
    },
    getMarketSnapshots: async (slug) => [...(snapshotMap.get(slug) ?? [])],
    combinations: [{ asset: "btc", window: "5m" }]
  });

  const firstCycleResult = await runtimeService.runCycleOnce();
  const secondCycleResult = await runtimeService.runCycleOnce();
  const catalog = catalogRepository.readCatalog();
  const registry = trainingWindowRegistryRepository.readRegistry();
  const trainedVersions = catalog.models.filter((item) => item.modelId === "runtime-btc-5m-gru").map((item) => item.modelVersion);

  assert.equal(firstCycleResult.trainedJobCount, 1);
  assert.equal(secondCycleResult.trainedJobCount, 1);
  assert.equal(secondCycleResult.skippedMarketCount, 0);
  assert.equal(secondCycleResult.combinationResults.length, 1);
  assert.equal(
    registry.items.some((item) => item.modelId === "runtime-btc-5m-gru" && item.marketSlug === firstMarket.slug),
    true
  );
  assert.equal(
    registry.items.some((item) => item.modelId === "runtime-btc-5m-gru" && item.marketSlug === secondMarket.slug),
    true
  );
  assert.deepEqual(trainedVersions.sort(), [String(firstMarket.marketEndTs), String(secondMarket.marketEndTs)].sort());

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("catalog and model state are recovered after restart", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-restart-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogFilePath = join(tempRootPath, "artifacts", "registry", "model-catalog.json");
  const catalogRepository = new ModelCatalogRepository(catalogFilePath);

  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-restart",
    modelVersion: "1.0.0",
    asset: "eth",
    window: "15m",
    score: 77,
    minimumSnapshotCount: 31
  });

  const reloadedCatalogRepository = new ModelCatalogRepository(catalogFilePath);
  const reloadedArtifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const listingService = ModelListingService.create({ catalogRepository: reloadedCatalogRepository, artifactRepository: reloadedArtifactRepository });
  const models = await listingService.listModels({ asset: "eth", window: "15m" });
  const firstModel = models[0];
  if (!firstModel) {
    throw new Error("Expected model recovery after restart");
  }

  assert.equal(models.length, 1);
  assert.equal(firstModel.modelId, "model-restart");

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("predict accepts snapshots for current window and returns prediction", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-predict-ok-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));

  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-predict-ok",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 90,
    minimumSnapshotCount: 31
  });

  const listingService = ModelListingService.create({ catalogRepository, artifactRepository });
  const models = await listingService.listModels({ asset: "btc", window: "5m" });
  const firstModel = models[0];
  if (!firstModel) {
    throw new Error("Expected model for prediction");
  }
  const snapshots = createSnapshots("btc", "5m", "market-btc-5m", 40);
  const predictResult = await firstModel.predict(snapshots);
  if (predictResult === null) {
    throw new Error("Expected prediction result for sufficiently long snapshot history");
  }

  assert.equal(typeof predictResult.finalPriceProbUp, "number");
  assert.equal(typeof predictResult.finalPriceProbDown, "number");
  assert.equal(predictResult.probabilityUp, predictResult.finalPriceProbUp);
  assert.equal(predictResult.probabilityDown, predictResult.finalPriceProbDown);
  assert.equal(predictResult.modelId, "model-predict-ok");

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("predict rejects insufficient snapshots", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-predict-short-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));

  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-predict-short",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 90,
    minimumSnapshotCount: 31
  });

  const listingService = ModelListingService.create({ catalogRepository, artifactRepository });
  const models = await listingService.listModels({ asset: "btc", window: "5m" });
  const firstModel = models[0];
  if (!firstModel) {
    throw new Error("Expected model for insufficient snapshot validation");
  }
  const snapshots = createSnapshots("btc", "5m", "market-btc-5m", 30);
  const predictResult = await firstModel.predict(snapshots);

  assert.equal(predictResult, null);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("predict rejects unordered or mixed snapshots", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-predict-invalid-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));

  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-predict-invalid",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 90,
    minimumSnapshotCount: 31
  });

  const listingService = ModelListingService.create({ catalogRepository, artifactRepository });
  const models = await listingService.listModels({ asset: "btc", window: "5m" });
  const firstModel = models[0];
  if (!firstModel) {
    throw new Error("Expected model for invalid snapshot validation");
  }
  const validSnapshots = createSnapshots("btc", "5m", "market-btc-5m", 40);
  const snapshot0 = validSnapshots[0];
  const snapshot1 = validSnapshots[1];
  const snapshot2 = validSnapshots[2];
  if (!snapshot0 || !snapshot1 || !snapshot2) {
    throw new Error("Expected three snapshots for invalid sequence checks");
  }
  const unorderedSnapshots = [snapshot1, snapshot0, ...validSnapshots.slice(2)];
  const mixedSnapshots = [...validSnapshots];
  mixedSnapshots[39] = createSnapshot("eth", "5m", "market-eth-5m", snapshot2.snapshotTs + 37_000, 39, 0.5);

  await assert.rejects(async () => {
    await firstModel.predict(unorderedSnapshots);
  });
  await assert.rejects(async () => {
    await firstModel.predict(mixedSnapshots);
  });

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("predict returns null when latest snapshot still lacks historical context", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-predict-null-"));
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));

  registerModel({
    artifactRepository,
    metadataRepository,
    catalogRepository,
    modelId: "model-predict-null",
    modelVersion: "1.0.0",
    asset: "btc",
    window: "5m",
    score: 90,
    minimumSnapshotCount: 31
  });

  const listingService = ModelListingService.create({ catalogRepository, artifactRepository });
  const models = await listingService.listModels({ asset: "btc", window: "5m" });
  const firstModel = models[0];
  if (!firstModel) {
    throw new Error("Expected model for null prediction validation");
  }
  const snapshots = createSnapshots("btc", "5m", "market-btc-5m", 10);
  const predictResult = await firstModel.predict(snapshots);

  assert.equal(predictResult, null);

  rmSync(tempRootPath, { recursive: true, force: true });
});
