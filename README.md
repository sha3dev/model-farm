# @sha3/model-farm

Local model catalog, persistence runtime, and feature/target builders for Polymarket crypto prediction models.

## TL;DR

```bash
npm install
npm run check
npm run build
```

```ts
import { listModels } from "@sha3/model-farm";

const models = await listModels({ asset: "btc", window: "5m" });
const bestModel = models[0];
const prediction = bestModel ? await bestModel.predict(currentWindowSnapshots) : null;
```

## Why this exists

This package is the local runtime around persisted prediction models.
It gives you three things:

- persisted artifacts on disk
- persisted model metadata and catalog state on disk
- importable APIs to list models and run inference without HTTP

It is designed for one machine or one private environment where another Node.js process can import the package directly.

## Compatibility

- Node.js 20+
- ESM only
- TypeScript-first package
- Persisted state stored in the local filesystem

## Quick Start

### Install

```bash
npm install
```

### Validate the workspace

```bash
npm run check
```

### Run the local runtime service

```bash
npm run start
```

This starts the local runtime loop for the fixed combinations:

- `btc/5m`
- `btc/15m`
- `eth/5m`
- `eth/15m`
- `sol/5m`
- `sol/15m`
- `xrp/5m`
- `xrp/15m`

Each combination is processed sequentially, while the runtime enforces a global concurrency limit so only `N` training combinations run at the same time.
The runtime now trains in batches of older windows and reserves a recent holdout block for backtesting, so training and evaluation do not reuse the same windows.
The runtime also persists a dedicated training-window registry so the same closed market window is never used twice for training the same model.

### Run one runtime cycle only

```bash
npm run start -- --run-once
```

This executes one discovery/training cycle and exits. Use it to verify runtime behavior without leaving a long-lived process running.

### Run a real collector validation pass

```bash
export CLICK_COLLECTOR_HOST=http://192.168.1.2:8123
export CLICK_COLLECTOR_USERNAME=default
export CLICK_COLLECTOR_PASSWORD=default
npm run validate:collector
```

This fetches closed BTC `5m` and `15m` markets from `@sha3/click-collector`, runs real `@tensorflow/tfjs-node` training plus model-backed backtesting, and writes JSON reports under `artifacts/validation`.

## Integration

### Install from another project

```bash
npm install @sha3/model-farm @sha3/click-collector
```

### List candidate models for one market family

```ts
import { listModels } from "@sha3/model-farm";

const models = await listModels({ asset: "btc", window: "5m" });
const bestModel = models[0] ?? null;
```

### Predict using snapshots from the current open window

```ts
import { listModels } from "@sha3/model-farm";
import type { MarketSnapshot } from "@sha3/click-collector";

export async function predictWithTopModel(snapshots: readonly MarketSnapshot[]) {
  const models = await listModels({ asset: "btc", window: "5m" });
  const bestModel = models[0] ?? null;
  let prediction = null;

  if (bestModel) {
    prediction = await bestModel.predict(snapshots);
  }

  return prediction;
}
```

## Public API Reference

### `listModels(options)`

Returns persisted models for one `asset/window`, sorted by score descending and then by most recent backtest.

```ts
import { listModels } from "@sha3/model-farm";

const models = await listModels({ asset: "btc", window: "5m", limit: 5, includeInactive: false });
```

`ListModelsOptions`

- `asset`: `"btc" | "eth" | "sol" | "xrp"`
- `window`: `"5m" | "15m"`
- `limit?`: maximum number of returned models
- `includeInactive?`: include models whose status is not `ready`

### `PredictiveModel`

Each returned model exposes:

- `modelId`
- `modelVersion`
- `asset`
- `window`
- `score`
- `trainingStats`
- `backtestStats`
- `predict(snapshots)`

### `predict(snapshots)`

Input requirements:

- snapshots must belong to the same `asset/window` as the model
- snapshots must be ordered by `snapshotTs` ascending
- snapshots must represent the current window history up to the present moment

Return behavior:

- returns `PredictResult` when the latest snapshot can be featurized
- returns `null` when there is not enough historical context yet
- throws an actionable error when the input sequence is malformed

### Feature builder exports

The package also exports:

- `buildFeatures`
- `buildTarget`
- `featureOrder`
- `spotFeatureOrder`
- `featureSpecVersion`
- `targetSpecVersion`
- `FeatureTargetBuilder`

