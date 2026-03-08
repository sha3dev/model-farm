/**
 * @section imports:externals
 */

import type { MarketSnapshot } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import type { SnapshotAnalysisResult, SnapshotAvailabilityStats, ValidationCryptoSourceName } from "./collector-validation.types.ts";

/**
 * @section consts
 */

const largeGapThresholdMs = 15_000;
const suspiciouslyTinySnapshotCount = 5;

/**
 * @section types
 */

// empty

export class CollectorValidationSnapshotAnalyzerService {
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

  public static create(): CollectorValidationSnapshotAnalyzerService {
    const service = new CollectorValidationSnapshotAnalyzerService();
    return service;
  }

  /**
   * @section private:methods
   */

  private createEmptyAvailabilityStats(): SnapshotAvailabilityStats {
    const availabilityStats: SnapshotAvailabilityStats = { hasPriceEventCount: 0, hasOrderbookEventCount: 0, priceCoverageRatio: 0, orderbookCoverageRatio: 0 };
    return availabilityStats;
  }

  private buildSpotSourceAvailability(snapshots: readonly MarketSnapshot[]): Record<ValidationCryptoSourceName, SnapshotAvailabilityStats> {
    const sourceNames: readonly ValidationCryptoSourceName[] = ["binance", "coinbase", "kraken", "okx", "chainlink"];
    const availabilityEntries = sourceNames.map((sourceName) => {
      const priceCount = snapshots.filter((snapshot) => snapshot.crypto[snapshot.asset][sourceName].price !== null).length;
      const orderbookCount = snapshots.filter((snapshot) => snapshot.crypto[snapshot.asset][sourceName].orderbook !== null).length;
      const ratioBase = snapshots.length === 0 ? 1 : snapshots.length;
      const availabilityStats: SnapshotAvailabilityStats = {
        hasPriceEventCount: priceCount,
        hasOrderbookEventCount: orderbookCount,
        priceCoverageRatio: priceCount / ratioBase,
        orderbookCoverageRatio: orderbookCount / ratioBase
      };
      const availabilityEntry: [ValidationCryptoSourceName, SnapshotAvailabilityStats] = [sourceName, availabilityStats];
      return availabilityEntry;
    });
    const sourceAvailability = Object.fromEntries(availabilityEntries) as Record<ValidationCryptoSourceName, SnapshotAvailabilityStats>;
    return sourceAvailability;
  }

  private buildPmAvailability(snapshots: readonly MarketSnapshot[], fieldName: "price" | "orderbook"): Record<"up" | "down", SnapshotAvailabilityStats> {
    const tokenSides = ["up", "down"] as const;
    const availabilityEntries = tokenSides.map((tokenSide) => {
      const eventCount = snapshots.filter((snapshot) => snapshot.polymarket[tokenSide][fieldName] !== null).length;
      const ratioBase = snapshots.length === 0 ? 1 : snapshots.length;
      const availabilityStats: SnapshotAvailabilityStats = {
        hasPriceEventCount: fieldName === "price" ? eventCount : 0,
        hasOrderbookEventCount: fieldName === "orderbook" ? eventCount : 0,
        priceCoverageRatio: fieldName === "price" ? eventCount / ratioBase : 0,
        orderbookCoverageRatio: fieldName === "orderbook" ? eventCount / ratioBase : 0
      };
      const availabilityEntry: ["up" | "down", SnapshotAvailabilityStats] = [tokenSide, availabilityStats];
      return availabilityEntry;
    });
    const pmAvailability = Object.fromEntries(availabilityEntries) as Record<"up" | "down", SnapshotAvailabilityStats>;
    return pmAvailability;
  }

  private calculateMaxGapMs(snapshots: readonly MarketSnapshot[]): number {
    let maxGapMs = 0;
    for (let index = 1; index < snapshots.length; index += 1) {
      const previousSnapshot = snapshots[index - 1];
      const currentSnapshot = snapshots[index];
      if (previousSnapshot && currentSnapshot) {
        const gapMs = currentSnapshot.snapshotTs - previousSnapshot.snapshotTs;
        if (gapMs > maxGapMs) {
          maxGapMs = gapMs;
        }
      }
    }
    return maxGapMs;
  }

