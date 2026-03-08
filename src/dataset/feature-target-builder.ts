/**
 * @section imports:externals
 */

import { createHash } from "node:crypto";
import type { MarketRecord, MarketSnapshot } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

// empty

/**
 * @section consts
 */

const minimumSnapshotCount = 1;
const epsilon = 0.00000001;
const return1sLookbackMs = 1_000;
const return5sLookbackMs = 5_000;
const return20sLookbackMs = 20_000;
const volatility30sLookbackMs = 30_000;
const probabilityDelta5sLookbackMs = 5_000;
const targetSpecVersionValue = "1.0.0";
const emptyFeatureHistory: readonly (readonly number[] | null)[] = [];
const neutralOrderbookImbalance = 0;
const neutralAggressiveBuyRatio = 0.5;
const defaultTickSize = 1;
const spotSourceConfigs: readonly SpotSourceConfig[] = [
  { sourceName: "binance", label: "Binance" },
  { sourceName: "coinbase", label: "Coinbase" },
  { sourceName: "kraken", label: "Kraken" },
  { sourceName: "okx", label: "Okx" },
  { sourceName: "chainlink", label: "Chainlink" }
] as const;

const spotFeatureOrder = spotSourceConfigs.flatMap((sourceConfig) => {
  const label = sourceConfig.label;
  const sourceFeatureOrder = [
    `spot${label}MidPrice`,
    `spot${label}Return1s`,
    `spot${label}Return5s`,
    `spot${label}Return20s`,
    `spot${label}Volatility30s`,
    `spot${label}OrderbookImbalance`,
    `spot${label}Microprice`,
    `spot${label}MoveSinceMarketOpen`,
    `distanceToStrike${label}`,
    `ticksToStrike${label}`,
    `pmVs${label}SpotDivergence`,
    `pmProbChangeVs${label}Move`
  ];
  return sourceFeatureOrder;
});

const featureOrder = [
  ...spotFeatureOrder,
  "pmUpMid",
  "pmDownMid",
  "pmUpSpread",
  "pmDownSpread",
  "pmUpOrderbookImbalance",
  "pmDownOrderbookImbalance",
  "pmAggressiveBuyRatio",
  "pmProbUpDelta5s",
  "strike",
  "timeToExpirySeconds",
  "timeToExpiryDistanceToStrike"
] as const;

const featureSpecVersion = createHash("sha256").update(featureOrder.join("|"), "utf8").digest("hex").slice(0, 12);
const targetSpecVersion = targetSpecVersionValue;

/**
 * @section types
 */

type BuildTargetOptions = { market: Pick<MarketRecord, "priceToBeat" | "finalPrice">; sampleCount: number };
type CryptoSourceName = "binance" | "coinbase" | "kraken" | "okx" | "chainlink";
type SpotSourceConfig = { sourceName: CryptoSourceName; label: string };
type SnapshotEventState = MarketSnapshot["crypto"]["btc"]["binance"];
type OrderbookLevel = { price: number; size: number };
type ParsedOrderbook = {
  bids: readonly OrderbookLevel[];
  asks: readonly OrderbookLevel[];
  bidDepth: number;
  askDepth: number;
  bestBid: OrderbookLevel | null;
  bestAsk: OrderbookLevel | null;
  tickSize: number;
};
type OrderbookParseResult = { parsedOrderbook: ParsedOrderbook | null; hasInvalidOrderbook: boolean; parseErrorMessage: string | null };
type OrderbookSignal = {
  midPrice: number | null;
  microPrice: number | null;
  spread: number;
  imbalance: number;
  aggressiveBuyRatio: number;
  tickSize: number;
  hasInvalidOrderbook: boolean;
};
type SpotSourceMetrics = {
  midPrice: number;
  return1s: number;
  return5s: number;
  return20s: number;
  volatility30s: number;
  orderbookImbalance: number;
  microPrice: number;
  moveSinceMarketOpen: number;
  distanceToStrike: number;
  ticksToStrike: number;
  pmVsSpotDivergence: number;
  pmProbChangeVsSpotMove: number;
};
type BuildFeatureRowContext = {
  currentSnapshot: MarketSnapshot;
  upPolymarketSignal: OrderbookSignal;
  downPolymarketSignal: OrderbookSignal;
  pmProbUpDelta5s: number;
  strike: number;
  spotSourceMetricsBySource: readonly SpotSourceMetrics[];
};
type PolymarketSide = "up" | "down";

