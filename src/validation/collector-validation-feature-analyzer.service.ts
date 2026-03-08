/**
 * @section imports:externals
 */

import type { MarketRecord, MarketSnapshot } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import { buildFeatures, featureOrder, featureSpecVersion, spotFeatureOrder } from "../dataset/feature-target-builder.ts";
import type {
  CoherenceAnalysisResult,
  CorrelationStats,
  FeatureAnalysisResult,
  FeatureSampleRecord,
  FeatureValueStats,
  ValidationCryptoSourceName
} from "./collector-validation.types.ts";

/**
 * @section consts
 */

const highNullRatioWarningThreshold = 0.6;
const highAbsoluteFeatureValueWarningThreshold = 1_000_000;
const directionalAgreementWarningThreshold = 0.55;
const pmComplementDeviationWarningThreshold = 0.08;
const correlationNearZeroThreshold = 0.05;
const sourceNames: readonly ValidationCryptoSourceName[] = ["binance", "coinbase", "kraken", "okx", "chainlink"];
const sourceLabels: Record<ValidationCryptoSourceName, string> = {
  binance: "Binance",
  coinbase: "Coinbase",
  kraken: "Kraken",
  okx: "Okx",
  chainlink: "Chainlink"
};

/**
 * @section types
 */

type AnalyzeOptions = { snapshots: readonly MarketSnapshot[]; market: MarketRecord; randomSampleCount: number };
type ValidFeatureRow = { rowIndex: number; snapshot: MarketSnapshot; featureRow: readonly number[] };

type CoherenceSeriesPoint = { distanceToStrike: number; pmUpMid: number; timeToExpirySeconds: number; pmProbUpDelta5s: number; return5s: number };

export class CollectorValidationFeatureAnalyzerService {
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

