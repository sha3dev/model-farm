/**
 * @section imports:externals
 */

import type { AssetSymbol, MarketRecord, MarketWindow } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import type { ClickCollectorGateway } from "../data-source/click-collector.gateway.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

type SelectMarketsOptions = { asset: AssetSymbol; window: MarketWindow; limit: number; nowTs: number };
type CollectorValidationMarketSelectorServiceOptions = { gateway: ClickCollectorGateway };
type GatewayMarket = Awaited<ReturnType<ClickCollectorGateway["listMarkets"]>>[number];

export class CollectorValidationMarketSelectorService {
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

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: CollectorValidationMarketSelectorServiceOptions) {
    this.gateway = options.gateway;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static create(options: CollectorValidationMarketSelectorServiceOptions): CollectorValidationMarketSelectorService {
    const service = new CollectorValidationMarketSelectorService(options);
    return service;
  }

  /**
   * @section private:methods
   */

  private isClosedMarket(market: GatewayMarket, nowTs: number): boolean {
    const isClosedMarket = market.marketEndTs < nowTs;
    return isClosedMarket;
  }

  private hasResolvedTarget(market: GatewayMarket): boolean {
    const hasResolvedTarget = typeof market.priceToBeat === "number" && typeof market.finalPrice === "number";
    return hasResolvedTarget;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async selectMarkets(options: SelectMarketsOptions): Promise<readonly MarketRecord[]> {
    const markets = await this.gateway.listMarkets(options.window, options.asset);
    const selectedMarkets = markets
      .filter((market) => this.isClosedMarket(market, options.nowTs) && this.hasResolvedTarget(market))
      .sort((leftMarket, rightMarket) => leftMarket.marketStartTs - rightMarket.marketStartTs)
      .slice(0, options.limit);
    return selectedMarkets;
  }

  /**
   * @section static:methods
   */

  // empty
}