Those exports are useful when you need the exact same feature/target contract in training, validation, offline analysis, or debugging.

### Validation runner exports

The package also exports:

- `CollectorValidationRunnerService`

Use it when you want to run a real collector-backed validation pass from another Node.js process without going through HTTP.

## Core Functions

This section documents the three core functions that define training and inference behavior.

### `buildFeatures(snapshots)`

Location:

- [feature-target-builder.ts](/Users/jc/Documents/GitHub/model-farm/src/dataset/feature-target-builder.ts)

Input:

- ordered snapshots for one market window
- in training, you pass the full closed window
- in prediction, you pass the snapshots accumulated so far in the current open window

Output:

- one feature row or `null` per snapshot
- shape: `readonly (readonly number[] | null)[]`

How it works:

1. The function iterates snapshots in time order.
2. For each snapshot, it only uses the current snapshot plus older snapshots from the same window.
3. It uses every spot source available for the current asset: `binance`, `coinbase`, `kraken`, `okx`, `chainlink`.
4. It combines per-source spot features, Polymarket book features, and source-vs-Polymarket interaction features.
5. It never uses future snapshots.
6. A row is discarded with `null` if there is not enough history for the required lookbacks or if a required orderbook payload is malformed.

### Current feature set

#### Spot market features

The builder emits the following block for every spot source:

- `spotBinanceMidPrice`, `spotCoinbaseMidPrice`, `spotKrakenMidPrice`, `spotOkxMidPrice`, `spotChainlinkMidPrice`
  - midpoint used as the source reference price
  - for exchange books this uses book midpoint when available and falls back to the price event
  - for `chainlink` this resolves to the price event because there is no orderbook
- `spotBinanceReturn1s`, `spotCoinbaseReturn1s`, `spotKrakenReturn1s`, `spotOkxReturn1s`, `spotChainlinkReturn1s`
  - relative return against the latest snapshot at or before `1s` ago
- `spotBinanceReturn5s`, `spotCoinbaseReturn5s`, `spotKrakenReturn5s`, `spotOkxReturn5s`, `spotChainlinkReturn5s`
  - relative return against the latest snapshot at or before `5s` ago
- `spotBinanceReturn20s`, `spotCoinbaseReturn20s`, `spotKrakenReturn20s`, `spotOkxReturn20s`, `spotChainlinkReturn20s`
  - relative return against the latest snapshot at or before `20s` ago
- `spotBinanceVolatility30s`, `spotCoinbaseVolatility30s`, `spotKrakenVolatility30s`, `spotOkxVolatility30s`, `spotChainlinkVolatility30s`
  - realized volatility of returns inside the last `30s`
- `spotBinanceOrderbookImbalance`, `spotCoinbaseOrderbookImbalance`, `spotKrakenOrderbookImbalance`, `spotOkxOrderbookImbalance`, `spotChainlinkOrderbookImbalance`
  - `(bidDepth - askDepth) / (bidDepth + askDepth)`
  - for `chainlink` this stays neutral because there is no orderbook
- `spotBinanceMicroprice`, `spotCoinbaseMicroprice`, `spotKrakenMicroprice`, `spotOkxMicroprice`, `spotChainlinkMicroprice`
  - liquidity-weighted price derived from the current source orderbook
  - for `chainlink` this falls back to the resolved midpoint
- `spotBinanceMoveSinceMarketOpen`, `spotCoinbaseMoveSinceMarketOpen`, `spotKrakenMoveSinceMarketOpen`, `spotOkxMoveSinceMarketOpen`, `spotChainlinkMoveSinceMarketOpen`
  - total move from the first snapshot of the current market window to now, per source
- `distanceToStrikeBinance`, `distanceToStrikeCoinbase`, `distanceToStrikeKraken`, `distanceToStrikeOkx`, `distanceToStrikeChainlink`
  - `(spotSourceMidPrice - strike) / strike`
- `ticksToStrikeBinance`, `ticksToStrikeCoinbase`, `ticksToStrikeKraken`, `ticksToStrikeOkx`, `ticksToStrikeChainlink`
  - `(spotSourceMidPrice - strike) / tickSize`
  - `tickSize` comes from the source orderbook when available and falls back to `1`
- `pmVsBinanceSpotDivergence`, `pmVsCoinbaseSpotDivergence`, `pmVsKrakenSpotDivergence`, `pmVsOkxSpotDivergence`, `pmVsChainlinkSpotDivergence`
  - `pmUpMid - sigmoid(spotSourceReturn20s)`
