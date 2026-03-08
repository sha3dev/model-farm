/**
 * @section imports:externals
 */

import type { MarketEventsQueryService } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

import type { AssetSymbol, MarketRecord, MarketSnapshot, MarketWindow } from "@sha3/click-collector";

type ClickCollectorQueryService = Pick<MarketEventsQueryService, "listMarkets" | "getMarketSnapshots">;
type ClickCollectorGatewayOptions = { queryService: ClickCollectorQueryService };
type ClickCollectorConnectionOptions = { host: string; username: string; password: string };

export class ClickCollectorGateway {
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

  private readonly queryService: ClickCollectorQueryService;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: ClickCollectorGatewayOptions) {
    this.queryService = options.queryService;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static async createDefault(): Promise<ClickCollectorGateway> {
    const clickCollectorModule = await import("@sha3/click-collector");
    const gateway = new ClickCollectorGateway({ queryService: clickCollectorModule.MarketEventsQueryService.createDefault() });
    return gateway;
  }

  public static async createFromConfig(): Promise<ClickCollectorGateway> {
    const connectionOptions: ClickCollectorConnectionOptions = {
      host: CONFIG.CLICK_COLLECTOR_HOST,
      username: CONFIG.CLICK_COLLECTOR_USERNAME,
      password: CONFIG.CLICK_COLLECTOR_PASSWORD
    };
    process.env.CLICKHOUSE_HOST = connectionOptions.host;
    process.env.CLICKHOUSE_USER = connectionOptions.username;
    process.env.CLICKHOUSE_PASSWORD = connectionOptions.password;
    const clickCollectorModule = await import("@sha3/click-collector");
    const gateway = new ClickCollectorGateway({ queryService: clickCollectorModule.MarketEventsQueryService.createDefault() });
    return gateway;
  }

  /**
   * @section private:methods
   */

  // empty

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async listMarkets(window: MarketWindow, asset: AssetSymbol): Promise<MarketRecord[]> {
    const markets = await this.queryService.listMarkets(window, asset);
    return markets;
  }

  public async getWindowSnapshotsBySlug(slug: string): Promise<MarketSnapshot[]> {
    const snapshots = await this.queryService.getMarketSnapshots(slug);
    return snapshots;
  }

  /**
   * @section static:methods
   */

  // empty
}

export type { ClickCollectorConnectionOptions };