export class FeatureTargetBuilder {
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

  private readonly spotSignalCache: WeakMap<MarketSnapshot, Map<CryptoSourceName, OrderbookSignal>>;
  private readonly spotReferencePriceCache: WeakMap<MarketSnapshot, Map<CryptoSourceName, number | null>>;
  private readonly polymarketSignalCache: WeakMap<MarketSnapshot, Map<PolymarketSide, OrderbookSignal>>;
  private readonly polymarketReferencePriceCache: WeakMap<MarketSnapshot, Map<PolymarketSide, number | null>>;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor() {
    this.spotSignalCache = new WeakMap();
    this.spotReferencePriceCache = new WeakMap();
    this.polymarketSignalCache = new WeakMap();
    this.polymarketReferencePriceCache = new WeakMap();
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(): FeatureTargetBuilder {
    const featureTargetBuilder = new FeatureTargetBuilder();
    return featureTargetBuilder;
  }

  /**
   * @section private:methods
   */

  private safeRelativeDelta(currentValue: number | null, referenceValue: number | null): number {
    const hasCurrentValue = typeof currentValue === "number";
    const hasReferenceValue = typeof referenceValue === "number";
    const hasValidReference = hasReferenceValue && Math.abs(referenceValue) > epsilon;
    let relativeDelta = 0;
    if (hasCurrentValue && hasValidReference) {
      relativeDelta = (currentValue - referenceValue) / referenceValue;
    }
    return relativeDelta;
  }

  private toSigmoid(value: number): number {
    const probability = 1 / (1 + Math.exp(-value));
    return probability;
  }

  private resolveStrike(snapshot: MarketSnapshot): number | null {
    const strike = snapshot.priceToBeat;
    const hasValidStrike = typeof strike === "number" && strike > epsilon;
    let resolvedStrike: number | null = null;
    if (hasValidStrike) {
      resolvedStrike = strike;
    }
    return resolvedStrike;
  }

  private resolveAssetPrice(snapshot: MarketSnapshot, sourceName: CryptoSourceName): number | null {
    const assetState = snapshot.crypto[snapshot.asset][sourceName];
    const price = assetState.price?.price;
    const hasPrice = typeof price === "number";
    let resolvedPrice: number | null = null;
    if (hasPrice) {
      resolvedPrice = price;
    }
    return resolvedPrice;
  }

  private resolveReferenceSnapshot(
    snapshots: readonly MarketSnapshot[],
    currentIndex: number,
    currentTs: number,
    lookbackMs: number,
    shouldUseSnapshot?: (snapshot: MarketSnapshot) => boolean
  ): MarketSnapshot | null {
    const targetTs = currentTs - lookbackMs;
    let referenceSnapshot: MarketSnapshot | null = null;
    for (let index = currentIndex; index >= 0 && referenceSnapshot === null; index -= 1) {
      const snapshot = snapshots[index] ?? null;
      const shouldKeepSearching = snapshot !== null && snapshot.snapshotTs <= targetTs && (shouldUseSnapshot ? shouldUseSnapshot(snapshot) : true);
      if (shouldKeepSearching) {
        referenceSnapshot = snapshot;
      }
    }
    return referenceSnapshot;
  }

  private resolveSnapshotsInLookbackRange(
    snapshots: readonly MarketSnapshot[],
    currentIndex: number,
    currentTs: number,
    lookbackMs: number,
    shouldUseSnapshot?: (snapshot: MarketSnapshot) => boolean
  ): readonly MarketSnapshot[] {
    const minTs = currentTs - lookbackMs;
    const snapshotsInLookbackRange: MarketSnapshot[] = [];
    for (let index = currentIndex; index >= 0; index -= 1) {
      const snapshot = snapshots[index] ?? null;
      const isBelowRange = snapshot !== null && snapshot.snapshotTs < minTs;
      if (isBelowRange) {
        break;
      }
      const shouldIncludeSnapshot = snapshot !== null && snapshot.snapshotTs <= currentTs && (shouldUseSnapshot ? shouldUseSnapshot(snapshot) : true);
      if (shouldIncludeSnapshot && snapshot !== null) {
        snapshotsInLookbackRange.push(snapshot);
      }
    }
    snapshotsInLookbackRange.reverse();
    return snapshotsInLookbackRange;
  }

  private resolveOrderbookLevels(levels: unknown): readonly OrderbookLevel[] {
    const hasLevels = Array.isArray(levels);
    let orderbookLevels: readonly OrderbookLevel[] = [];
    if (hasLevels) {
      orderbookLevels = levels.flatMap((level) => {
        const orderbookLevel = this.resolveRawOrderbookLevel(level);
        const nextOrderbookLevels = orderbookLevel === null ? [] : [orderbookLevel];
        return nextOrderbookLevels;
      });
    }
    return orderbookLevels;
  }

  private resolveRawOrderbookLevel(level: unknown): OrderbookLevel | null {
    const hasTuple = Array.isArray(level) && level.length >= 2;
    const hasObject = typeof level === "object" && level !== null && "price" in level && "size" in level;
    let orderbookLevel: OrderbookLevel | null = null;
    if (hasTuple) {
      orderbookLevel = this.resolveOrderbookLevel(level[0], level[1]);
    } else if (hasObject) {
      const rawLevel = level as { price: unknown; size: unknown };
      orderbookLevel = this.resolveOrderbookLevel(rawLevel.price, rawLevel.size);
    }
    return orderbookLevel;
  }

  private resolveOrderbookLevel(rawPrice: unknown, rawSize: unknown): OrderbookLevel | null {
    const numericPrice = typeof rawPrice === "number" ? rawPrice : Number(rawPrice);
    const numericSize = typeof rawSize === "number" ? rawSize : Number(rawSize);
    const hasValidPrice = Number.isFinite(numericPrice);
    const hasValidSize = Number.isFinite(numericSize);
    let orderbookLevel: OrderbookLevel | null = null;
    if (hasValidPrice && hasValidSize) {
      orderbookLevel = { price: numericPrice, size: numericSize };
    }
    return orderbookLevel;
  }

  private resolveTickSize(bids: readonly OrderbookLevel[], asks: readonly OrderbookLevel[]): number {
    const combinedLevels = [...bids, ...asks].map((level) => level.price).sort((left, right) => left - right);
    const tickCandidates = combinedLevels.slice(1).map((price, index) => price - combinedLevels[index]!);
    const positiveTickCandidates = tickCandidates.filter((tickSize) => tickSize > epsilon);
    const tickSize = positiveTickCandidates.length > 0 ? Math.min(...positiveTickCandidates) : defaultTickSize;
    return tickSize;
  }

  private parseOrderbook(orderbookText: string | null | undefined): OrderbookParseResult {
    const hasOrderbookText = typeof orderbookText === "string" && orderbookText.length > 0;
    let parsedOrderbook: ParsedOrderbook | null = null;
    let hasInvalidOrderbook = false;
    let parseErrorMessage: string | null = null;
    if (hasOrderbookText) {
      try {
        const parsedValue = JSON.parse(orderbookText) as { asks?: unknown; bids?: unknown };
        const bids = this.resolveOrderbookLevels(parsedValue.bids);
        const asks = this.resolveOrderbookLevels(parsedValue.asks);
        const bidDepth = bids.reduce((sum, level) => sum + level.size, 0);
        const askDepth = asks.reduce((sum, level) => sum + level.size, 0);
        const bestBid = bids.reduce<OrderbookLevel | null>((bestLevel, level) => {
          const nextBestLevel = bestLevel === null || level.price > bestLevel.price ? level : bestLevel;
          return nextBestLevel;
        }, null);
        const bestAsk = asks.reduce<OrderbookLevel | null>((bestLevel, level) => {
          const nextBestLevel = bestLevel === null || level.price < bestLevel.price ? level : bestLevel;
          return nextBestLevel;
        }, null);
        const tickSize = this.resolveTickSize(bids, asks);
        parsedOrderbook = { bids, asks, bidDepth, askDepth, bestBid, bestAsk, tickSize };
      } catch (error) {
        hasInvalidOrderbook = true;
        parseErrorMessage = error instanceof Error ? error.message : "Unknown orderbook parse error";
      }
    }
    const orderbookParseResult: OrderbookParseResult = { parsedOrderbook, hasInvalidOrderbook, parseErrorMessage };
    return orderbookParseResult;
  }

  private resolveOrderbookSignal(eventState: SnapshotEventState): OrderbookSignal {
    const price = eventState.price?.price ?? null;
    const orderbookParseResult = this.parseOrderbook(eventState.orderbook?.orderbook);
    const hasParseError = orderbookParseResult.parseErrorMessage !== null;
    const parsedOrderbook = orderbookParseResult.parsedOrderbook;
    const bestBid = parsedOrderbook?.bestBid ?? null;
    const bestAsk = parsedOrderbook?.bestAsk ?? null;
    const totalDepth = parsedOrderbook === null ? 0 : parsedOrderbook.bidDepth + parsedOrderbook.askDepth;
    const hasDepth = totalDepth > epsilon;
    const hasSpread = bestBid !== null && bestAsk !== null && bestAsk.price - bestBid.price > epsilon;
    const midPrice = bestBid !== null && bestAsk !== null ? (bestBid.price + bestAsk.price) / 2 : price;
    const microPrice =
      bestBid !== null && bestAsk !== null && bestBid.size + bestAsk.size > epsilon
        ? (bestAsk.price * bestBid.size + bestBid.price * bestAsk.size) / (bestBid.size + bestAsk.size)
        : midPrice;
    const spread = bestBid !== null && bestAsk !== null ? Math.max(0, bestAsk.price - bestBid.price) : 0;
    const imbalance = hasDepth && parsedOrderbook !== null ? (parsedOrderbook.bidDepth - parsedOrderbook.askDepth) / totalDepth : neutralOrderbookImbalance;
    const aggressiveBuyRatio =
      hasSpread && microPrice !== null && bestBid !== null && bestAsk !== null
        ? Math.min(1, Math.max(0, (microPrice - bestBid.price) / (bestAsk.price - bestBid.price)))
        : neutralAggressiveBuyRatio;
    const tickSize = parsedOrderbook?.tickSize ?? defaultTickSize;
    const orderbookSignal: OrderbookSignal = {
      midPrice,
      microPrice,
      spread,
      imbalance,
      aggressiveBuyRatio,
      tickSize,
      hasInvalidOrderbook: orderbookParseResult.hasInvalidOrderbook || hasParseError
    };
    return orderbookSignal;
  }

  private resolveSpotSourceSignal(snapshot: MarketSnapshot, sourceName: CryptoSourceName): OrderbookSignal {
    const cachedSignal = this.spotSignalCache.get(snapshot)?.get(sourceName) ?? null;
    let spotSourceSignal = cachedSignal;
    if (spotSourceSignal === null) {
      spotSourceSignal = this.resolveOrderbookSignal(snapshot.crypto[snapshot.asset][sourceName]);
      const nextCacheEntry = this.spotSignalCache.get(snapshot) ?? new Map<CryptoSourceName, OrderbookSignal>();
      nextCacheEntry.set(sourceName, spotSourceSignal);
      this.spotSignalCache.set(snapshot, nextCacheEntry);
    }
    return spotSourceSignal;
  }

  private resolveSpotReferencePrice(snapshot: MarketSnapshot, sourceName: CryptoSourceName): number | null {
    const cachedReferencePrice = this.spotReferencePriceCache.get(snapshot)?.get(sourceName) ?? null;
    let spotReferencePrice = cachedReferencePrice;
    const hasCachedValue = this.spotReferencePriceCache.get(snapshot)?.has(sourceName) ?? false;
    if (!hasCachedValue) {
      const spotSourceSignal = this.resolveSpotSourceSignal(snapshot, sourceName);
      const directPrice = this.resolveAssetPrice(snapshot, sourceName);
      spotReferencePrice = typeof spotSourceSignal.midPrice === "number" ? spotSourceSignal.midPrice : directPrice;
      const nextCacheEntry = this.spotReferencePriceCache.get(snapshot) ?? new Map<CryptoSourceName, number | null>();
      nextCacheEntry.set(sourceName, spotReferencePrice);
      this.spotReferencePriceCache.set(snapshot, nextCacheEntry);
    }
    return spotReferencePrice;
  }

  private resolvePolymarketSignal(snapshot: MarketSnapshot, side: PolymarketSide): OrderbookSignal {
    const cachedSignal = this.polymarketSignalCache.get(snapshot)?.get(side) ?? null;
    let polymarketSignal = cachedSignal;
    if (polymarketSignal === null) {
      polymarketSignal = this.resolveOrderbookSignal(snapshot.polymarket[side]);
      const nextCacheEntry = this.polymarketSignalCache.get(snapshot) ?? new Map<PolymarketSide, OrderbookSignal>();
      nextCacheEntry.set(side, polymarketSignal);
      this.polymarketSignalCache.set(snapshot, nextCacheEntry);
    }
    return polymarketSignal;
  }

  private resolvePolymarketReferencePrice(snapshot: MarketSnapshot, side: PolymarketSide): number | null {
    const cachedReferencePrice = this.polymarketReferencePriceCache.get(snapshot)?.get(side) ?? null;
    let polymarketReferencePrice = cachedReferencePrice;
    const hasCachedValue = this.polymarketReferencePriceCache.get(snapshot)?.has(side) ?? false;
    if (!hasCachedValue) {
      const polymarketSignal = this.resolvePolymarketSignal(snapshot, side);
      const directPrice = snapshot.polymarket[side].price?.price ?? null;
      polymarketReferencePrice = typeof polymarketSignal.midPrice === "number" ? polymarketSignal.midPrice : directPrice;
      const nextCacheEntry = this.polymarketReferencePriceCache.get(snapshot) ?? new Map<PolymarketSide, number | null>();
      nextCacheEntry.set(side, polymarketReferencePrice);
      this.polymarketReferencePriceCache.set(snapshot, nextCacheEntry);
    }
    return polymarketReferencePrice;
  }

  private hasSpotReferencePrice(snapshot: MarketSnapshot, sourceName: CryptoSourceName): boolean {
    const hasSpotReferencePrice = typeof this.resolveSpotReferencePrice(snapshot, sourceName) === "number";
    return hasSpotReferencePrice;
  }

  private hasPolymarketReferencePrice(snapshot: MarketSnapshot): boolean {
    const hasPolymarketReferencePrice = typeof this.resolvePolymarketReferencePrice(snapshot, "up") === "number";
    return hasPolymarketReferencePrice;
  }

  private resolveFirstSnapshotWithSpotReference(
    snapshots: readonly MarketSnapshot[],
    currentIndex: number,
    sourceName: CryptoSourceName
  ): MarketSnapshot | null {
    let firstSnapshotWithSpotReference: MarketSnapshot | null = null;
    for (let index = 0; index <= currentIndex && firstSnapshotWithSpotReference === null; index += 1) {
      const snapshot = snapshots[index] ?? null;
      if (snapshot !== null && this.hasSpotReferencePrice(snapshot, sourceName)) {
        firstSnapshotWithSpotReference = snapshot;
      }
    }
    return firstSnapshotWithSpotReference;
  }

  private calculateReturnFromReferenceSnapshot(
    snapshots: readonly MarketSnapshot[],
    currentIndex: number,
    currentSnapshot: MarketSnapshot,
    sourceName: CryptoSourceName,
    lookbackMs: number
  ): number | null {
    const referenceSnapshot = this.resolveReferenceSnapshot(snapshots, currentIndex, currentSnapshot.snapshotTs, lookbackMs, (snapshot) => {
      const hasReferencePrice = this.hasSpotReferencePrice(snapshot, sourceName);
      return hasReferencePrice;
    });
    const currentPrice = this.resolveSpotReferencePrice(currentSnapshot, sourceName);
    const referencePrice = referenceSnapshot === null ? null : this.resolveSpotReferencePrice(referenceSnapshot, sourceName);
    const hasReferenceSnapshot = referenceSnapshot !== null;
    let calculatedReturn: number | null = null;
    if (hasReferenceSnapshot) {
      calculatedReturn = this.safeRelativeDelta(currentPrice, referencePrice);
    }
    return calculatedReturn;
  }

  private calculateVolatility30s(
    snapshots: readonly MarketSnapshot[],
    currentIndex: number,
    currentSnapshot: MarketSnapshot,
    sourceName: CryptoSourceName
  ): number | null {
    const volatilitySnapshots = this.resolveSnapshotsInLookbackRange(
      snapshots,
      currentIndex,
      currentSnapshot.snapshotTs,
      volatility30sLookbackMs,
      (snapshot) => {
        const hasReferencePrice = this.hasSpotReferencePrice(snapshot, sourceName);
        return hasReferencePrice;
      }
    );
    const referenceSnapshot = this.resolveReferenceSnapshot(snapshots, currentIndex, currentSnapshot.snapshotTs, volatility30sLookbackMs, (snapshot) => {
      const hasReferencePrice = this.hasSpotReferencePrice(snapshot, sourceName);
      return hasReferencePrice;
    });
    const priceSeries = volatilitySnapshots
      .map((snapshot) => this.resolveSpotReferencePrice(snapshot, sourceName))
      .filter((price): price is number => typeof price === "number");
    const returnSeries = priceSeries.slice(1).map((price, index) => this.safeRelativeDelta(price, priceSeries[index] ?? null));
    const hasWindowCoverage = referenceSnapshot !== null;
    const hasReturns = returnSeries.length > 0;
    let volatility30s: number | null = null;
    if (hasWindowCoverage && hasReturns) {
      const meanReturn = returnSeries.reduce((sum, value) => sum + value, 0) / returnSeries.length;
      const variance =
        returnSeries.reduce((sum, value) => {
          const centeredValue = value - meanReturn;
          const nextSum = sum + centeredValue * centeredValue;
          return nextSum;
        }, 0) / returnSeries.length;
      volatility30s = Math.sqrt(variance);
    }
    return volatility30s;
  }

  private buildSpotSourceMetrics(
    snapshots: readonly MarketSnapshot[],
    currentIndex: number,
    currentSnapshot: MarketSnapshot,
    sourceConfig: SpotSourceConfig,
    pmUpMid: number,
    pmProbUpDelta5s: number,
    strike: number
  ): SpotSourceMetrics | null {
    const currentSpotSourceSignal = this.resolveSpotSourceSignal(currentSnapshot, sourceConfig.sourceName);
    const currentMidPrice = this.resolveSpotReferencePrice(currentSnapshot, sourceConfig.sourceName);
    const openSnapshot = this.resolveFirstSnapshotWithSpotReference(snapshots, currentIndex, sourceConfig.sourceName);
    const moveSinceMarketOpen =
      openSnapshot === null ? null : this.safeRelativeDelta(currentMidPrice, this.resolveSpotReferencePrice(openSnapshot, sourceConfig.sourceName));
    const return1s = this.calculateReturnFromReferenceSnapshot(snapshots, currentIndex, currentSnapshot, sourceConfig.sourceName, return1sLookbackMs);
    const return5s = this.calculateReturnFromReferenceSnapshot(snapshots, currentIndex, currentSnapshot, sourceConfig.sourceName, return5sLookbackMs);
    const return20s = this.calculateReturnFromReferenceSnapshot(snapshots, currentIndex, currentSnapshot, sourceConfig.sourceName, return20sLookbackMs);
    const volatility30s = this.calculateVolatility30s(snapshots, currentIndex, currentSnapshot, sourceConfig.sourceName);
    const hasValues =
      typeof currentMidPrice === "number" &&
      typeof currentSpotSourceSignal.microPrice === "number" &&
      typeof moveSinceMarketOpen === "number" &&
      typeof return1s === "number" &&
      typeof return5s === "number" &&
      typeof return20s === "number" &&
      typeof volatility30s === "number";
    let spotSourceMetrics: SpotSourceMetrics | null = null;
    if (!currentSpotSourceSignal.hasInvalidOrderbook && hasValues) {
      const distanceToStrike = this.safeRelativeDelta(currentMidPrice, strike);
      const ticksToStrike = (currentMidPrice - strike) / currentSpotSourceSignal.tickSize;
      const pmVsSpotDivergence = pmUpMid - this.toSigmoid(return20s);
      const pmProbChangeVsSpotMove = pmProbUpDelta5s - return5s;
      const microPrice = currentSpotSourceSignal.microPrice;
      if (typeof microPrice !== "number") {
        throw new Error(`buildFeatures expected ${sourceConfig.sourceName} microPrice to be numeric after validation`);
      }
      spotSourceMetrics = {
        midPrice: currentMidPrice,
        return1s,
        return5s,
        return20s,
        volatility30s,
        orderbookImbalance: currentSpotSourceSignal.imbalance,
        microPrice,
        moveSinceMarketOpen,
        distanceToStrike,
        ticksToStrike,
        pmVsSpotDivergence,
        pmProbChangeVsSpotMove
      };
    }
    return spotSourceMetrics;
  }

  private calculatePmProbUpDelta5s(snapshots: readonly MarketSnapshot[], currentIndex: number, currentSnapshot: MarketSnapshot): number | null {
    const referenceSnapshot = this.resolveReferenceSnapshot(snapshots, currentIndex, currentSnapshot.snapshotTs, probabilityDelta5sLookbackMs, (snapshot) => {
      const hasReferencePrice = this.hasPolymarketReferencePrice(snapshot);
      return hasReferencePrice;
    });
    const currentPmUpMid = this.resolvePolymarketReferencePrice(currentSnapshot, "up");
    const referencePmUpMid = referenceSnapshot === null ? null : this.resolvePolymarketReferencePrice(referenceSnapshot, "up");
    const hasReferenceSnapshot = referenceSnapshot !== null;
    let pmProbUpDelta5s: number | null = null;
    if (hasReferenceSnapshot && typeof currentPmUpMid === "number" && typeof referencePmUpMid === "number") {
      pmProbUpDelta5s = currentPmUpMid - referencePmUpMid;
    }
    return pmProbUpDelta5s;
  }

  private resolveBuildFeatureRowContext(snapshots: readonly MarketSnapshot[], index: number): BuildFeatureRowContext | null {
    const currentSnapshot = snapshots[index] ?? null;
    const strike = currentSnapshot === null ? null : this.resolveStrike(currentSnapshot);
    const upPolymarketSignal = currentSnapshot === null ? null : this.resolvePolymarketSignal(currentSnapshot, "up");
    const downPolymarketSignal = currentSnapshot === null ? null : this.resolvePolymarketSignal(currentSnapshot, "down");
    const pmProbUpDelta5s = currentSnapshot === null ? null : this.calculatePmProbUpDelta5s(snapshots, index, currentSnapshot);
    const pmUpMid = upPolymarketSignal?.midPrice ?? null;
    const hasInvalidOrderbook = (upPolymarketSignal?.hasInvalidOrderbook ?? false) || (downPolymarketSignal?.hasInvalidOrderbook ?? false);
    const spotSourceMetricsBySource =
      currentSnapshot === null || typeof strike !== "number" || typeof pmUpMid !== "number" || typeof pmProbUpDelta5s !== "number"
        ? []
        : spotSourceConfigs.flatMap((sourceConfig) => {
            const spotSourceMetrics = this.buildSpotSourceMetrics(snapshots, index, currentSnapshot, sourceConfig, pmUpMid, pmProbUpDelta5s, strike);
            const nextSpotSourceMetrics = spotSourceMetrics === null ? [] : [spotSourceMetrics];
            return nextSpotSourceMetrics;
          });
    const hasCompleteSpotMetrics = spotSourceMetricsBySource.length === spotSourceConfigs.length;
    const hasValues =
      currentSnapshot !== null &&
      typeof strike === "number" &&
      upPolymarketSignal !== null &&
      typeof upPolymarketSignal.midPrice === "number" &&
      downPolymarketSignal !== null &&
      typeof downPolymarketSignal.midPrice === "number" &&
      typeof pmProbUpDelta5s === "number";
    let buildFeatureRowContext: BuildFeatureRowContext | null = null;
    if (!hasInvalidOrderbook && hasValues && hasCompleteSpotMetrics && currentSnapshot) {
      buildFeatureRowContext = { currentSnapshot, upPolymarketSignal, downPolymarketSignal, pmProbUpDelta5s, strike, spotSourceMetricsBySource };
    }
    return buildFeatureRowContext;
  }

  private buildFeatureRow(context: BuildFeatureRowContext): readonly number[] {
    const timeToExpirySeconds = Math.max(0, (context.currentSnapshot.marketEndTs - context.currentSnapshot.snapshotTs) / 1000);
    const averageDistanceToStrike =
      context.spotSourceMetricsBySource.reduce((sum, metrics) => sum + metrics.distanceToStrike, 0) / context.spotSourceMetricsBySource.length;
    const spotFeatureValues = context.spotSourceMetricsBySource.flatMap((metrics) => {
      const sourceFeatureValues = [
        metrics.midPrice,
        metrics.return1s,
        metrics.return5s,
        metrics.return20s,
        metrics.volatility30s,
        metrics.orderbookImbalance,
        metrics.microPrice,
        metrics.moveSinceMarketOpen,
        metrics.distanceToStrike,
        metrics.ticksToStrike,
        metrics.pmVsSpotDivergence,
        metrics.pmProbChangeVsSpotMove
      ];
      return sourceFeatureValues;
    });
    const upMidPrice = context.upPolymarketSignal.midPrice;
    const downMidPrice = context.downPolymarketSignal.midPrice;
    if (typeof upMidPrice !== "number" || typeof downMidPrice !== "number") {
      throw new Error("buildFeatures expected Polymarket mid prices to be numeric after context validation");
    }
    const featureRow: readonly number[] = [
      ...spotFeatureValues,
      upMidPrice,
      downMidPrice,
      context.upPolymarketSignal.spread,
      context.downPolymarketSignal.spread,
      context.upPolymarketSignal.imbalance,
      context.downPolymarketSignal.imbalance,
      context.upPolymarketSignal.aggressiveBuyRatio,
      context.pmProbUpDelta5s,
      context.strike,
      timeToExpirySeconds,
      timeToExpirySeconds * averageDistanceToStrike
    ];
    return featureRow;
  }

  private resolveMarketDelta(market: Pick<MarketRecord, "priceToBeat" | "finalPrice">): number {
    if (typeof market.priceToBeat !== "number") {
      throw new Error("buildTarget requires market.priceToBeat to be a number");
    }
    if (typeof market.finalPrice !== "number") {
      throw new Error("buildTarget requires market.finalPrice to be a number");
    }
    const marketDelta = market.finalPrice - market.priceToBeat;
    return marketDelta;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public buildFeatures(snapshots: readonly MarketSnapshot[]): readonly (readonly number[] | null)[] {
    const hasSnapshots = snapshots.length >= minimumSnapshotCount;
    let featureHistory = emptyFeatureHistory;
    if (hasSnapshots) {
      featureHistory = snapshots.map((_, index) => {
        const buildFeatureRowContext = this.resolveBuildFeatureRowContext(snapshots, index);
        const featureRow = buildFeatureRowContext === null ? null : this.buildFeatureRow(buildFeatureRowContext);
        return featureRow;
      });
    }
    return featureHistory;
  }

  public buildTarget(options: BuildTargetOptions): readonly number[] {
    if (options.sampleCount < minimumSnapshotCount) {
      throw new Error(`buildTarget requires sampleCount >= ${minimumSnapshotCount}`);
    }
    const marketDelta = this.resolveMarketDelta(options.market);
    const targetValues = Array.from({ length: options.sampleCount }, () => marketDelta);
    return targetValues;
  }

  /**
   * @section static:methods
   */

  // empty
}

const defaultFeatureTargetBuilder = FeatureTargetBuilder.create();

export function buildFeatures(snapshots: readonly MarketSnapshot[]): readonly (readonly number[] | null)[] {
  const featureHistory = defaultFeatureTargetBuilder.buildFeatures(snapshots);
  return featureHistory;
}

export function buildTarget(options: BuildTargetOptions): readonly number[] {
  const targetValues = defaultFeatureTargetBuilder.buildTarget(options);
  return targetValues;
}

export { featureOrder, featureSpecVersion, spotFeatureOrder, targetSpecVersion };
export type { BuildTargetOptions };