- `pmProbChangeVsBinanceMove`, `pmProbChangeVsCoinbaseMove`, `pmProbChangeVsKrakenMove`, `pmProbChangeVsOkxMove`, `pmProbChangeVsChainlinkMove`
  - `pmProbUpDelta5s - spotSourceReturn5s`

#### Polymarket features

- `pmUpMid`
  - midpoint of the UP token orderbook
  - falls back to the UP token price when no book is available
- `pmDownMid`
  - midpoint of the DOWN token orderbook
  - falls back to the DOWN token price when no book is available
- `pmUpSpread`
  - best ask minus best bid for the UP token
- `pmDownSpread`
  - best ask minus best bid for the DOWN token
- `pmUpOrderbookImbalance`
  - depth imbalance of the UP token orderbook
- `pmDownOrderbookImbalance`
  - depth imbalance of the DOWN token orderbook
- `pmAggressiveBuyRatio`
  - buy-pressure proxy derived from the UP token microprice position inside the spread
  - this is not true trade-aggressor flow because `click-collector` snapshots do not expose aggressor-side trades
- `pmProbUpDelta5s`
  - `pmUpMidNow - pmUpMid5sAgo`
  - uses the latest snapshot at or before `5s` ago

#### Market structure features

- `strike`
  - `priceToBeat` from the market snapshot
- `timeToExpirySeconds`
  - remaining seconds until market resolution
- `timeToExpiryDistanceToStrike`
  - `timeToExpirySeconds * averageDistanceToStrike`
  - `averageDistanceToStrike` is the mean of the per-source strike distances across all spot sources

### Contract details

- `spotFeatureOrder` is the canonical order of the per-source spot block
- `featureOrder` is the canonical full feature column order
- `featureSpecVersion` is derived from `featureOrder`
- any structural feature change must change `featureSpecVersion`
- training and prediction both use the exact same feature builder
- there are no cross-asset features
- if the current snapshot cannot satisfy the full feature contract, its row is `null`

### `buildTarget({ market, sampleCount })`

Location:

- [feature-target-builder.ts](/Users/jc/Documents/GitHub/model-farm/src/dataset/feature-target-builder.ts)

Input:

- `market.priceToBeat`
- `market.finalPrice`
- `sampleCount`

Output:

- one numeric target per valid training sample

How it works:

1. It validates that `priceToBeat` and `finalPrice` are numeric.
2. It computes one window-level delta: `finalPrice - priceToBeat`.
3. It repeats that value `sampleCount` times.

Why:

- the target belongs to the whole market window, not to each individual snapshot
- all valid snapshots inside the same window are learning the same final outcome

### `predict(snapshots)`

Location:

- [predictive-model.ts](/Users/jc/Documents/GitHub/model-farm/src/model-catalog/predictive-model.ts)

How it works:

1. Validates ordering and `asset/window` scope.
2. Calls `buildFeatures(snapshots)`.
3. Reads the latest valid row only.
4. Loads persisted artifact state from disk.
5. Produces a `PredictResult`.

Important runtime behavior:

- if the latest row is `null`, prediction returns `null`
- that means the runtime does not have enough historical context yet
- this avoids guessing before the feature contract can be satisfied

## Persistence Model

### Artifact path

```text
artifacts/models/<asset>/<window>/<modelId>/<modelVersion>/saved_model/model-state.json
```

### Metadata path

```text
artifacts/models/<asset>/<window>/<modelId>/<modelVersion>/metadata.json
```

### Global catalog path

```text
artifacts/registry/model-catalog.json
```

Persisted metadata includes at least:

- trained window count
- last trained window timestamps
- latest backtest stats
- score
- minimum snapshot count
- artifact path
- `featureSpecVersion`
- `targetSpecVersion`
- config hash

This lets the process restart without losing model state.

## Model Selection Semantics

`listModels` returns all persisted candidates for one `asset/window`.
The caller chooses which one to use.
The default strategy is normally:

1. request `listModels({ asset, window })`
2. take the first model
3. call `predict(snapshots)`

That first model is simply the highest-score candidate currently persisted.

## Runtime Logging

The service emits short operational logs intended for a human operator.

Key lines:

- `[training] start|finish ...`: training duration and snapshot counts
- `[backtest] start|finish ...`: backtest duration and evaluated sequence count
- `[model] asset/window ...`: one-line summary of the latest backtest

