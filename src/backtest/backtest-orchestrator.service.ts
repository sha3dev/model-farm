/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import { ModelCatalogRepository } from "../model-catalog/model-catalog.repository.ts";
import { ModelMetadataRepository } from "../model-catalog/model-metadata.repository.ts";
import { MarketWindowCoverageService } from "../shared/market-window-coverage.service.ts";
import { BacktestEvaluatorService } from "./backtest-evaluator.service.ts";
import { ScoreCalculatorService } from "./score-calculator.service.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

import type { MarketRecord, MarketSnapshot } from "@sha3/click-collector";

type BacktestRunOptions = {
  snapshotProvider: (
    modelId: string,
    modelVersion: string
  ) => Promise<{ snapshots: readonly MarketSnapshot[]; market: Pick<MarketRecord, "priceToBeat" | "finalPrice"> }>;
};

type BacktestOrchestratorServiceOptions = {
  catalogRepository: ModelCatalogRepository;
  metadataRepository: ModelMetadataRepository;
  evaluatorService: BacktestEvaluatorService;
  scoreCalculatorService: ScoreCalculatorService;
  coverageService: MarketWindowCoverageService;
};

export class BacktestOrchestratorService {
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

  private readonly catalogRepository: ModelCatalogRepository;
  private readonly metadataRepository: ModelMetadataRepository;
  private readonly evaluatorService: BacktestEvaluatorService;
  private readonly scoreCalculatorService: ScoreCalculatorService;
  private readonly coverageService: MarketWindowCoverageService;
  private timer: NodeJS.Timeout | null;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: BacktestOrchestratorServiceOptions) {
    this.catalogRepository = options.catalogRepository;
    this.metadataRepository = options.metadataRepository;
    this.evaluatorService = options.evaluatorService;
    this.scoreCalculatorService = options.scoreCalculatorService;
    this.coverageService = options.coverageService;
    this.timer = null;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): BacktestOrchestratorService {
    const backtestOrchestratorService = new BacktestOrchestratorService({
      catalogRepository: ModelCatalogRepository.createDefault(),
      metadataRepository: ModelMetadataRepository.create(),
      evaluatorService: BacktestEvaluatorService.create(),
      scoreCalculatorService: ScoreCalculatorService.create(),
      coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: CONFIG.MIN_MARKET_WINDOW_COVERAGE_RATIO })
    });
    return backtestOrchestratorService;
  }

  /**
   * @section private:methods
   */

  private async runScheduledTick(snapshotProvider: BacktestRunOptions["snapshotProvider"]): Promise<void> {
    await this.runOnce({ snapshotProvider });
  }

  private hasSufficientCoverage(snapshots: readonly MarketSnapshot[]): boolean {
    const coverageMarket = snapshots[0] ? { marketStartTs: snapshots[0].marketStartTs, marketEndTs: snapshots[0].marketEndTs } : null;
    const hasSufficientCoverage = coverageMarket !== null && this.coverageService.isCoverageSufficient(coverageMarket, snapshots);
    return hasSufficientCoverage;
  }

  private normalizeSnapshots(snapshots: readonly MarketSnapshot[]): readonly MarketSnapshot[] {
    const normalizedSnapshots = this.coverageService.normalizeSnapshotsToWindow(snapshots);
    return normalizedSnapshots;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async runOnce(options: BacktestRunOptions): Promise<void> {
    const catalog = this.catalogRepository.readCatalog();
    for (const item of catalog.models) {
      const backtestData = await options.snapshotProvider(item.modelId, item.modelVersion);
      const normalizedSnapshots = this.normalizeSnapshots(backtestData.snapshots);
      const hasEnoughSnapshots = normalizedSnapshots.length >= item.minimumSnapshotCount;
      const hasEnoughCoverage = this.hasSufficientCoverage(normalizedSnapshots);
      if (hasEnoughSnapshots && hasEnoughCoverage) {
        const evaluation = await this.evaluatorService.evaluate({
          asset: item.asset,
          window: item.window,
          snapshots: normalizedSnapshots,
          market: backtestData.market,
          artifactPath: item.artifactPath
        });
        const metadata = this.metadataRepository.readMetadata(item.metadataPath);
        const score = this.scoreCalculatorService.calculateScore({
          backtestStats: evaluation.stats,
          trainedAtTs: metadata.lastTrainingTs,
          stabilityFactor: evaluation.stabilityFactor,
          overfitPenalty: 0
        });
        const nextMetadata = { ...metadata, latestBacktest: evaluation.stats, score };
        this.metadataRepository.writeMetadata(item.metadataPath, nextMetadata);
        const nextItem = { ...item, backtestStats: nextMetadata.latestBacktest, score: nextMetadata.score, status: nextMetadata.status };
        this.catalogRepository.upsertModel(nextItem);
      }
    }
  }

  public async start(options: BacktestRunOptions): Promise<void> {
    await this.runScheduledTick(options.snapshotProvider);
    const timer = setInterval(() => {
      void this.runScheduledTick(options.snapshotProvider);
    }, CONFIG.MODEL_BACKTEST_INTERVAL_MS);
    this.timer = timer;
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * @section static:methods
   */

  // empty
}

export type { BacktestRunOptions };
