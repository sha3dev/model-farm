/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { ModelListingService } from "../model-catalog/model-listing.service.ts";
import type { ListModelsOptions, PredictResult, PredictiveModel } from "../model-catalog/model-catalog.types.ts";

/**
 * @section consts
 */

const DEFAULT_MODEL_LISTING_SERVICE = ModelListingService.createDefault();

/**
 * @section types
 */

// empty

export async function listModels(options: ListModelsOptions): Promise<readonly PredictiveModel[]> {
  const predictiveModels = await DEFAULT_MODEL_LISTING_SERVICE.listModels(options);
  return predictiveModels;
}

export type { ListModelsOptions, PredictResult, PredictiveModel };
