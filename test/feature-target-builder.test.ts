import * as assert from "node:assert/strict";
import { test } from "node:test";

import type { AssetSymbol, MarketEvent, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

import { buildFeatures, featureOrder, featureSpecVersion } from "../src/dataset/feature-target-builder.ts";

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

function createEmptySnapshotEventState() {
  const snapshotEventState = { price: null, orderbook: null };
  return snapshotEventState;
}

function createOrderbook(midPrice: number, bidSize: number, askSize: number, halfSpread: number): string {
  const orderbook = JSON.stringify({ bids: [[midPrice - halfSpread, bidSize]], asks: [[midPrice + halfSpread, askSize]] });
  return orderbook;
}

function createSnapshot(options: {
  snapshotTs: number;
  marketStartTs: number;
  marketEndTs: number;
  priceToBeat: number;
  upPrice: number;
  downPrice: number;
  upOrderbook?: string;
  downOrderbook?: string;
  binancePrice: number;
  coinbasePrice: number;
  krakenPrice: number;
  okxPrice: number;
  chainlinkPrice: number;
  binanceOrderbook?: string;
  coinbaseOrderbook?: string;
  krakenOrderbook?: string;
  okxOrderbook?: string;
}): MarketSnapshot {
  const marketSlug = "market-btc-5m";
  const upPriceEvent = createMarketEvent({ asset: "btc", window: "5m", marketSlug, tokenSide: "up", eventTs: options.snapshotTs, price: options.upPrice });
  const downPriceEvent = createMarketEvent({
    asset: "btc",
    window: "5m",
    marketSlug,
    tokenSide: "down",
    eventTs: options.snapshotTs,
    price: options.downPrice
  });
  const createSpotState = (sourceName: string, price: number, orderbook?: string) => {
    const sourceCategory = sourceName === "chainlink" ? "chainlink" : "exchange";
    const priceEvent = createMarketEvent({
      asset: "btc",
      window: "5m",
      marketSlug,
      tokenSide: null,
      eventTs: options.snapshotTs,
      price,
      sourceCategory,
      sourceName
    });
    const orderbookEvent =
      typeof orderbook === "string"
        ? createMarketEvent({
            asset: "btc",
            window: "5m",
            marketSlug,
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
  const marketSnapshot: MarketSnapshot = {
    triggerEvent: upPriceEvent,
    snapshotTs: options.snapshotTs,
    asset: "btc",
    window: "5m",
    marketStartTs: options.marketStartTs,
    marketEndTs: options.marketEndTs,
    priceToBeat: options.priceToBeat,
    crypto: {
      btc: {
        binance: createSpotState("binance", options.binancePrice, options.binanceOrderbook),
        coinbase: createSpotState("coinbase", options.coinbasePrice, options.coinbaseOrderbook),
        kraken: createSpotState("kraken", options.krakenPrice, options.krakenOrderbook),
        okx: createSpotState("okx", options.okxPrice, options.okxOrderbook),
        chainlink: createSpotState("chainlink", options.chainlinkPrice)
      },
      eth: {
        binance: createEmptySnapshotEventState(),
        coinbase: createEmptySnapshotEventState(),
        kraken: createEmptySnapshotEventState(),
        okx: createEmptySnapshotEventState(),
        chainlink: createEmptySnapshotEventState()
      },
      sol: {
        binance: createEmptySnapshotEventState(),
        coinbase: createEmptySnapshotEventState(),
        kraken: createEmptySnapshotEventState(),
        okx: createEmptySnapshotEventState(),
        chainlink: createEmptySnapshotEventState()
      },
      xrp: {
        binance: createEmptySnapshotEventState(),
        coinbase: createEmptySnapshotEventState(),
        kraken: createEmptySnapshotEventState(),
        okx: createEmptySnapshotEventState(),
        chainlink: createEmptySnapshotEventState()
      }
    },
    polymarket: {
      up: {
        price: upPriceEvent,
        orderbook:
          typeof options.upOrderbook === "string"
            ? createMarketEvent({
                asset: "btc",
                window: "5m",
                marketSlug,
                tokenSide: "up",
                eventTs: options.snapshotTs,
                price: null,
                orderbook: options.upOrderbook
              })
            : null
      },
      down: {
        price: downPriceEvent,
        orderbook:
          typeof options.downOrderbook === "string"
            ? createMarketEvent({
                asset: "btc",
                window: "5m",
                marketSlug,
                tokenSide: "down",
                eventTs: options.snapshotTs,
                price: null,
                orderbook: options.downOrderbook
              })
            : null
      }
    }
  };
  return marketSnapshot;
}

function findFeatureIndex(featureName: string): number {
  const featureIndex = featureOrder.indexOf(featureName);
  return featureIndex;
}

test("buildFeatures creates per-source spot features plus Polymarket and interaction features", () => {
  const marketStartTs = 1_700_000_000_000;
  const marketEndTs = marketStartTs + 300_000;
  const snapshots = Array.from({ length: 40 }, (_, index) => {
    const snapshotTs = marketStartTs + index * 1_000;
    const binanceMid = 100 + index * 0.5;
    const coinbaseMid = 100.2 + index * 0.5;
    const krakenMid = 99.9 + index * 0.5;
    const okxMid = 100.1 + index * 0.5;
    const chainlinkPrice = 100.05 + index * 0.5;
    const upMid = 0.52 + index * 0.001;
    const downMid = 0.48 - index * 0.001;
    const snapshot = createSnapshot({
      snapshotTs,
      marketStartTs,
      marketEndTs,
      priceToBeat: 102,
      upPrice: upMid,
      downPrice: downMid,
      upOrderbook: createOrderbook(upMid, 30, 10, 0.01),
      downOrderbook: createOrderbook(downMid, 18, 22, 0.01),
      binancePrice: binanceMid,
      coinbasePrice: coinbaseMid,
      krakenPrice: krakenMid,
      okxPrice: okxMid,
      chainlinkPrice,
      binanceOrderbook: createOrderbook(binanceMid, 12, 8, 0.5),
      coinbaseOrderbook: createOrderbook(coinbaseMid, 11, 9, 0.5),
      krakenOrderbook: createOrderbook(krakenMid, 13, 7, 0.5),
      okxOrderbook: createOrderbook(okxMid, 10, 10, 0.5)
    });
    return snapshot;
  });

  const features = buildFeatures(snapshots);
  const lastRow = features[30];
  if (!lastRow) {
    throw new Error("Expected the latest feature row to exist");
  }

  const spotBinanceMidPrice = lastRow[findFeatureIndex("spotBinanceMidPrice")];
  const spotCoinbaseMidPrice = lastRow[findFeatureIndex("spotCoinbaseMidPrice")];
  const spotKrakenMidPrice = lastRow[findFeatureIndex("spotKrakenMidPrice")];
  const spotOkxMidPrice = lastRow[findFeatureIndex("spotOkxMidPrice")];
  const spotChainlinkMidPrice = lastRow[findFeatureIndex("spotChainlinkMidPrice")];
  const spotBinanceReturn5s = lastRow[findFeatureIndex("spotBinanceReturn5s")];
  const spotChainlinkReturn20s = lastRow[findFeatureIndex("spotChainlinkReturn20s")];
  const spotBinanceOrderbookImbalance = lastRow[findFeatureIndex("spotBinanceOrderbookImbalance")];
  const spotChainlinkOrderbookImbalance = lastRow[findFeatureIndex("spotChainlinkOrderbookImbalance")];
  const distanceToStrikeBinance = lastRow[findFeatureIndex("distanceToStrikeBinance")];
  const ticksToStrikeCoinbase = lastRow[findFeatureIndex("ticksToStrikeCoinbase")];
  const pmUpMid = lastRow[findFeatureIndex("pmUpMid")];
  const pmDownMid = lastRow[findFeatureIndex("pmDownMid")];
  const pmProbUpDelta5s = lastRow[findFeatureIndex("pmProbUpDelta5s")];
  const strike = lastRow[findFeatureIndex("strike")];
  const timeToExpirySeconds = lastRow[findFeatureIndex("timeToExpirySeconds")];

  assert.equal(features[0], null);
  assert.equal(lastRow.length, featureOrder.length);
  assert.equal(spotBinanceMidPrice, 115);
  assert.equal(spotCoinbaseMidPrice, 115.2);
  assert.equal(spotKrakenMidPrice, 114.9);
  assert.equal(spotOkxMidPrice, 115.1);
  assert.equal(spotChainlinkMidPrice, 115.05);
  assert.ok(Math.abs((spotBinanceReturn5s ?? 0) - 2.5 / 112.5) < 0.000000001);
  assert.ok(Math.abs((spotChainlinkReturn20s ?? 0) - 10 / 105.05) < 0.000000001);
  assert.equal(spotBinanceOrderbookImbalance, (12 - 8) / 20);
  assert.equal(spotChainlinkOrderbookImbalance, 0);
  assert.ok(Math.abs((distanceToStrikeBinance ?? 0) - 13 / 102) < 0.000000001);
  assert.ok(Math.abs((ticksToStrikeCoinbase ?? 0) - 13.2) < 0.000000001);
  assert.ok(Math.abs((pmUpMid ?? 0) - 0.55) < 0.000000001);
  assert.ok(Math.abs((pmDownMid ?? 0) - 0.45) < 0.000000001);
  assert.ok(Math.abs((pmProbUpDelta5s ?? 0) - 0.005) < 0.000000001);
  assert.equal(strike, 102);
  assert.equal(timeToExpirySeconds, 270);
  assert.equal(typeof featureSpecVersion, "string");
  assert.equal(featureSpecVersion.length, 12);
});

test("buildFeatures discards a snapshot when a required orderbook payload is invalid", () => {
  const marketStartTs = 1_700_000_000_000;
  const marketEndTs = marketStartTs + 300_000;
  const snapshots = Array.from({ length: 31 }, (_, index) => {
    const snapshotTs = marketStartTs + index * 1_000;
    const binanceMid = 100 + index * 0.5;
    const coinbaseMid = 100.2 + index * 0.5;
    const krakenMid = 99.9 + index * 0.5;
    const okxMid = 100.1 + index * 0.5;
    const chainlinkPrice = 100.05 + index * 0.5;
    const upMid = 0.52 + index * 0.001;
    const downMid = 0.48 - index * 0.001;
    const snapshot = createSnapshot({
      snapshotTs,
      marketStartTs,
      marketEndTs,
      priceToBeat: 102,
      upPrice: upMid,
      downPrice: downMid,
      upOrderbook: index === 30 ? "{invalid-json" : createOrderbook(upMid, 30, 10, 0.01),
      downOrderbook: createOrderbook(downMid, 18, 22, 0.01),
      binancePrice: binanceMid,
      coinbasePrice: coinbaseMid,
      krakenPrice: krakenMid,
      okxPrice: okxMid,
      chainlinkPrice,
      binanceOrderbook: createOrderbook(binanceMid, 12, 8, 0.5),
      coinbaseOrderbook: createOrderbook(coinbaseMid, 11, 9, 0.5),
      krakenOrderbook: createOrderbook(krakenMid, 13, 7, 0.5),
      okxOrderbook: createOrderbook(okxMid, 10, 10, 0.5)
    });
    return snapshot;
  });

  const features = buildFeatures(snapshots);

  assert.equal(features[30], null);
});

test("buildFeatures parses object-shaped orderbooks from click-collector payloads", () => {
  const marketStartTs = 1_700_000_000_000;
  const marketEndTs = marketStartTs + 300_000;
  const createObjectOrderbook = (midPrice: number, bidSize: number, askSize: number, halfSpread: number): string => {
    const orderbook = JSON.stringify({ bids: [{ price: midPrice - halfSpread, size: bidSize }], asks: [{ price: midPrice + halfSpread, size: askSize }] });
    return orderbook;
  };
  const snapshots = Array.from({ length: 31 }, (_, index) => {
    const snapshotTs = marketStartTs + index * 1_000;
    const binanceMid = 100 + index * 0.5;
    const upMid = 0.52 + index * 0.001;
    const downMid = 0.48 - index * 0.001;
    const snapshot = createSnapshot({
      snapshotTs,
      marketStartTs,
      marketEndTs,
      priceToBeat: 102,
      upPrice: upMid,
      downPrice: downMid,
      upOrderbook: createObjectOrderbook(upMid, 30, 10, 0.01),
      downOrderbook: createObjectOrderbook(downMid, 18, 22, 0.01),
      binancePrice: binanceMid,
      coinbasePrice: binanceMid + 0.2,
      krakenPrice: binanceMid - 0.1,
      okxPrice: binanceMid + 0.1,
      chainlinkPrice: binanceMid + 0.05,
      binanceOrderbook: createObjectOrderbook(binanceMid, 12, 8, 0.5),
      coinbaseOrderbook: createObjectOrderbook(binanceMid + 0.2, 11, 9, 0.5),
      krakenOrderbook: createObjectOrderbook(binanceMid - 0.1, 13, 7, 0.5),
      okxOrderbook: createObjectOrderbook(binanceMid + 0.1, 10, 10, 0.5)
    });
    return snapshot;
  });

  const features = buildFeatures(snapshots);
  const lastRow = features[30];
  if (!lastRow) {
    throw new Error("Expected object-orderbook feature row to exist");
  }

  assert.equal(lastRow[findFeatureIndex("spotBinanceOrderbookImbalance")], (12 - 8) / 20);
  assert.equal(lastRow[findFeatureIndex("pmUpOrderbookImbalance")], (30 - 10) / 40);
  assert.equal(lastRow[findFeatureIndex("pmAggressiveBuyRatio")], 0.75);
  assert.ok(Math.abs((lastRow[findFeatureIndex("pmUpSpread")] ?? 0) - 0.02) < 0.000000001);
});

test("buildFeatures uses first available source snapshot for moveSinceMarketOpen", () => {
  const marketStartTs = 1_700_000_000_000;
  const marketEndTs = marketStartTs + 300_000;
  const snapshots = Array.from({ length: 40 }, (_, index) => {
    const snapshotTs = marketStartTs + index * 1_000;
    const binancePrice = index < 5 ? 0 : 100 + index * 0.5;
    const snapshotOptions = {
      snapshotTs,
      marketStartTs,
      marketEndTs,
      priceToBeat: 102,
      upPrice: 0.52 + index * 0.001,
      downPrice: 0.48 - index * 0.001,
      upOrderbook: createOrderbook(0.52 + index * 0.001, 30, 10, 0.01),
      downOrderbook: createOrderbook(0.48 - index * 0.001, 18, 22, 0.01),
      binancePrice,
      coinbasePrice: 100.2 + index * 0.5,
      krakenPrice: 99.9 + index * 0.5,
      okxPrice: 100.1 + index * 0.5,
      chainlinkPrice: 100.05 + index * 0.5,
      ...(index < 5 ? {} : { binanceOrderbook: createOrderbook(binancePrice, 12, 8, 0.5) }),
      coinbaseOrderbook: createOrderbook(100.2 + index * 0.5, 11, 9, 0.5),
      krakenOrderbook: createOrderbook(99.9 + index * 0.5, 13, 7, 0.5),
      okxOrderbook: createOrderbook(100.1 + index * 0.5, 10, 10, 0.5)
    };
    const snapshot = createSnapshot(snapshotOptions);
    if (index < 5) {
      snapshot.crypto.btc.binance.price = null;
      snapshot.crypto.btc.binance.orderbook = null;
    }
    return snapshot;
  });

  const features = buildFeatures(snapshots);
  const firstValidRow = [...features].reverse().find((featureRow) => featureRow !== null) ?? null;
  if (!firstValidRow) {
    throw new Error("Expected at least one valid feature row for moveSinceMarketOpen test");
  }

  const moveSinceOpen = firstValidRow[findFeatureIndex("spotBinanceMoveSinceMarketOpen")];
  assert.notEqual(moveSinceOpen, 0);
});