  private buildWarnings(snapshots: readonly MarketSnapshot[], analysis: Omit<SnapshotAnalysisResult, "warnings" | "failures">): readonly string[] {
    const warnings: string[] = [];
    const hasMissingOrderbooks = Object.values(analysis.spotSourceAvailability).some((availability) => availability.orderbookCoverageRatio === 0);
    if (hasMissingOrderbooks) {
      warnings.push("At least one spot source has zero orderbook coverage in this market window");
    }
    if (analysis.maxGapMs > largeGapThresholdMs) {
      warnings.push(`Detected large snapshot gap of ${analysis.maxGapMs}ms`);
    }
    if (snapshots.length < suspiciouslyTinySnapshotCount) {
      warnings.push(`Suspiciously low snapshot count: ${snapshots.length}`);
    }
    return warnings;
  }

  private buildFailures(analysis: Omit<SnapshotAnalysisResult, "warnings" | "failures">): readonly string[] {
    const failures: string[] = [];
    if (analysis.snapshotCount === 0) {
      failures.push("No snapshots were returned for this market");
    }
    if (!analysis.isAscendingByTimestamp) {
      failures.push("Snapshots are not sorted by snapshotTs ascending");
    }
    if (analysis.hasMixedAsset) {
      failures.push("Snapshots contain multiple assets");
    }
    if (analysis.hasMixedWindow) {
      failures.push("Snapshots contain multiple windows");
    }
    if (analysis.hasMissingPriceToBeat) {
      failures.push("At least one snapshot is missing priceToBeat");
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

  public analyze(snapshots: readonly MarketSnapshot[]): SnapshotAnalysisResult {
    const firstSnapshot = snapshots[0] ?? null;
    const lastSnapshot = snapshots[snapshots.length - 1] ?? null;
    const isAscendingByTimestamp = snapshots.every(
      (snapshot, index) => index === 0 || snapshot.snapshotTs >= (snapshots[index - 1]?.snapshotTs ?? snapshot.snapshotTs)
    );
    const baseAsset = firstSnapshot?.asset ?? null;
    const baseWindow = firstSnapshot?.window ?? null;
    const hasMixedAsset = baseAsset === null ? false : snapshots.some((snapshot) => snapshot.asset !== baseAsset);
    const hasMixedWindow = baseWindow === null ? false : snapshots.some((snapshot) => snapshot.window !== baseWindow);
    const hasMissingPriceToBeat = snapshots.some((snapshot) => typeof snapshot.priceToBeat !== "number");
    const durationCoveredMs = firstSnapshot && lastSnapshot ? Math.max(0, lastSnapshot.snapshotTs - firstSnapshot.snapshotTs) : 0;
    const draftAnalysis = {
      snapshotCount: snapshots.length,
      firstSnapshotTs: firstSnapshot?.snapshotTs ?? null,
      lastSnapshotTs: lastSnapshot?.snapshotTs ?? null,
      durationCoveredMs,
      isAscendingByTimestamp,
      hasMixedAsset,
      hasMixedWindow,
      hasMissingPriceToBeat,
      maxGapMs: this.calculateMaxGapMs(snapshots),
      spotSourceAvailability: this.buildSpotSourceAvailability(snapshots),
      pmBookAvailability: this.buildPmAvailability(snapshots, "orderbook"),
      pmPriceAvailability: this.buildPmAvailability(snapshots, "price")
    };
    const warnings = this.buildWarnings(snapshots, draftAnalysis);
    const failures = this.buildFailures(draftAnalysis);
    const snapshotAnalysisResult: SnapshotAnalysisResult = { ...draftAnalysis, warnings, failures };
    return snapshotAnalysisResult;
  }

  /**
   * @section static:methods
   */

  // empty
}