  // empty

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  // empty

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): CollectorValidationFeatureAnalyzerService {
    const service = new CollectorValidationFeatureAnalyzerService();
    return service;
  }

  /**
   * @section private:methods
   */

  private buildValidRows(snapshots: readonly MarketSnapshot[], featureRows: readonly (readonly number[] | null)[]): readonly ValidFeatureRow[] {
    const validRows = featureRows.flatMap((featureRow, rowIndex) => {
      const snapshot = snapshots[rowIndex] ?? null;
      const validRow = featureRow !== null && snapshot !== null ? [{ rowIndex, snapshot, featureRow }] : [];
      return validRow;
    });
    return validRows;
  }

  private getFeatureIndex(featureName: string): number {
    const featureIndex = featureOrder.indexOf(featureName);
    if (featureIndex < 0) {
      throw new Error(`Validation analyzer could not find feature index for ${featureName}`);
    }
    return featureIndex;
  }

  private createFeatureMap(featureRow: readonly number[]): Record<string, number> {
    const featureEntries = featureOrder.map((featureName, featureIndex) => {
      const featureValue = featureRow[featureIndex];
      const featureEntry: [string, number] = [featureName, featureValue ?? 0];
      return featureEntry;
    });
    const featureMap = Object.fromEntries(featureEntries);
    return featureMap;
  }

  private buildFeatureValueStats(validRows: readonly ValidFeatureRow[]): Record<string, FeatureValueStats> {
    const featureStatsEntries = featureOrder.map((featureName, featureIndex) => {
      const values = validRows.map((validRow) => validRow.featureRow[featureIndex] ?? Number.NaN);
      const finiteValues = values.filter((value) => Number.isFinite(value));
      const min = finiteValues.length > 0 ? Math.min(...finiteValues) : null;
      const max = finiteValues.length > 0 ? Math.max(...finiteValues) : null;
      const mean = finiteValues.length > 0 ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : null;
      const uniqueValues = new Set(finiteValues.map((value) => value.toFixed(12)));
      const hasNonFiniteValue = values.some((value) => !Number.isFinite(value));
      const maxAbsValue = finiteValues.length > 0 ? Math.max(...finiteValues.map((value) => Math.abs(value))) : null;
      const featureValueStats: FeatureValueStats = { min, max, mean, isConstant: uniqueValues.size <= 1, hasNonFiniteValue, maxAbsValue };
      const featureStatsEntry: [string, FeatureValueStats] = [featureName, featureValueStats];
      return featureStatsEntry;
    });
    const featureStatsByName = Object.fromEntries(featureStatsEntries) as Record<string, FeatureValueStats>;
    return featureStatsByName;
  }

  private buildSampleIndexes(validRows: readonly ValidFeatureRow[], randomSampleCount: number): readonly number[] {
    const sampleCount = Math.min(randomSampleCount, validRows.length);
    const selectedIndexes: number[] = [];
    if (sampleCount > 0) {
      const step = validRows.length / sampleCount;
      for (let index = 0; index < sampleCount; index += 1) {
        const selectedIndex = Math.min(validRows.length - 1, Math.floor(index * step));
        selectedIndexes.push(selectedIndex);
      }
    }
    const deduplicatedIndexes = [...new Set(selectedIndexes)];
    return deduplicatedIndexes;
  }

  private resolveWindowProgressApprox(snapshot: MarketSnapshot): number {
    const totalWindowMs = Math.max(1, snapshot.marketEndTs - snapshot.marketStartTs);
    const elapsedWindowMs = Math.max(0, snapshot.snapshotTs - snapshot.marketStartTs);
    const windowProgressApprox = Math.min(1, Math.max(0, elapsedWindowMs / totalWindowMs));
    return windowProgressApprox;
  }

  private buildSamples(validRows: readonly ValidFeatureRow[], market: MarketRecord, randomSampleCount: number): readonly FeatureSampleRecord[] {
    const sampleIndexes = this.buildSampleIndexes(validRows, randomSampleCount);
    const sampleRecords = sampleIndexes.map((selectedIndex) => {
      const validRow = validRows[selectedIndex];
      if (!validRow) {
        throw new Error(`Validation analyzer failed to resolve sample row at index ${selectedIndex}`);
      }
      const featureMap = this.createFeatureMap(validRow.featureRow);
      const distanceToStrikeBySourceEntries = sourceNames.flatMap((sourceName) => {
        const value = featureMap[`distanceToStrike${sourceLabels[sourceName]}`];
        const entry = typeof value === "number" ? [[sourceName, value] as const] : [];
        return entry;
      });
      const return5sBySourceEntries = sourceNames.flatMap((sourceName) => {
        const value = featureMap[`spot${sourceLabels[sourceName]}Return5s`];
        const entry = typeof value === "number" ? [[sourceName, value] as const] : [];
        return entry;
      });
      const return20sBySourceEntries = sourceNames.flatMap((sourceName) => {
        const value = featureMap[`spot${sourceLabels[sourceName]}Return20s`];
        const entry = typeof value === "number" ? [[sourceName, value] as const] : [];
        return entry;
      });
      const sampleRecord: FeatureSampleRecord = {
        snapshotTs: validRow.snapshot.snapshotTs,
        windowProgressApprox: this.resolveWindowProgressApprox(validRow.snapshot),
        priceToBeat: market.priceToBeat,
        finalPrice: market.finalPrice,
        targetDelta: (market.finalPrice ?? 0) - (market.priceToBeat ?? 0),
        featureRow: validRow.featureRow,
        featureMap,
        pmUpMid: featureMap.pmUpMid ?? null,
        pmDownMid: featureMap.pmDownMid ?? null,
        distanceToStrikeBySource: Object.fromEntries(distanceToStrikeBySourceEntries),
        return5sBySource: Object.fromEntries(return5sBySourceEntries),
        return20sBySource: Object.fromEntries(return20sBySourceEntries)
      };
      return sampleRecord;
    });
    return sampleRecords;
  }

  private calculateCorrelation(values: readonly [number, number][]): CorrelationStats {
    const pairCount = values.length;
    let correlation: number | null = null;
    if (pairCount > 1) {
      const leftMean = values.reduce((sum, pair) => sum + pair[0], 0) / pairCount;
      const rightMean = values.reduce((sum, pair) => sum + pair[1], 0) / pairCount;
      const covariance = values.reduce((sum, pair) => sum + (pair[0] - leftMean) * (pair[1] - rightMean), 0);
      const leftVariance = values.reduce((sum, pair) => sum + (pair[0] - leftMean) ** 2, 0);
      const rightVariance = values.reduce((sum, pair) => sum + (pair[1] - rightMean) ** 2, 0);
      const denominator = Math.sqrt(leftVariance * rightVariance);
      if (denominator > 0) {
        correlation = covariance / denominator;
      }
    }
    const correlationStats: CorrelationStats = { correlation, pairCount };
    return correlationStats;
  }

  private buildCoherenceSeriesBySource(validRows: readonly ValidFeatureRow[]): Record<ValidationCryptoSourceName, readonly CoherenceSeriesPoint[]> {
    const seriesEntries = sourceNames.map((sourceName) => {
      const label = sourceLabels[sourceName];
      const series = validRows.flatMap((validRow) => {
        const featureMap = this.createFeatureMap(validRow.featureRow);
        const distanceToStrike = featureMap[`distanceToStrike${label}`];
        const pmUpMid = featureMap.pmUpMid;
        const timeToExpirySeconds = featureMap.timeToExpirySeconds;
        const pmProbUpDelta5s = featureMap.pmProbUpDelta5s;
        const return5s = featureMap[`spot${label}Return5s`];
        const hasValues = [distanceToStrike, pmUpMid, timeToExpirySeconds, pmProbUpDelta5s, return5s].every((value) => typeof value === "number");
        let seriesPoint: readonly CoherenceSeriesPoint[] = [];
        if (hasValues) {
          const coherenceSeriesPoint: CoherenceSeriesPoint = {
            distanceToStrike: distanceToStrike as number,
            pmUpMid: pmUpMid as number,
            timeToExpirySeconds: timeToExpirySeconds as number,
            pmProbUpDelta5s: pmProbUpDelta5s as number,
            return5s: return5s as number
          };
          seriesPoint = [coherenceSeriesPoint];
        }
        return seriesPoint;
      });
      const seriesEntry: [ValidationCryptoSourceName, readonly CoherenceSeriesPoint[]] = [sourceName, series];
      return seriesEntry;
    });
    const seriesBySource = Object.fromEntries(seriesEntries) as Record<ValidationCryptoSourceName, readonly CoherenceSeriesPoint[]>;
    return seriesBySource;
  }

  private buildCoherenceAnalysis(validRows: readonly ValidFeatureRow[]): CoherenceAnalysisResult {
    const warnings: string[] = [];
    const failures: string[] = [];
    const seriesBySource = this.buildCoherenceSeriesBySource(validRows);
    const directionalAgreementRatioBySource: Partial<Record<ValidationCryptoSourceName, number>> = {};
    const probabilityMomentumAgreementBySource: Partial<Record<ValidationCryptoSourceName, number>> = {};
    const probabilityMomentumCorrelationBySource: Partial<Record<ValidationCryptoSourceName, CorrelationStats>> = {};
    const strikeDistanceSensitivityBySource: Partial<Record<ValidationCryptoSourceName, CorrelationStats>> = {};
    for (const sourceName of sourceNames) {
      const series = seriesBySource[sourceName];
      const directionalPairs: number[] = series
        .filter((point) => Math.abs(point.distanceToStrike) > 0)
        .map((point) => {
          const agrees = (point.distanceToStrike > 0 && point.pmUpMid > 0.5) || (point.distanceToStrike < 0 && point.pmUpMid < 0.5);
          return agrees ? 1 : 0;
        });
      const directionalAgreementSum = directionalPairs.reduce((sum, value) => sum + value, 0);
      const directionalAgreementRatio = directionalPairs.length > 0 ? directionalAgreementSum / directionalPairs.length : 0;
      directionalAgreementRatioBySource[sourceName] = directionalAgreementRatio;
      if (directionalPairs.length > 0 && directionalAgreementRatio < directionalAgreementWarningThreshold) {
        warnings.push(`Directional agreement for ${sourceName} is weak: ${directionalAgreementRatio.toFixed(3)}`);
      }
      const momentumPairs: number[] = series
        .filter((point) => Math.abs(point.pmProbUpDelta5s) > 0 || Math.abs(point.return5s) > 0)
        .map((point) => {
          const agrees = Math.sign(point.pmProbUpDelta5s) === Math.sign(point.return5s);
          return agrees ? 1 : 0;
        });
      const momentumAgreementSum = momentumPairs.reduce((sum, value) => sum + value, 0);
      const momentumAgreement = momentumPairs.length > 0 ? momentumAgreementSum / momentumPairs.length : 0;
      probabilityMomentumAgreementBySource[sourceName] = momentumAgreement;
      const momentumCorrelation = this.calculateCorrelation(series.map((point) => [point.pmProbUpDelta5s, point.return5s] as [number, number]));
      probabilityMomentumCorrelationBySource[sourceName] = momentumCorrelation;
      if (momentumCorrelation.correlation !== null && Math.abs(momentumCorrelation.correlation) < correlationNearZeroThreshold) {
        warnings.push(`Probability momentum correlation for ${sourceName} is near zero`);
      }
      const strikeDistanceCorrelation = this.calculateCorrelation(
        series.map((point) => [Math.abs(point.distanceToStrike), Math.abs(point.pmUpMid - 0.5)] as [number, number])
      );
      strikeDistanceSensitivityBySource[sourceName] = strikeDistanceCorrelation;
    }
    const pmComplementDeviations = validRows.map((validRow) => {
      const featureMap = this.createFeatureMap(validRow.featureRow);
      return Math.abs((featureMap.pmUpMid ?? 0) + (featureMap.pmDownMid ?? 0) - 1);
    });
    const pmComplementDeviation = {
      min: pmComplementDeviations.length > 0 ? Math.min(...pmComplementDeviations) : null,
      max: pmComplementDeviations.length > 0 ? Math.max(...pmComplementDeviations) : null,
      meanAbsDeviation: pmComplementDeviations.length > 0 ? pmComplementDeviations.reduce((sum, value) => sum + value, 0) / pmComplementDeviations.length : null
    };
    if ((pmComplementDeviation.meanAbsDeviation ?? 0) > pmComplementDeviationWarningThreshold) {
      warnings.push(`Polymarket UP/DOWN complement deviation is high: ${pmComplementDeviation.meanAbsDeviation?.toFixed(3) ?? "null"}`);
    }
    const allTimeSensitivityPairs = validRows.map((validRow) => {
      const featureMap = this.createFeatureMap(validRow.featureRow);
      return [featureMap.timeToExpirySeconds ?? 0, Math.abs((featureMap.pmUpMid ?? 0) - 0.5)] as [number, number];
    });
    const timeToExpirySensitivity = this.calculateCorrelation(allTimeSensitivityPairs);
    let orderbookConsistencyFailureCount = 0;
    for (const validRow of validRows) {
      const featureMap = this.createFeatureMap(validRow.featureRow);
      const pmAggressiveBuyRatio = featureMap.pmAggressiveBuyRatio;
      if (typeof pmAggressiveBuyRatio === "number" && (pmAggressiveBuyRatio < 0 || pmAggressiveBuyRatio > 1)) {
        orderbookConsistencyFailureCount += 1;
      }
      for (const sourceName of sourceNames) {
        const sourceLabel = sourceLabels[sourceName];
        const imbalance = featureMap[`spot${sourceLabel}OrderbookImbalance`];
        const microPrice = featureMap[`spot${sourceLabel}Microprice`];
        const midPrice = featureMap[`spot${sourceLabel}MidPrice`];
        if (typeof imbalance === "number" && (imbalance < -1 || imbalance > 1)) {
          orderbookConsistencyFailureCount += 1;
        }
        if (typeof microPrice === "number" && typeof midPrice === "number" && !Number.isFinite(microPrice - midPrice)) {
          orderbookConsistencyFailureCount += 1;
        }
      }
    }
    if (orderbookConsistencyFailureCount > 0) {
      failures.push(`Detected ${orderbookConsistencyFailureCount} orderbook consistency violations`);
    }
    const coherenceAnalysisResult: CoherenceAnalysisResult = {
      directionalAgreementRatioBySource,
      pmComplementDeviation,
      probabilityMomentumAgreementBySource,
      probabilityMomentumCorrelationBySource,
      strikeDistanceSensitivityBySource,
      timeToExpirySensitivity,
      orderbookConsistencyFailureCount,
      warnings,
      failures
    };
    return coherenceAnalysisResult;
  }

  private buildWarnings(validRows: readonly ValidFeatureRow[], featureStatsByName: Record<string, FeatureValueStats>, nullRowRatio: number): readonly string[] {
    const warnings: string[] = [];
    if (nullRowRatio > highNullRatioWarningThreshold) {
      warnings.push(`High null row ratio detected: ${nullRowRatio.toFixed(3)}`);
    }
    const constantFeatureNames = Object.entries(featureStatsByName)
      .filter(([, stats]) => stats.isConstant)
      .map(([featureName]) => featureName);
    if (constantFeatureNames.length > 0) {
      warnings.push(`Constant features detected: ${constantFeatureNames.slice(0, 10).join(", ")}`);
    }
    const largeMagnitudeFeatures = Object.entries(featureStatsByName)
      .filter(([, stats]) => (stats.maxAbsValue ?? 0) > highAbsoluteFeatureValueWarningThreshold)
      .map(([featureName]) => featureName);
    if (largeMagnitudeFeatures.length > 0) {
      warnings.push(`Large feature magnitudes detected: ${largeMagnitudeFeatures.slice(0, 10).join(", ")}`);
    }
    if (validRows.length === 0) {
      warnings.push("No valid feature rows were produced for this market");
    }
    return warnings;
  }

  private buildFailures(
    featureRows: readonly (readonly number[] | null)[],
    validRows: readonly ValidFeatureRow[],
    featureStatsByName: Record<string, FeatureValueStats>
  ): readonly string[] {
    const failures: string[] = [];
    const featureLengthMismatchCount = featureRows.filter((featureRow) => featureRow !== null && featureRow.length !== featureOrder.length).length;
    if (featureLengthMismatchCount > 0) {
      failures.push(`Detected ${featureLengthMismatchCount} feature rows with unexpected length`);
    }
    const nonFiniteFeatureNames = Object.entries(featureStatsByName)
      .filter(([, stats]) => stats.hasNonFiniteValue)
      .map(([featureName]) => featureName);
    if (nonFiniteFeatureNames.length > 0) {
      failures.push(`Non-finite feature values detected in: ${nonFiniteFeatureNames.join(", ")}`);
    }
    if (featureRows.length > 0 && validRows.length === 0) {
      failures.push("All feature rows were discarded as null");
    }
    return failures;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public analyze(options: AnalyzeOptions): FeatureAnalysisResult {
    const featureRows = buildFeatures(options.snapshots);
    const validRows = this.buildValidRows(options.snapshots, featureRows);
    const featureStatsByName = this.buildFeatureValueStats(validRows);
    const featureLengthMismatchCount = featureRows.filter((featureRow) => featureRow !== null && featureRow.length !== featureOrder.length).length;
    const nullRowCount = featureRows.filter((featureRow) => featureRow === null).length;
    const validRowCount = validRows.length;
    const nullRowRatio = featureRows.length === 0 ? 0 : nullRowCount / featureRows.length;
    const randomSamples = this.buildSamples(validRows, options.market, options.randomSampleCount);
    const coherence = this.buildCoherenceAnalysis(validRows);
    const warnings = [...this.buildWarnings(validRows, featureStatsByName, nullRowRatio), ...coherence.warnings];
    const failures = [...this.buildFailures(featureRows, validRows, featureStatsByName), ...coherence.failures];
    const featureAnalysisResult: FeatureAnalysisResult = {
      featureRowCount: featureRows.length,
      nullRowCount,
      validRowCount,
      nullRowRatio,
      featureLengthMismatchCount,
      featureSpecVersion,
      featureOrder: [...featureOrder],
      featureStatsByName,
      randomSamples,
      coherence,
      failures,
      warnings
    };
    return featureAnalysisResult;
  }

  /**
   * @section static:methods
   */

  // empty
}

export { spotFeatureOrder };
