/**
 * @section imports:externals
 */

import type { MarketWindow } from "@sha3/click-collector";

/**
 * @section imports:internals
 */

import { gru15mModelConfig, gru5mModelConfig } from "./configuration/model-config.catalog.ts";
import type { ModelConfig } from "./model-config.schema.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

// empty

export class ModelConfigResolverService {
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

  public static create(): ModelConfigResolverService {
    const modelConfigResolverService = new ModelConfigResolverService();
    return modelConfigResolverService;
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

  public resolveByWindow(window: MarketWindow): ModelConfig {
    let modelConfig: ModelConfig;
    if (window === "5m") {
      modelConfig = gru5mModelConfig;
    } else {
      modelConfig = gru15mModelConfig;
    }
    return modelConfig;
  }

  /**
   * @section static:methods
   */

  // empty
}
