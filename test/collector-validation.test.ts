import * as assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { AssetSymbol, MarketEvent, MarketRecord, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

import { BacktestEvaluatorService } from "../src/backtest/backtest-evaluator.service.ts";
import { ScoreCalculatorService } from "../src/backtest/score-calculator.service.ts";
import { ClickCollectorGateway } from "../src/data-source/click-collector.gateway.ts";
import { ModelArtifactRepository } from "../src/model-catalog/model-artifact.repository.ts";
import { ModelCatalogRepository } from "../src/model-catalog/model-catalog.repository.ts";
import { MarketWindowCoverageService } from "../src/shared/market-window-coverage.service.ts";
import { ModelMetadataRepository } from "../src/model-catalog/model-metadata.repository.ts";
import { ModelTrainerService } from "../src/training/model-trainer.service.ts";
import { CollectorValidationFeatureAnalyzerService } from "../src/validation/collector-validation-feature-analyzer.service.ts";
import { CollectorValidationMarketSelectorService } from "../src/validation/collector-validation-market-selector.service.ts";
import { CollectorValidationReportRepository } from "../src/validation/collector-validation-report.repository.ts";
import { CollectorValidationRunnerService } from "../src/validation/collector-validation-runner.service.ts";
import { CollectorValidationSnapshotAnalyzerService } from "../src/validation/collector-validation-snapshot-analyzer.service.ts";

type FakeQueryService = {
  listMarkets: (window: MarketWindow, asset: AssetSymbol) => Promise<MarketRecord[]>;
  getMarketSnapshots: (slug: string) => Promise<MarketSnapshot[]>;
};

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

function createActiveAssetState(asset: AssetSymbol, window: MarketWindow, marketSlug: string, snapshotTs: number, midPrice: number) {
  const createSpotState = (sourceName: string, price: number, orderbook?: string) => {
    const sourceCategory = sourceName === "chainlink" ? "chainlink" : "exchange";
    const priceEvent = createMarketEvent({ asset, window, marketSlug, tokenSide: null, eventTs: snapshotTs, price, sourceCategory, sourceName });
    const orderbookEvent =
      typeof orderbook === "string"
        ? createMarketEvent({ asset, window, marketSlug, tokenSide: null, eventTs: snapshotTs, price: null, orderbook, sourceCategory, sourceName })
        : null;
    const spotState = { price: priceEvent, orderbook: orderbookEvent };
    return spotState;
  };
  const assetState = {
    binance: createSpotState("binance", midPrice, createOrderbook(midPrice, 12, 8, 0.5)),
    coinbase: createSpotState("coinbase", midPrice + 0.2, createOrderbook(midPrice + 0.2, 11, 9, 0.5)),
    kraken: createSpotState("kraken", midPrice - 0.1, createOrderbook(midPrice - 0.1, 13, 7, 0.5)),
    okx: createSpotState("okx", midPrice + 0.1, createOrderbook(midPrice + 0.1, 10, 10, 0.5)),
    chainlink: createSpotState("chainlink", midPrice + 0.05)
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
  const activeAssetState = createActiveAssetState(asset, window, marketSlug, snapshotTs, spotMid);
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
  const snapshots = Array.from({ length: count }, (_, index) => createSnapshot(asset, window, marketSlug, marketStartTs + index * stepMs, index, 100)).map(
    (snapshot) => ({ ...snapshot, marketStartTs, marketEndTs })
  );
  return snapshots;
}

function createLowCoverageSnapshots(asset: AssetSymbol, window: MarketWindow, marketSlug: string, count: number): readonly MarketSnapshot[] {
  const marketStartTs = 1_700_000_000_000;
  const marketEndTs = 1_700_000_300_000;
  const firstSnapshotTs = marketEndTs - 10_000;
  const snapshots = Array.from({ length: count }, (_, index) => createSnapshot(asset, window, marketSlug, firstSnapshotTs + index * 250, index, 100)).map(
    (snapshot) => ({ ...snapshot, marketStartTs, marketEndTs })
  );
  return snapshots;
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

function createRunner(tempRootPath: string, fakeQueryService: FakeQueryService, marketTimeoutMs?: number): CollectorValidationRunnerService {
  const gateway = new ClickCollectorGateway({ queryService: fakeQueryService });
  const artifactRepository = new ModelArtifactRepository(join(tempRootPath, "artifacts", "models"));
  const metadataRepository = ModelMetadataRepository.create();
  const catalogRepository = new ModelCatalogRepository(join(tempRootPath, "artifacts", "registry", "model-catalog.json"));
  const runner = CollectorValidationRunnerService.create({
    gateway,
    marketSelectorService: CollectorValidationMarketSelectorService.create({ gateway }),
    snapshotAnalyzerService: CollectorValidationSnapshotAnalyzerService.create(),
    featureAnalyzerService: CollectorValidationFeatureAnalyzerService.create(),
    reportRepository: CollectorValidationReportRepository.create(join(tempRootPath, "artifacts", "validation")),
    coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: 0.8 }),
    trainerService: ModelTrainerService.create({ artifactRepository, metadataRepository }),
    artifactRepository,
    metadataRepository,
    catalogRepository,
    backtestEvaluatorService: BacktestEvaluatorService.create(),
    scoreCalculatorService: ScoreCalculatorService.create(),
    ...(typeof marketTimeoutMs === "number" ? { marketTimeoutMs } : {})
  });
  return runner;
}

test("snapshot analyzer rejects unordered snapshots", () => {
  const analyzer = CollectorValidationSnapshotAnalyzerService.create();
  const snapshots = createSnapshots("btc", "5m", "market-btc-5m", 4);
  const unorderedSnapshots = [snapshots[1]!, snapshots[0]!, snapshots[2]!, snapshots[3]!];
  const result = analyzer.analyze(unorderedSnapshots);

  assert.equal(result.isAscendingByTimestamp, false);
  assert.equal(result.failures.includes("Snapshots are not sorted by snapshotTs ascending"), true);
});

test("report repository writes summary and window files", () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-validation-report-"));
  const repository = CollectorValidationReportRepository.create(tempRootPath);
  const reportRootPath = repository.buildReportRootPath("demo", 123);
  const filePath = repository.writeWindowReport({
    reportRootPath,
    asset: "btc",
    window: "5m",
    report: { asset: "btc", window: "5m", processedMarkets: [], rejectedMarkets: [], status: "pass", warningCount: 0, failureCount: 0 }
  });
  const summaryPaths = repository.writeSummary({
    reportRootPath,
    result: {
      runTs: 123,
      asset: "btc",
      windows: ["5m"],
      collectorHost: "http://192.168.1.2:8123",
      reportRootPath,
      summaryFilePath: "",
      consoleSummaryFilePath: "",
      windowReportFilePaths: [filePath],
      processedMarketCount: 0,
      rejectedMarketCount: 0,
      trainingExecutionCount: 0,
      backtestExecutionCount: 0,
      warnings: [],
      failures: []
    },
    consoleSummary: "ok"
  });

  assert.equal(existsSync(filePath), true);
  assert.equal(existsSync(summaryPaths.summaryFilePath), true);
  assert.equal(existsSync(summaryPaths.consoleSummaryFilePath), true);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("validation runner processes a real-looking market and persists reports and artifacts", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-validation-runner-"));
  const market = createMarketRecord("btc", "5m", "market-btc-5m", 100, 104);
  const snapshots = createSnapshots("btc", "5m", market.slug, 40);
  const fakeQueryService: FakeQueryService = { listMarkets: async () => [market], getMarketSnapshots: async () => [...snapshots] };
  const runner = createRunner(tempRootPath, fakeQueryService);
  const result = await runner.runOnce({
    asset: "btc",
    windows: ["5m"],
    marketLimitPerWindow: 1,
    reportLabel: "test-run",
    reportDirectoryPath: join(tempRootPath, "artifacts", "validation")
  });
  const summary = JSON.parse(readFileSync(result.summaryFilePath, "utf8")) as { processedMarketCount: number };
  const catalogFilePath = join(tempRootPath, "artifacts", "registry", "model-catalog.json");
  const catalog = JSON.parse(readFileSync(catalogFilePath, "utf8")) as { models: { artifactPath: string; metadataPath: string }[] };
  const firstModel = catalog.models[0];
  if (!firstModel) {
    throw new Error("Expected a persisted model after validation run");
  }

  assert.equal(result.processedMarketCount, 1);
  assert.equal(summary.processedMarketCount, 1);
  assert.equal(existsSync(firstModel.artifactPath), true);
  assert.equal(existsSync(firstModel.metadataPath), true);
  assert.equal(result.windowReportFilePaths.length, 1);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("validation runner rejects markets when all feature rows are null", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-validation-null-"));
  const market = createMarketRecord("btc", "5m", "market-btc-short", 100, 98);
  const snapshots = createSnapshots("btc", "5m", market.slug, 2);
  const fakeQueryService: FakeQueryService = { listMarkets: async () => [market], getMarketSnapshots: async () => [...snapshots] };
  const runner = createRunner(tempRootPath, fakeQueryService);
  const result = await runner.runOnce({
    asset: "btc",
    windows: ["5m"],
    marketLimitPerWindow: 1,
    reportLabel: "short-run",
    reportDirectoryPath: join(tempRootPath, "artifacts", "validation")
  });
  const windowReport = JSON.parse(readFileSync(result.windowReportFilePaths[0]!, "utf8")) as {
    processedMarkets: unknown[];
    rejectedMarkets: { reason: string }[];
  };

  assert.equal(result.processedMarketCount, 0);
  assert.equal(result.rejectedMarketCount, 1);
  assert.equal(windowReport.processedMarkets.length, 0);
  assert.equal(windowReport.rejectedMarkets[0]?.reason.includes("All feature rows were discarded as null"), true);

  rmSync(tempRootPath, { recursive: true, force: true });
});

test("click collector gateway createFromConfig uses env-backed configuration", async () => {
  process.env.CLICK_COLLECTOR_HOST = "http://192.168.1.2:8123";
  process.env.CLICK_COLLECTOR_USERNAME = "default";
  process.env.CLICK_COLLECTOR_PASSWORD = "default";
  const gateway = await ClickCollectorGateway.createFromConfig();

  assert.equal(gateway instanceof ClickCollectorGateway, true);
});

test("validation runner rejects a market when snapshot fetch times out", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-validation-timeout-"));
  const market = createMarketRecord("btc", "5m", "market-btc-timeout", 100, 104);
  const fakeQueryService: FakeQueryService = {
    listMarkets: async () => [market],
    getMarketSnapshots: async () => await new Promise<MarketSnapshot[]>(() => {})
  };
  const runner = createRunner(tempRootPath, fakeQueryService, 20);
  let didReject = false;
  try {
    await runner.runOnce({
      asset: "btc",
      windows: ["5m"],
      marketLimitPerWindow: 1,
      reportLabel: "timeout-run",
      reportDirectoryPath: join(tempRootPath, "artifacts", "validation")
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    didReject = message.includes("timed out");
  }

  assert.equal(didReject, true);
  rmSync(tempRootPath, { recursive: true, force: true });
});

test("validation runner trims snapshots outside the market window", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-validation-window-trim-"));
  const market = createMarketRecord("btc", "5m", "market-btc-trim", 100, 104);
  const snapshots = createSnapshots("btc", "5m", market.slug, 40);
  const extraLateSnapshot = { ...snapshots[snapshots.length - 1]!, snapshotTs: market.marketEndTs + 5_000 };
  const fakeQueryService: FakeQueryService = { listMarkets: async () => [market], getMarketSnapshots: async () => [...snapshots, extraLateSnapshot] };
  const runner = createRunner(tempRootPath, fakeQueryService);
  const result = await runner.runOnce({
    asset: "btc",
    windows: ["5m"],
    marketLimitPerWindow: 1,
    reportLabel: "trim-run",
    reportDirectoryPath: join(tempRootPath, "artifacts", "validation")
  });
  const windowReport = JSON.parse(readFileSync(result.windowReportFilePaths[0]!, "utf8")) as {
    processedMarkets: { snapshotAnalysis: { snapshotCount: number; lastSnapshotTs: number | null } }[];
  };
  const firstMarket = windowReport.processedMarkets[0];
  if (!firstMarket) {
    throw new Error("Expected processed market after trimming snapshots");
  }

  assert.equal(firstMarket.snapshotAnalysis.snapshotCount, snapshots.length);
  assert.equal(firstMarket.snapshotAnalysis.lastSnapshotTs, snapshots[snapshots.length - 1]?.snapshotTs ?? null);
  rmSync(tempRootPath, { recursive: true, force: true });
});

test("validation runner rejects a market with insufficient market window coverage", async () => {
  const tempRootPath = mkdtempSync(join(tmpdir(), "model-farm-validation-coverage-"));
  const market = createMarketRecord("btc", "5m", "market-btc-low-coverage", 100, 104);
  const snapshots = createLowCoverageSnapshots("btc", "5m", market.slug, 40);
  const fakeQueryService: FakeQueryService = { listMarkets: async () => [market], getMarketSnapshots: async () => [...snapshots] };
  const runner = createRunner(tempRootPath, fakeQueryService);
  const result = await runner.runOnce({
    asset: "btc",
    windows: ["5m"],
    marketLimitPerWindow: 1,
    reportLabel: "coverage-run",
    reportDirectoryPath: join(tempRootPath, "artifacts", "validation")
  });
  const windowReport = JSON.parse(readFileSync(result.windowReportFilePaths[0]!, "utf8")) as {
    processedMarkets: unknown[];
    rejectedMarkets: { reason: string }[];
  };

  assert.equal(result.processedMarketCount, 0);
  assert.equal(result.rejectedMarketCount, 1);
  assert.equal(windowReport.processedMarkets.length, 0);
  assert.equal(windowReport.rejectedMarkets[0]?.reason.includes("coverage"), true);

  rmSync(tempRootPath, { recursive: true, force: true });
});
