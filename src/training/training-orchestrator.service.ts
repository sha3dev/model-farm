/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { BacktestEvaluatorService } from "../backtest/backtest-evaluator.service.ts";
import { ScoreCalculatorService } from "../backtest/score-calculator.service.ts";
import CONFIG from "../config.ts";
import { ModelCatalogRepository } from "../model-catalog/model-catalog.repository.ts";
import { ModelMetadataRepository } from "../model-catalog/model-metadata.repository.ts";
import type { BacktestStats, ModelWindowDataset } from "../model-catalog/model-catalog.types.ts";
import { MarketWindowCoverageService } from "../shared/market-window-coverage.service.ts";
import { RuntimeLogFormatterService } from "../shared/runtime-log-formatter.service.ts";
import { ModelTrainerService } from "./model-trainer.service.ts";
import { TrainingWindowRegistryRepository } from "./training-window-registry.repository.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

import type { AssetSymbol, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

type TrainingJob = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  trainingWindows: readonly ModelWindowDataset[];
  backtestWindows: readonly ModelWindowDataset[];
};

type TrainingOrchestratorServiceOptions = {
  trainerService: ModelTrainerService;
  backtestEvaluatorService: BacktestEvaluatorService;
  scoreCalculatorService: ScoreCalculatorService;
  catalogRepository: ModelCatalogRepository;
  metadataRepository: ModelMetadataRepository;
  coverageService: MarketWindowCoverageService;
  trainingWindowRegistryRepository: TrainingWindowRegistryRepository;
  runtimeLogFormatterService?: RuntimeLogFormatterService;
};

type StartOptions = { jobProvider: () => Promise<readonly TrainingJob[]> };

export class TrainingOrchestratorService {
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

