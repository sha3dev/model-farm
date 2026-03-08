/**
 * @section imports:externals
 */

import type { AssetSymbol, MarketRecord, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import { ClickCollectorGateway } from "../data-source/click-collector.gateway.ts";
import { ModelCatalogRepository } from "../model-catalog/model-catalog.repository.ts";
import { MarketWindowCoverageService } from "../shared/market-window-coverage.service.ts";
import { TrainingOrchestratorService, type TrainingJob } from "../training/training-orchestrator.service.ts";
import { TrainingWindowRegistryRepository } from "../training/training-window-registry.repository.ts";

/**
 * @section consts
 */

const runtimeAssets: readonly AssetSymbol[] = ["btc", "eth", "sol", "xrp"];
const runtimeWindows: readonly MarketWindow[] = ["5m", "15m"];

/**
 * @section types
 */

type RuntimeCombination = { asset: AssetSymbol; window: MarketWindow };
type ModelFarmRuntimeServiceOptions = {
  gateway: ClickCollectorGateway;
  trainingOrchestratorService: TrainingOrchestratorService;
  catalogRepository: ModelCatalogRepository;
  trainingWindowRegistryRepository: TrainingWindowRegistryRepository;
  coverageService: MarketWindowCoverageService;
  loopDelayMs: number;
  maxConcurrentCombinations: number;
  trainingBatchWindowCount: number;
  backtestHoldoutWindowCount: number;
  combinations?: readonly RuntimeCombination[];
};

type RuntimeMarketResult = { slug: string; status: "trained" | "skipped"; snapshotCount: number; durationMs: number };
type RuntimeWindowDataset = {
  marketSlug: string;
  marketStartTs: number;
  marketEndTs: number;
  snapshots: readonly MarketSnapshot[];
  market: Pick<MarketRecord, "priceToBeat" | "finalPrice">;
};

type RuntimeCombinationResult = {
  asset: AssetSymbol;
  window: MarketWindow;
  trainedJobCount: number;
  skippedMarketCount: number;
  durationMs: number;
  marketResults: readonly RuntimeMarketResult[];
};

type RuntimeCycleResult = { trainedJobCount: number; skippedMarketCount: number; durationMs: number; combinationResults: readonly RuntimeCombinationResult[] };

export class ModelFarmRuntimeService {
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

  private readonly gateway: ClickCollectorGateway;
  private readonly trainingOrchestratorService: TrainingOrchestratorService;
  private readonly catalogRepository: ModelCatalogRepository;
  private readonly trainingWindowRegistryRepository: TrainingWindowRegistryRepository;
  private readonly coverageService: MarketWindowCoverageService;
  private readonly loopDelayMs: number;
  private readonly maxConcurrentCombinations: number;
  private readonly trainingBatchWindowCount: number;
  private readonly backtestHoldoutWindowCount: number;
  private readonly combinations: readonly RuntimeCombination[];
  private readonly waitingResolvers: Array<() => void>;
  private activeCombinationCount: number;
  private isRunning: boolean;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: ModelFarmRuntimeServiceOptions) {
    this.gateway = options.gateway;
    this.trainingOrchestratorService = options.trainingOrchestratorService;
    this.catalogRepository = options.catalogRepository;
    this.trainingWindowRegistryRepository = options.trainingWindowRegistryRepository;
    this.coverageService = options.coverageService;
    this.loopDelayMs = options.loopDelayMs;
    this.maxConcurrentCombinations = options.maxConcurrentCombinations;
    this.trainingBatchWindowCount = options.trainingBatchWindowCount;
    this.backtestHoldoutWindowCount = options.backtestHoldoutWindowCount;
    this.combinations = options.combinations ?? this.buildDefaultCombinations();
    this.waitingResolvers = [];
    this.activeCombinationCount = 0;
    this.isRunning = false;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static async createDefault(): Promise<ModelFarmRuntimeService> {
    const gateway = await ClickCollectorGateway.createFromConfig();
    const service = new ModelFarmRuntimeService({
      gateway,
      trainingOrchestratorService: TrainingOrchestratorService.createDefault(),
      catalogRepository: ModelCatalogRepository.createDefault(),
      trainingWindowRegistryRepository: TrainingWindowRegistryRepository.createDefault(),
      coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: CONFIG.MIN_MARKET_WINDOW_COVERAGE_RATIO }),
      loopDelayMs: CONFIG.MODEL_SERVICE_LOOP_DELAY_MS,
      maxConcurrentCombinations: CONFIG.MODEL_SERVICE_MAX_CONCURRENT_COMBINATIONS,
      trainingBatchWindowCount: CONFIG.MODEL_TRAINING_BATCH_WINDOW_COUNT,
      backtestHoldoutWindowCount: CONFIG.MODEL_BACKTEST_HOLDOUT_WINDOW_COUNT
    });
    return service;
  }

  public static create(options: ModelFarmRuntimeServiceOptions): ModelFarmRuntimeService {
    const service = new ModelFarmRuntimeService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private buildDefaultCombinations(): readonly RuntimeCombination[] {
    const combinations = runtimeAssets.flatMap((asset) => {
      const assetCombinations = runtimeWindows.map((window) => ({ asset, window }));
      return assetCombinations;
    });
    return combinations;
  }

  private createEmptyCycleResult(): RuntimeCycleResult {
    const cycleResult: RuntimeCycleResult = { trainedJobCount: 0, skippedMarketCount: 0, durationMs: 0, combinationResults: [] };
    return cycleResult;
  }

  private buildModelId(combination: RuntimeCombination): string {
    const modelId = `runtime-${combination.asset}-${combination.window}-gru`;
    return modelId;
  }

  private isResolvedClosedMarket(market: MarketRecord, nowTs: number): boolean {
    const isResolvedClosedMarket = market.marketEndTs < nowTs && typeof market.priceToBeat === "number" && typeof market.finalPrice === "number";
    return isResolvedClosedMarket;
  }

  private selectCandidateMarkets(combination: RuntimeCombination, markets: readonly MarketRecord[]): readonly MarketRecord[] {
    const nowTs = Date.now();
    const modelId = this.buildModelId(combination);
    const candidateMarkets = markets
      .filter((market) => {
        const isCandidate = this.isResolvedClosedMarket(market, nowTs) && !this.trainingWindowRegistryRepository.hasProcessedWindow(modelId, market.slug);
        return isCandidate;
      })
      .sort((leftMarket, rightMarket) => leftMarket.marketStartTs - rightMarket.marketStartTs);
    return candidateMarkets;
  }

  private async acquireCombinationSlot(): Promise<void> {
    if (this.activeCombinationCount >= this.maxConcurrentCombinations) {
      await new Promise<void>((resolve) => {
        this.waitingResolvers.push(resolve);
      });
    }
    this.activeCombinationCount += 1;
  }

  private releaseCombinationSlot(): void {
    this.activeCombinationCount = Math.max(0, this.activeCombinationCount - 1);
    const nextResolver = this.waitingResolvers.shift() ?? null;
    if (nextResolver) {
      nextResolver();
    }
  }

  private async waitLoopDelay(): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, this.loopDelayMs);
    });
  }

  private buildWindowDataset(market: MarketRecord, snapshots: readonly MarketSnapshot[]): RuntimeWindowDataset {
    const windowDataset: RuntimeWindowDataset = {
      marketSlug: market.slug,
      marketStartTs: market.marketStartTs,
      marketEndTs: market.marketEndTs,
      snapshots,
      market: { priceToBeat: market.priceToBeat, finalPrice: market.finalPrice }
    };
    return windowDataset;
  }

  private buildTrainingJob(
    combination: RuntimeCombination,
    trainingWindows: readonly RuntimeWindowDataset[],
    backtestWindows: readonly RuntimeWindowDataset[]
  ): TrainingJob {
    const lastTrainingWindow = trainingWindows[trainingWindows.length - 1];
    if (!lastTrainingWindow) {
      throw new Error(`Runtime requires at least one training window for ${combination.asset}/${combination.window}`);
    }
    const trainingJob: TrainingJob = {
      modelId: this.buildModelId(combination),
      modelVersion: String(lastTrainingWindow.marketEndTs),
      asset: combination.asset,
      window: combination.window,
      trainingWindows,
      backtestWindows
    };
    return trainingJob;
  }

  private async trainBatch(
    combination: RuntimeCombination,
    trainingWindows: readonly RuntimeWindowDataset[],
    backtestWindows: readonly RuntimeWindowDataset[]
  ): Promise<void> {
    const trainingJob = this.buildTrainingJob(combination, trainingWindows, backtestWindows);
    await this.trainingOrchestratorService.runOnce([trainingJob]);
  }

  private async fetchMarketWindowDataset(combination: RuntimeCombination, market: MarketRecord): Promise<RuntimeWindowDataset | null> {
    const rawSnapshots = await this.gateway.getWindowSnapshotsBySlug(market.slug);
    const normalizedSnapshots = this.coverageService.normalizeSnapshotsToWindow(rawSnapshots);
    let windowDataset: RuntimeWindowDataset | null = null;
    if (this.coverageService.isCoverageSufficient(market, normalizedSnapshots)) {
      windowDataset = this.buildWindowDataset(market, normalizedSnapshots);
    } else {
      this.trainingWindowRegistryRepository.markWindowSkipped({
        modelId: this.buildModelId(combination),
        modelVersion: String(market.marketEndTs),
        asset: combination.asset,
        window: combination.window,
        marketSlug: market.slug,
        marketStartTs: market.marketStartTs,
        marketEndTs: market.marketEndTs,
        reason: "insufficient_market_window_coverage"
      });
    }
    return windowDataset;
  }

  private async resolveWindowDataset(
    combination: RuntimeCombination,
    market: MarketRecord,
    cache: Map<string, RuntimeWindowDataset | null>,
    marketResults: RuntimeMarketResult[]
  ): Promise<RuntimeWindowDataset | null> {
    const cachedWindowDataset = cache.get(market.slug);
    let windowDataset = cachedWindowDataset ?? null;
    if (cachedWindowDataset === undefined) {
      const startedAtTs = Date.now();
      windowDataset = await this.fetchMarketWindowDataset(combination, market);
      cache.set(market.slug, windowDataset);
      marketResults.push({
        slug: market.slug,
        status: windowDataset === null ? "skipped" : "trained",
        snapshotCount: windowDataset?.snapshots.length ?? 0,
        durationMs: Date.now() - startedAtTs
      });
    }
    return windowDataset;
  }

  private async collectHoldoutWindows(
    combination: RuntimeCombination,
    candidateMarkets: readonly MarketRecord[],
    cache: Map<string, RuntimeWindowDataset | null>,
    marketResults: RuntimeMarketResult[]
  ): Promise<readonly RuntimeWindowDataset[]> {
    const holdoutWindows: RuntimeWindowDataset[] = [];
    for (let index = candidateMarkets.length - 1; index >= 0 && holdoutWindows.length < this.backtestHoldoutWindowCount; index -= 1) {
      const market = candidateMarkets[index];
      if (market) {
        const windowDataset = await this.resolveWindowDataset(combination, market, cache, marketResults);
        if (windowDataset !== null) {
          holdoutWindows.unshift(windowDataset);
        }
      }
    }
    return holdoutWindows;
  }

  private async collectTrainingWindows(
    combination: RuntimeCombination,
    candidateMarkets: readonly MarketRecord[],
    holdoutWindows: readonly RuntimeWindowDataset[],
    cache: Map<string, RuntimeWindowDataset | null>,
    marketResults: RuntimeMarketResult[]
  ): Promise<readonly RuntimeWindowDataset[]> {
    const holdoutSlugSet = new Set(holdoutWindows.map((windowDataset) => windowDataset.marketSlug));
    const trainingWindows: RuntimeWindowDataset[] = [];
    for (const market of candidateMarkets) {
      if (!holdoutSlugSet.has(market.slug) && trainingWindows.length < this.trainingBatchWindowCount) {
        const windowDataset = await this.resolveWindowDataset(combination, market, cache, marketResults);
        if (windowDataset !== null) {
          trainingWindows.push(windowDataset);
        }
      }
    }
    return trainingWindows;
  }

  private async processCombinationOnce(combination: RuntimeCombination): Promise<RuntimeCombinationResult> {
    const startedAtTs = Date.now();
    const markets = await this.gateway.listMarkets(combination.window, combination.asset);
    const candidateMarkets = this.selectCandidateMarkets(combination, markets);
    let trainedJobCount = 0;
    let skippedMarketCount = 0;
    const marketResults: RuntimeMarketResult[] = [];
    const cache = new Map<string, RuntimeWindowDataset | null>();
    const holdoutWindows = await this.collectHoldoutWindows(combination, candidateMarkets, cache, marketResults);
    const trainingWindows = await this.collectTrainingWindows(combination, candidateMarkets, holdoutWindows, cache, marketResults);
    skippedMarketCount = marketResults.filter((marketResult) => marketResult.status === "skipped").length;
    if (trainingWindows.length === this.trainingBatchWindowCount && holdoutWindows.length === this.backtestHoldoutWindowCount) {
      const startedAtTs = Date.now();
      await this.trainBatch(combination, trainingWindows, holdoutWindows);
      const latestTrainingWindow = trainingWindows[trainingWindows.length - 1];
      if (latestTrainingWindow) {
        marketResults.push({
          slug: latestTrainingWindow.marketSlug,
          status: "trained",
          snapshotCount: trainingWindows.reduce((sum, windowDataset) => sum + windowDataset.snapshots.length, 0),
          durationMs: Date.now() - startedAtTs
        });
      }
      trainedJobCount = 1;
    }
    const combinationResult: RuntimeCombinationResult = {
      asset: combination.asset,
      window: combination.window,
      trainedJobCount,
      skippedMarketCount,
      durationMs: Date.now() - startedAtTs,
      marketResults
    };
    return combinationResult;
  }

  private async processCombinationWithSlot(combination: RuntimeCombination): Promise<RuntimeCombinationResult> {
    await this.acquireCombinationSlot();
    let combinationResult: RuntimeCombinationResult = {
      asset: combination.asset,
      window: combination.window,
      trainedJobCount: 0,
      skippedMarketCount: 0,
      durationMs: 0,
      marketResults: []
    };
    try {
      combinationResult = await this.processCombinationOnce(combination);
    } finally {
      this.releaseCombinationSlot();
    }
    return combinationResult;
  }

  private async runCombinationLoop(combination: RuntimeCombination): Promise<void> {
    while (this.isRunning) {
      await this.processCombinationWithSlot(combination);
      await this.waitLoopDelay();
    }
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async runCycleOnce(): Promise<RuntimeCycleResult> {
    const startedAtTs = Date.now();
    const combinationResults = await Promise.all(this.combinations.map(async (combination) => await this.processCombinationWithSlot(combination)));
    const runtimeCycleResult: RuntimeCycleResult = {
      ...this.createEmptyCycleResult(),
      trainedJobCount: combinationResults.reduce((sum, result) => sum + result.trainedJobCount, 0),
      skippedMarketCount: combinationResults.reduce((sum, result) => sum + result.skippedMarketCount, 0),
      durationMs: Date.now() - startedAtTs,
      combinationResults
    };
    return runtimeCycleResult;
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    console.log(`[runtime] starting model-farm service combinations=${this.combinations.length} maxConcurrent=${this.maxConcurrentCombinations}`);
    await Promise.all(this.combinations.map(async (combination) => await this.runCombinationLoop(combination)));
  }

  public stop(): void {
    this.isRunning = false;
    console.log("[runtime] stopping model-farm service");
  }

  /**
   * @section static:methods
   */

  // empty
}
