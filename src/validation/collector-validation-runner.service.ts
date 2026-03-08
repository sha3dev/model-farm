/**
 * @section imports:externals
 */

import type { AssetSymbol, MarketRecord, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import { BacktestEvaluatorService } from "../backtest/backtest-evaluator.service.ts";
import { ScoreCalculatorService } from "../backtest/score-calculator.service.ts";
import CONFIG from "../config.ts";
import { ClickCollectorGateway } from "../data-source/click-collector.gateway.ts";
import { ModelConfigResolverService } from "../model/model-config-resolver.service.ts";
import { ModelArtifactRepository } from "../model-catalog/model-artifact.repository.ts";
import { ModelCatalogRepository } from "../model-catalog/model-catalog.repository.ts";
import { ModelMetadataRepository } from "../model-catalog/model-metadata.repository.ts";
import { MarketWindowCoverageService } from "../shared/market-window-coverage.service.ts";
import { ModelTrainerService } from "../training/model-trainer.service.ts";
import { TensorflowSequenceDatasetService } from "../training/tensorflow-sequence-dataset.service.ts";
import { TensorflowRuntimeService } from "../training/tensorflow-runtime.service.ts";
import { CollectorValidationFeatureAnalyzerService } from "./collector-validation-feature-analyzer.service.ts";
import { CollectorValidationMarketSelectorService } from "./collector-validation-market-selector.service.ts";
import { CollectorValidationReportRepository } from "./collector-validation-report.repository.ts";
import { CollectorValidationSnapshotAnalyzerService } from "./collector-validation-snapshot-analyzer.service.ts";
import type {
  CollectorValidationRunOptions,
  CollectorValidationRunResult,
  ProcessedMarketReport,
  RejectedMarketReport,
  SelectedMarket,
  TrainingExecutionResult,
  ValidationStatus,
  WindowValidationReport
} from "./collector-validation.types.ts";

/**
 * @section consts
 */

const syntheticBacktestMode = "synthetic_v1";

/**
 * @section types
 */

type CollectorValidationRunnerServiceOptions = {
  gateway: ClickCollectorGateway;
  marketSelectorService: CollectorValidationMarketSelectorService;
  snapshotAnalyzerService: CollectorValidationSnapshotAnalyzerService;
  featureAnalyzerService: CollectorValidationFeatureAnalyzerService;
  reportRepository: CollectorValidationReportRepository;
  coverageService: MarketWindowCoverageService;
  trainerService: ModelTrainerService;
  artifactRepository: ModelArtifactRepository;
  metadataRepository: ModelMetadataRepository;
  catalogRepository: ModelCatalogRepository;
  backtestEvaluatorService: BacktestEvaluatorService;
  scoreCalculatorService: ScoreCalculatorService;
  modelConfigResolverService?: ModelConfigResolverService;
  tensorflowSequenceDatasetService?: TensorflowSequenceDatasetService;
  tensorflowRuntimeService?: TensorflowRuntimeService;
  marketTimeoutMs?: number;
};

type ProcessSelectedMarketOptions = { selectedMarket: SelectedMarket; runTs: number };

type ProbabilitySummary = { min: number | null; max: number | null; mean: number | null };

export class CollectorValidationRunnerService {
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
  private readonly marketSelectorService: CollectorValidationMarketSelectorService;
  private readonly snapshotAnalyzerService: CollectorValidationSnapshotAnalyzerService;
  private readonly featureAnalyzerService: CollectorValidationFeatureAnalyzerService;
  private readonly reportRepository: CollectorValidationReportRepository;
  private readonly coverageService: MarketWindowCoverageService;
  private readonly trainerService: ModelTrainerService;
  private readonly artifactRepository: ModelArtifactRepository;
  private readonly metadataRepository: ModelMetadataRepository;
  private readonly catalogRepository: ModelCatalogRepository;
  private readonly backtestEvaluatorService: BacktestEvaluatorService;
  private readonly scoreCalculatorService: ScoreCalculatorService;
  private readonly modelConfigResolverService: ModelConfigResolverService;
  private readonly tensorflowSequenceDatasetService: TensorflowSequenceDatasetService;
  private readonly tensorflowRuntimeService: TensorflowRuntimeService;
  private readonly marketTimeoutMs: number;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: CollectorValidationRunnerServiceOptions) {
    this.gateway = options.gateway;
    this.marketSelectorService = options.marketSelectorService;
    this.snapshotAnalyzerService = options.snapshotAnalyzerService;
    this.featureAnalyzerService = options.featureAnalyzerService;
    this.reportRepository = options.reportRepository;
    this.coverageService = options.coverageService;
    this.trainerService = options.trainerService;
    this.artifactRepository = options.artifactRepository;
    this.metadataRepository = options.metadataRepository;
    this.catalogRepository = options.catalogRepository;
    this.backtestEvaluatorService = options.backtestEvaluatorService;
    this.scoreCalculatorService = options.scoreCalculatorService;
    this.modelConfigResolverService = options.modelConfigResolverService ?? ModelConfigResolverService.create();
    this.tensorflowSequenceDatasetService = options.tensorflowSequenceDatasetService ?? TensorflowSequenceDatasetService.create();
    this.tensorflowRuntimeService = options.tensorflowRuntimeService ?? TensorflowRuntimeService.create();
    this.marketTimeoutMs = options.marketTimeoutMs ?? CONFIG.VALIDATION_MARKET_TIMEOUT_MS;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static async createDefault(): Promise<CollectorValidationRunnerService> {
    const gateway = await ClickCollectorGateway.createFromConfig();
    const artifactRepository = ModelArtifactRepository.createDefault();
    const metadataRepository = ModelMetadataRepository.create();
    const catalogRepository = ModelCatalogRepository.createDefault();
    const service = new CollectorValidationRunnerService({
      gateway,
      marketSelectorService: CollectorValidationMarketSelectorService.create({ gateway }),
      snapshotAnalyzerService: CollectorValidationSnapshotAnalyzerService.create(),
      featureAnalyzerService: CollectorValidationFeatureAnalyzerService.create(),
      reportRepository: CollectorValidationReportRepository.createDefault(),
      coverageService: MarketWindowCoverageService.create({ minimumCoverageRatio: CONFIG.MIN_MARKET_WINDOW_COVERAGE_RATIO }),
      trainerService: ModelTrainerService.createDefault(),
      artifactRepository,
      metadataRepository,
      catalogRepository,
      backtestEvaluatorService: BacktestEvaluatorService.create(),
      scoreCalculatorService: ScoreCalculatorService.create(),
      modelConfigResolverService: ModelConfigResolverService.create(),
      tensorflowSequenceDatasetService: TensorflowSequenceDatasetService.create(),
      tensorflowRuntimeService: TensorflowRuntimeService.create(),
      marketTimeoutMs: CONFIG.VALIDATION_MARKET_TIMEOUT_MS
    });
    return service;
  }

  public static create(options: CollectorValidationRunnerServiceOptions): CollectorValidationRunnerService {
    const service = new CollectorValidationRunnerService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private async runWithTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Validation timed out after ${this.marketTimeoutMs}ms while ${label}`));
      }, this.marketTimeoutMs);
    });
    const result = await Promise.race([promise, timeoutPromise]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    return result;
  }

  private createDefaultOptions(): CollectorValidationRunOptions {
    const defaultOptions: CollectorValidationRunOptions = {
      asset: "btc",
      windows: ["5m", "15m"],
      marketLimitPerWindow: CONFIG.VALIDATION_DEFAULT_MARKET_LIMIT,
      reportLabel: "collector-validation",
      reportDirectoryPath: CONFIG.VALIDATION_REPORTS_ROOT_PATH
    };
    return defaultOptions;
  }

  private mergeOptions(options: Partial<CollectorValidationRunOptions>): CollectorValidationRunOptions {
    const defaultOptions = this.createDefaultOptions();
    const mergedOptions: CollectorValidationRunOptions = {
      asset: options.asset ?? defaultOptions.asset,
      windows: options.windows ?? defaultOptions.windows,
      marketLimitPerWindow: options.marketLimitPerWindow ?? defaultOptions.marketLimitPerWindow,
      reportLabel: options.reportLabel ?? defaultOptions.reportLabel,
      ...((options.reportDirectoryPath ?? defaultOptions.reportDirectoryPath)
        ? { reportDirectoryPath: options.reportDirectoryPath ?? defaultOptions.reportDirectoryPath }
        : {})
    };
    return mergedOptions;
  }

  private buildModelId(asset: AssetSymbol, window: MarketWindow): string {
    const modelId = `validation-${asset}-${window}`;
    return modelId;
  }

  private sortSnapshots(snapshots: readonly MarketSnapshot[]): readonly MarketSnapshot[] {
    const sortedSnapshots = [...snapshots].sort((leftSnapshot, rightSnapshot) => leftSnapshot.snapshotTs - rightSnapshot.snapshotTs);
    return sortedSnapshots;
  }

  private filterSnapshotsToMarketWindow(market: MarketRecord, snapshots: readonly MarketSnapshot[]): readonly MarketSnapshot[] {
    const filteredSnapshots = snapshots.filter((snapshot) => snapshot.snapshotTs >= market.marketStartTs && snapshot.snapshotTs <= market.marketEndTs);
    return filteredSnapshots;
  }

  private determineStatus(failureCount: number, warningCount: number): ValidationStatus {
    let status: ValidationStatus = "pass";
    if (failureCount > 0) {
      status = "fail";
    } else if (warningCount > 0) {
      status = "warning";
    }
    return status;
  }

  private buildRejectedMarketReport(
    market: MarketRecord,
    snapshots: readonly MarketSnapshot[],
    failures: readonly string[],
    warnings: readonly string[]
  ): RejectedMarketReport {
    const rejectedMarketReport: RejectedMarketReport = {
      slug: market.slug,
      asset: market.asset,
      window: market.window,
      reason: failures[0] ?? "Unknown validation failure",
      snapshotCount: snapshots.length,
      failures,
      warnings
    };
    return rejectedMarketReport;
  }

  private buildProbabilitySummary(probabilities: readonly number[]): ProbabilitySummary {
    const probabilitySummary: ProbabilitySummary = {
      min: probabilities.length > 0 ? Math.min(...probabilities) : null,
      max: probabilities.length > 0 ? Math.max(...probabilities) : null,
      mean: probabilities.length > 0 ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length : null
    };
    return probabilitySummary;
  }

  private buildClassDistribution(probabilitySummaryRows: readonly number[]): { upCount: number; downCount: number } {
    const upCount = probabilitySummaryRows.filter((probability) => probability >= 0.5).length;
    const downCount = probabilitySummaryRows.length - upCount;
    const classDistribution = { upCount, downCount };
    return classDistribution;
  }

  private async buildProbabilitiesFromArtifact(selectedMarket: SelectedMarket, artifactPath: string): Promise<readonly number[]> {
    const artifactState = this.artifactRepository.readArtifactState(artifactPath);
    const modelConfig = this.modelConfigResolverService.resolveByWindow(selectedMarket.market.window);
    const evaluationDataset = this.tensorflowSequenceDatasetService.buildEvaluationDataset({
      snapshots: selectedMarket.snapshots,
      market: { priceToBeat: selectedMarket.market.priceToBeat, finalPrice: selectedMarket.market.finalPrice },
      modelConfig,
      artifactState
    });
    const model = await this.tensorflowRuntimeService.loadModel(artifactPath);
    const probabilities = await this.tensorflowRuntimeService.predictProbabilities(model, evaluationDataset.inputs);
    model.dispose();
    return probabilities;
  }

  private async executeTraining(selectedMarket: SelectedMarket, runTs: number): Promise<TrainingExecutionResult> {
    const modelId = this.buildModelId(selectedMarket.market.asset, selectedMarket.market.window);
    const modelVersion = String(runTs);
    const trainingResult = await this.trainerService.train({
      modelId,
      modelVersion,
      asset: selectedMarket.market.asset,
      window: selectedMarket.market.window,
      snapshots: selectedMarket.snapshots,
      market: { priceToBeat: selectedMarket.market.priceToBeat, finalPrice: selectedMarket.market.finalPrice },
      previousMetadata: null
    });
    const metadataPath = this.metadataRepository.buildMetadataPath(trainingResult.metadata.artifactPath);
    const backtestResult = await this.backtestEvaluatorService.evaluate({
      asset: selectedMarket.market.asset,
      window: selectedMarket.market.window,
      snapshots: selectedMarket.snapshots,
      market: { priceToBeat: selectedMarket.market.priceToBeat, finalPrice: selectedMarket.market.finalPrice },
      artifactPath: trainingResult.metadata.artifactPath
    });
    const score = this.scoreCalculatorService.calculateScore({
      backtestStats: backtestResult.stats,
      trainedAtTs: trainingResult.metadata.lastTrainingTs,
      stabilityFactor: backtestResult.stabilityFactor,
      overfitPenalty: 0
    });
    const nextMetadata = { ...trainingResult.metadata, latestBacktest: backtestResult.stats, score };
    this.metadataRepository.writeMetadata(metadataPath, nextMetadata);
    this.catalogRepository.upsertModel({
      modelId,
      modelVersion,
      asset: selectedMarket.market.asset,
      window: selectedMarket.market.window,
      score,
      status: nextMetadata.status,
      artifactPath: nextMetadata.artifactPath,
      metadataPath,
      trainingStats: {
        trainedWindowCount: nextMetadata.trainedWindowCount,
        lastTrainedWindowStartTs: nextMetadata.lastTrainedWindowStartTs,
        lastTrainedWindowEndTs: nextMetadata.lastTrainedWindowEndTs,
        lastTrainingTs: nextMetadata.lastTrainingTs
      },
      backtestStats: nextMetadata.latestBacktest,
      minimumSnapshotCount: nextMetadata.minimumSnapshotCount
    });
    const probabilities = await this.buildProbabilitiesFromArtifact(selectedMarket, nextMetadata.artifactPath);
    const trainingExecutionResult: TrainingExecutionResult = {
      modelId,
      modelVersion,
      artifactPath: nextMetadata.artifactPath,
      metadataPath,
      backtestMode: syntheticBacktestMode,
      backtestStats: nextMetadata.latestBacktest,
      score,
      predictionProbabilitySummary: this.buildProbabilitySummary(probabilities),
      classDistribution: this.buildClassDistribution(probabilities),
      targetDeltaSign:
        (selectedMarket.market.finalPrice ?? 0) - (selectedMarket.market.priceToBeat ?? 0) > 0
          ? "up"
          : (selectedMarket.market.finalPrice ?? 0) - (selectedMarket.market.priceToBeat ?? 0) < 0
            ? "down"
            : "flat",
      validFeatureRowCount: probabilities.length
    };
    return trainingExecutionResult;
  }

  private async processSelectedMarket(options: ProcessSelectedMarketOptions): Promise<ProcessedMarketReport | RejectedMarketReport> {
    const snapshotAnalysis = this.snapshotAnalyzerService.analyze(options.selectedMarket.snapshots);
    const featureAnalysis = this.featureAnalyzerService.analyze({
      snapshots: options.selectedMarket.snapshots,
      market: options.selectedMarket.market,
      randomSampleCount: CONFIG.VALIDATION_RANDOM_SAMPLE_COUNT
    });
    const coverageFailure = this.coverageService.isCoverageSufficient(options.selectedMarket.market, options.selectedMarket.snapshots)
      ? []
      : [this.coverageService.buildCoverageFailureMessage(options.selectedMarket.market, options.selectedMarket.snapshots)];
    const failures = [...snapshotAnalysis.failures, ...coverageFailure, ...featureAnalysis.failures];
    const warnings = [...snapshotAnalysis.warnings, ...featureAnalysis.warnings];
    let report: ProcessedMarketReport | RejectedMarketReport;
    if (failures.length > 0) {
      report = this.buildRejectedMarketReport(options.selectedMarket.market, options.selectedMarket.snapshots, failures, warnings);
    } else {
      const trainingExecution = await this.executeTraining(options.selectedMarket, options.runTs);
      const status = this.determineStatus(failures.length, warnings.length);
      const processedMarketReport: ProcessedMarketReport = {
        slug: options.selectedMarket.market.slug,
        asset: options.selectedMarket.market.asset,
        window: options.selectedMarket.market.window,
        marketStartTs: options.selectedMarket.market.marketStartTs,
        marketEndTs: options.selectedMarket.market.marketEndTs,
        priceToBeat: options.selectedMarket.market.priceToBeat,
        finalPrice: options.selectedMarket.market.finalPrice,
        snapshotAnalysis,
        featureAnalysis,
        trainingExecution,
        status,
        failures,
        warnings
      };
      report = processedMarketReport;
    }
    return report;
  }

  private buildConsoleSummary(
    windowReports: readonly WindowValidationReport[],
    result: Omit<CollectorValidationRunResult, "summaryFilePath" | "consoleSummaryFilePath">
  ): string {
    const summaryLines = [
      `Collector validation finished for ${result.asset}`,
      `collectorHost=${result.collectorHost}`,
      `windows=${result.windows.join(",")}`,
      `processedMarkets=${result.processedMarketCount}`,
      `rejectedMarkets=${result.rejectedMarketCount}`,
      `trainingExecutions=${result.trainingExecutionCount}`,
      `backtestExecutions=${result.backtestExecutionCount}`,
      `warnings=${result.warnings.length}`,
      `failures=${result.failures.length}`,
      ...windowReports.map(
        (report) => `${report.window}: processed=${report.processedMarkets.length}, rejected=${report.rejectedMarkets.length}, status=${report.status}`
      )
    ];
    const consoleSummary = `${summaryLines.join("\n")}\n`;
    return consoleSummary;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async runOnce(options: Partial<CollectorValidationRunOptions> = {}): Promise<CollectorValidationRunResult> {
    const mergedOptions = this.mergeOptions(options);
    const runTs = Date.now();
    const reportRootPath = this.reportRepository.buildReportRootPath(mergedOptions.reportLabel, runTs, mergedOptions.reportDirectoryPath);
    const windowReports: WindowValidationReport[] = [];
    console.log(`[validation] starting run ${runTs} for ${mergedOptions.asset} windows=${mergedOptions.windows.join(",")}`);
    for (const window of mergedOptions.windows) {
      const markets = await this.marketSelectorService.selectMarkets({
        asset: mergedOptions.asset,
        window,
        limit: mergedOptions.marketLimitPerWindow,
        nowTs: runTs
      });
      const processedMarkets: ProcessedMarketReport[] = [];
      const rejectedMarkets: RejectedMarketReport[] = [];
      for (const market of markets) {
        console.log(`[validation] processing market ${market.slug} (${market.asset}/${market.window})`);
        console.log(`[validation] fetching snapshots for ${market.slug}`);
        const rawSnapshots = this.sortSnapshots(
          await this.runWithTimeout(this.gateway.getWindowSnapshotsBySlug(market.slug), `fetching snapshots for ${market.slug}`)
        );
        const snapshots = this.filterSnapshotsToMarketWindow(market, rawSnapshots);
        console.log(`[validation] fetched ${rawSnapshots.length} snapshots for ${market.slug}, using ${snapshots.length} inside market window`);
        const selectedMarket: SelectedMarket = { market, snapshots };
        const marketReport = await this.runWithTimeout(this.processSelectedMarket({ selectedMarket, runTs }), `processing market ${market.slug}`);
        if ("trainingExecution" in marketReport) {
          processedMarkets.push(marketReport);
          console.log(`[validation] trained ${market.slug} snapshots=${snapshots.length} validRows=${marketReport.featureAnalysis.validRowCount}`);
        } else {
          rejectedMarkets.push(marketReport);
          console.log(`[validation] rejected ${market.slug}: ${marketReport.reason}`);
        }
      }
      const warningCount =
        processedMarkets.reduce((sum, report) => sum + report.warnings.length, 0) + rejectedMarkets.reduce((sum, report) => sum + report.warnings.length, 0);
      const failureCount =
        processedMarkets.reduce((sum, report) => sum + report.failures.length, 0) + rejectedMarkets.reduce((sum, report) => sum + report.failures.length, 0);
      const status = this.determineStatus(failureCount, warningCount);
      const windowReport: WindowValidationReport = {
        asset: mergedOptions.asset,
        window,
        processedMarkets,
        rejectedMarkets,
        status,
        warningCount,
        failureCount
      };
      windowReports.push(windowReport);
      this.reportRepository.writeWindowReport({ reportRootPath, asset: mergedOptions.asset, window, report: windowReport });
    }
    const processedMarketCount = windowReports.reduce((sum, report) => sum + report.processedMarkets.length, 0);
    const rejectedMarketCount = windowReports.reduce((sum, report) => sum + report.rejectedMarkets.length, 0);
    const trainingExecutionCount = windowReports.reduce(
      (sum, report) => sum + report.processedMarkets.filter((market) => market.trainingExecution !== null).length,
      0
    );
    const backtestExecutionCount = trainingExecutionCount;
    const warnings = windowReports.flatMap((report) => {
      const windowWarnings = [
        ...report.processedMarkets.flatMap((market) => market.warnings.map((warning) => `${report.window}/${market.slug}: ${warning}`)),
        ...report.rejectedMarkets.flatMap((market) => market.warnings.map((warning) => `${report.window}/${market.slug}: ${warning}`))
      ];
      return windowWarnings;
    });
    const failures = windowReports.flatMap((report) => {
      const windowFailures = [
        ...report.processedMarkets.flatMap((market) => market.failures.map((failure) => `${report.window}/${market.slug}: ${failure}`)),
        ...report.rejectedMarkets.flatMap((market) => market.failures.map((failure) => `${report.window}/${market.slug}: ${failure}`))
      ];
      return windowFailures;
    });
    const windowReportFilePaths = windowReports.map((report) => `${reportRootPath}/window-${report.asset}-${report.window}.json`);
    const partialResult = {
      runTs,
      asset: mergedOptions.asset,
      windows: mergedOptions.windows,
      collectorHost: CONFIG.CLICK_COLLECTOR_HOST,
      reportRootPath,
      windowReportFilePaths,
      processedMarketCount,
      rejectedMarketCount,
      trainingExecutionCount,
      backtestExecutionCount,
      warnings,
      failures
    };
    const consoleSummary = this.buildConsoleSummary(windowReports, partialResult);
    const summaryPaths = this.reportRepository.writeSummary({
      reportRootPath,
      result: { ...partialResult, summaryFilePath: "", consoleSummaryFilePath: "" },
      consoleSummary
    });
    const result: CollectorValidationRunResult = {
      ...partialResult,
      summaryFilePath: summaryPaths.summaryFilePath,
      consoleSummaryFilePath: summaryPaths.consoleSummaryFilePath
    };
    this.reportRepository.writeSummary({ reportRootPath, result, consoleSummary });
    console.log(`[validation] completed run ${runTs} reports=${reportRootPath}`);
    return result;
  }

  /**
   * @section static:methods
   */

  // empty
}