  private readonly trainerService: ModelTrainerService;
  private readonly backtestEvaluatorService: BacktestEvaluatorService;
  private readonly scoreCalculatorService: ScoreCalculatorService;
  private readonly catalogRepository: ModelCatalogRepository;
  private readonly metadataRepository: ModelMetadataRepository;
  private readonly coverageService: MarketWindowCoverageService;
  private readonly trainingWindowRegistryRepository: TrainingWindowRegistryRepository;
  private readonly runtimeLogFormatterService: RuntimeLogFormatterService;
  private timer: NodeJS.Timeout | null;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: TrainingOrchestratorServiceOptions) {
    this.trainerService = options.trainerService;
    this.backtestEvaluatorService = options.backtestEvaluatorService;
    this.scoreCalculatorService = options.scoreCalculatorService;
    this.catalogRepository = options.catalogRepository;
    this.metadataRepository = options.metadataRepository;
    this.coverageService = options.coverageService;
    this.trainingWindowRegistryRepository = options.trainingWindowRegistryRepository;
    this.runtimeLogFormatterService = options.runtimeLogFormatterService ?? RuntimeLogFormatterService.create();
    this.timer = null;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): TrainingOrchestratorService {
    const trainingOrchestratorService = new TrainingOrchestratorService({
      trainerService: ModelTrainerService.createDefault(),
      backtestEvaluatorService: BacktestEvaluatorService.create(),
      scoreCalculatorService: ScoreCalculatorService.create(),
      catalogRepository: ModelCatalogRepository.createDefault(),
      metadataRepository: ModelMetadataRepository.create(),
      coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: CONFIG.MIN_MARKET_WINDOW_COVERAGE_RATIO }),
      trainingWindowRegistryRepository: TrainingWindowRegistryRepository.createDefault(),
      runtimeLogFormatterService: RuntimeLogFormatterService.create()
    });
    return trainingOrchestratorService;
  }

  public static create(options: TrainingOrchestratorServiceOptions): TrainingOrchestratorService {
    const trainingOrchestratorService = new TrainingOrchestratorService(options);
    return trainingOrchestratorService;
  }

  /**
   * @section private:methods
   */

  private updateCatalogFromMetadata(metadataPath: string): void {
    const metadata = this.metadataRepository.readMetadata(metadataPath);
    const catalogItem = {
      modelId: metadata.modelId,
      modelVersion: metadata.modelVersion,
      asset: metadata.asset,
      window: metadata.window,
      score: metadata.score,
      status: metadata.status,
      artifactPath: metadata.artifactPath,
      metadataPath,
      trainingStats: {
        trainedWindowCount: metadata.trainedWindowCount,
        lastTrainedWindowStartTs: metadata.lastTrainedWindowStartTs,
        lastTrainedWindowEndTs: metadata.lastTrainedWindowEndTs,
        lastTrainingTs: metadata.lastTrainingTs
      },
      backtestStats: metadata.latestBacktest,
      minimumSnapshotCount: metadata.minimumSnapshotCount
    };
    this.catalogRepository.upsertModel(catalogItem);
  }

  private async runScheduledTick(jobProvider: () => Promise<readonly TrainingJob[]>): Promise<void> {
    const jobs = await jobProvider();
    await this.runOnce(jobs);
  }

  private hasSufficientCoverage(snapshots: readonly MarketSnapshot[]): boolean {
    const coverageMarket = snapshots[0] ? { marketStartTs: snapshots[0].marketStartTs, marketEndTs: snapshots[0].marketEndTs } : null;
    const hasSufficientCoverage = coverageMarket !== null && this.coverageService.isCoverageSufficient(coverageMarket, snapshots);
    return hasSufficientCoverage;
  }

  private normalizeWindow(windowDataset: ModelWindowDataset): ModelWindowDataset {
    const normalizedWindow: ModelWindowDataset = { ...windowDataset, snapshots: this.coverageService.normalizeSnapshotsToWindow(windowDataset.snapshots) };
    return normalizedWindow;
  }

  private persistTrainingOutputs(metadataPath: string, job: TrainingJob): void {
    this.updateCatalogFromMetadata(metadataPath);
    for (const trainingWindow of job.trainingWindows) {
      this.trainingWindowRegistryRepository.markWindowConsumed({
        modelId: job.modelId,
        modelVersion: job.modelVersion,
        asset: job.asset,
        window: job.window,
        marketSlug: trainingWindow.marketSlug,
        marketStartTs: trainingWindow.marketStartTs,
        marketEndTs: trainingWindow.marketEndTs
      });
    }
  }

  private logBacktestSummary(job: TrainingJob, score: number, latestBacktest: BacktestStats): void {
    const backtestSummary = this.runtimeLogFormatterService.formatBacktestSummary(job.asset, job.window, job.modelId, latestBacktest, score);
    console.log(backtestSummary);
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async runOnce(jobs: readonly TrainingJob[]): Promise<void> {
    for (const job of jobs) {
      const normalizedTrainingWindows = job.trainingWindows.map((windowDataset) => this.normalizeWindow(windowDataset));
      const normalizedBacktestWindows = job.backtestWindows.map((windowDataset) => this.normalizeWindow(windowDataset));
      const hasSufficientTrainingCoverage = normalizedTrainingWindows.every((windowDataset) => this.hasSufficientCoverage(windowDataset.snapshots));
      const hasSufficientBacktestCoverage = normalizedBacktestWindows.every((windowDataset) => this.hasSufficientCoverage(windowDataset.snapshots));
      const trainingSnapshotCount = normalizedTrainingWindows.reduce((sum, windowDataset) => sum + windowDataset.snapshots.length, 0);
      if (hasSufficientTrainingCoverage && hasSufficientBacktestCoverage) {
        const jobStartedAtTs = Date.now();
        console.log(
          `[training] start model=${job.modelId} version=${job.modelVersion} trainingWindows=${normalizedTrainingWindows.length} backtestWindows=${normalizedBacktestWindows.length} snapshots=${trainingSnapshotCount}`
        );
        const trainerStartedAtTs = Date.now();
        const trainingResult = await this.trainerService.train({
          modelId: job.modelId,
          modelVersion: job.modelVersion,
          asset: job.asset,
          window: job.window,
          windows: normalizedTrainingWindows,
          previousMetadata: null
        });
        const trainerDurationMs = Date.now() - trainerStartedAtTs;
        const backtestStartedAtTs = Date.now();
        const backtestResult = await this.backtestEvaluatorService.evaluate({
          asset: job.asset,
          window: job.window,
          windows: normalizedBacktestWindows,
          artifactPath: trainingResult.metadata.artifactPath
        });
        const backtestDurationMs = Date.now() - backtestStartedAtTs;
        const scoreStartedAtTs = Date.now();
        const score = this.scoreCalculatorService.calculateScore({
          backtestStats: backtestResult.stats,
          trainedAtTs: trainingResult.metadata.lastTrainingTs,
          stabilityFactor: backtestResult.stabilityFactor,
          overfitPenalty: 0
        });
        const scoreDurationMs = Date.now() - scoreStartedAtTs;
        const metadata = { ...trainingResult.metadata, latestBacktest: backtestResult.stats, score };
        const metadataPath = this.metadataRepository.buildMetadataPath(metadata.artifactPath);
        const persistStartedAtTs = Date.now();
        this.metadataRepository.writeMetadata(metadataPath, metadata);
        this.persistTrainingOutputs(metadataPath, job);
        const persistDurationMs = Date.now() - persistStartedAtTs;
        const totalDurationMs = Date.now() - jobStartedAtTs;
        console.log(
          `[training] finish model=${job.modelId} version=${job.modelVersion} trainingWindows=${normalizedTrainingWindows.length} backtestWindows=${normalizedBacktestWindows.length} trainerMs=${trainerDurationMs} backtestMs=${backtestDurationMs} scoreMs=${scoreDurationMs} persistMs=${persistDurationMs} totalMs=${totalDurationMs}`
        );
        this.logBacktestSummary(job, score, metadata.latestBacktest);
      }
    }
  }

  public async start(options: StartOptions): Promise<void> {
    await this.runScheduledTick(options.jobProvider);
    const timer = setInterval(() => {
      void this.runScheduledTick(options.jobProvider);
    }, CONFIG.MODEL_TRAINING_INTERVAL_MS);
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

export type { StartOptions as TrainingStartOptions, TrainingJob };