Example summary line:

```text
[model] btc/5m model=runtime-btc-5m-gru outcome=UP first-signal=UP at 04:36 conf=0.693 token=0.556 acc=1.000 auc=0.000 score=52.63 HIT
```

Meaning:

- `first-signal=UP`: first point in the holdout segment where the model crossed the relevant confidence threshold
- `at 04:36`: time offset from market open
- `token=0.556`: Polymarket token price for the predicted side at that moment
- `HIT` / `MISS`: whether that first relevant signal matched the final window outcome

Color output is enabled automatically when stdout is a TTY.

## Configuration Reference

Location:

- [config.ts](/Users/jc/Documents/GitHub/model-farm/src/config.ts)

Export:

- default `CONFIG`

Available constants:

- `MODEL_ARTIFACTS_ROOT_PATH`: root directory for model artifacts
- `MODEL_REGISTRY_DIRECTORY_PATH`: root directory for registry files
- `MODEL_REGISTRY_FILE_PATH`: main persisted catalog JSON path
- `TRAINING_WINDOW_REGISTRY_FILE_PATH`: persisted registry of `modelId + marketSlug` windows already consumed for training
- `MIN_MARKET_WINDOW_COVERAGE_RATIO`: minimum in-window coverage required before a market can be trained or backtested
- `MODEL_SERVICE_LOOP_DELAY_MS`: delay between runtime polling cycles per `asset/window`
- `MODEL_SERVICE_MAX_CONCURRENT_COMBINATIONS`: maximum number of concurrent training combinations the runtime will process
- `MODEL_TRAINING_BATCH_WINDOW_COUNT`: number of older closed windows consumed per training batch
- `MODEL_BACKTEST_HOLDOUT_WINDOW_COUNT`: number of latest closed windows reserved as holdout backtest data
- `MODEL_TRAINING_INTERVAL_MS`: scheduler cadence for training loops
- `MODEL_BACKTEST_INTERVAL_MS`: scheduler cadence for backtesting loops
- `MODEL_BACKTEST_RELEVANT_CONFIDENCE_THRESHOLD`: minimum `finalPriceProbUp` / `finalPriceProbDown` confidence required before the runtime logs the first meaningful signal for a window
- `MODEL_SCORE_AUC_WEIGHT`: score weight for AUC
- `MODEL_SCORE_F1_WEIGHT`: score weight for F1
- `MODEL_SCORE_LOG_LOSS_WEIGHT`: score weight for LogLoss contribution
- `MODEL_SCORE_RECENCY_WEIGHT`: score weight for recency
- `MODEL_SCORE_STABILITY_WEIGHT`: score weight for stability
- `CLICK_COLLECTOR_HOST`: ClickHouse endpoint used by `@sha3/click-collector`
- `CLICK_COLLECTOR_USERNAME`: ClickHouse username for validation runs
- `CLICK_COLLECTOR_PASSWORD`: ClickHouse password for validation runs
- `VALIDATION_REPORTS_ROOT_PATH`: root directory for persisted validation reports
- `VALIDATION_DEFAULT_MARKET_LIMIT`: default number of closed markets to validate per window
- `VALIDATION_RANDOM_SAMPLE_COUNT`: number of sampled valid rows persisted per market report

## Development Commands

```bash
npm run start
npm run start -- --run-once
npm run validate:collector
npm run build
npm run check
npm run fix
npm run test
```

## AI Usage

This repository is governed by [AGENTS.md](/Users/jc/Documents/GitHub/model-farm/AGENTS.md).
Any assistant working here should follow these rules first:

- apply the `class-first` profile unless there is a strong simplicity reason not to
- keep implementations as simple as current requirements allow
- avoid new abstraction layers unless they solve a present problem
- keep `buildFeatures`, `buildTarget`, and `predict` aligned with this README
- update tests for every behavior change
- run `npm run check` before finalizing work
- do not edit managed tooling files unless the user explicitly requests a standards refresh

## Current Gaps

The project is functional, but these are still intentionally unfinished areas:

- the runtime now uses `@tensorflow/tfjs-node` for training and prediction, but advanced callbacks and warm-start fine-tuning are still minimal
- backfill queueing and holdout scheduling are not implemented yet
- current scoring and backtesting logic is still a lightweight placeholder
- `pmAggressiveBuyRatio` is an orderbook-derived proxy, not true trade aggressor flow
