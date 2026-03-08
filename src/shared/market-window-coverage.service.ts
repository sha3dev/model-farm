/**
 * @section imports:externals
 */

import type { MarketRecord, MarketSnapshot } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

// empty

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

type MarketWindowCoverageServiceOptions = { minimumCoverageRatio: number };
type CoverageMetrics = { coverageRatio: number; snapshotCount: number };

export class MarketWindowCoverageService {
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

  private readonly minimumCoverageRatio: number;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: MarketWindowCoverageServiceOptions) {
    this.minimumCoverageRatio = options.minimumCoverageRatio;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(options: MarketWindowCoverageServiceOptions): MarketWindowCoverageService {
    const service = new MarketWindowCoverageService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private calculateCoverageRatioFromBounds(marketStartTs: number, marketEndTs: number, firstSnapshotTs: number | null, lastSnapshotTs: number | null): number {
    const marketWindowMs = Math.max(1, marketEndTs - marketStartTs);
    const coveredWindowMs = firstSnapshotTs !== null && lastSnapshotTs !== null ? Math.max(0, lastSnapshotTs - firstSnapshotTs) : 0;
    const coverageRatio = coveredWindowMs / marketWindowMs;
    return coverageRatio;
  }

  private sortSnapshots(snapshots: readonly MarketSnapshot[]): readonly MarketSnapshot[] {
    const sortedSnapshots = [...snapshots].sort((leftSnapshot, rightSnapshot) => leftSnapshot.snapshotTs - rightSnapshot.snapshotTs);
    return sortedSnapshots;
  }

  private resolveSnapshotWindow(snapshots: readonly MarketSnapshot[]): { marketStartTs: number; marketEndTs: number } | null {
    const firstSnapshot = snapshots[0] ?? null;
    const snapshotWindow = firstSnapshot ? { marketStartTs: firstSnapshot.marketStartTs, marketEndTs: firstSnapshot.marketEndTs } : null;
    return snapshotWindow;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public calculateFromMarket(market: Pick<MarketRecord, "marketStartTs" | "marketEndTs">, snapshots: readonly MarketSnapshot[]): CoverageMetrics {
    const firstSnapshotTs = snapshots[0]?.snapshotTs ?? null;
    const lastSnapshotTs = snapshots[snapshots.length - 1]?.snapshotTs ?? null;
    const coverageMetrics: CoverageMetrics = {
      coverageRatio: this.calculateCoverageRatioFromBounds(market.marketStartTs, market.marketEndTs, firstSnapshotTs, lastSnapshotTs),
      snapshotCount: snapshots.length
    };
    return coverageMetrics;
  }

  public normalizeSnapshotsToWindow(snapshots: readonly MarketSnapshot[]): readonly MarketSnapshot[] {
    const sortedSnapshots = this.sortSnapshots(snapshots);
    const snapshotWindow = this.resolveSnapshotWindow(sortedSnapshots);
    const normalizedSnapshots =
      snapshotWindow === null
        ? []
        : sortedSnapshots.filter((snapshot) => snapshot.snapshotTs >= snapshotWindow.marketStartTs && snapshot.snapshotTs <= snapshotWindow.marketEndTs);
    return normalizedSnapshots;
  }

  public isCoverageSufficient(market: Pick<MarketRecord, "marketStartTs" | "marketEndTs">, snapshots: readonly MarketSnapshot[]): boolean {
    const coverageMetrics = this.calculateFromMarket(market, snapshots);
    const isCoverageSufficient = coverageMetrics.snapshotCount > 0 && coverageMetrics.coverageRatio >= this.minimumCoverageRatio;
    return isCoverageSufficient;
  }

  public buildCoverageFailureMessage(market: Pick<MarketRecord, "marketStartTs" | "marketEndTs">, snapshots: readonly MarketSnapshot[]): string {
    const coverageMetrics = this.calculateFromMarket(market, snapshots);
    const failureMessage = `Market window coverage ${coverageMetrics.coverageRatio.toFixed(3)} is below minimum ${this.minimumCoverageRatio.toFixed(3)}`;
    return failureMessage;
  }

  /**
   * @section static:methods
   */

  // empty
}
