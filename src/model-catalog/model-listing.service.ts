/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { ModelConfigResolverService } from "../model/model-config-resolver.service.ts";
import { TensorflowSequenceDatasetService } from "../training/tensorflow-sequence-dataset.service.ts";
import { TensorflowRuntimeService } from "../training/tensorflow-runtime.service.ts";
import { ModelArtifactRepository } from "./model-artifact.repository.ts";
import { ModelCatalogRepository } from "./model-catalog.repository.ts";
import { PredictiveModel } from "./predictive-model.ts";
import type { ListModelsOptions, PersistedModelCatalogItem } from "./model-catalog.types.ts";

/**
 * @section consts
 */

const DEFAULT_MODEL_LIMIT = 50;

/**
 * @section types
 */

type ModelListingServiceOptions = {
  catalogRepository: ModelCatalogRepository;
  artifactRepository: ModelArtifactRepository;
  modelConfigResolverService?: ModelConfigResolverService;
  tensorflowSequenceDatasetService?: TensorflowSequenceDatasetService;
  tensorflowRuntimeService?: TensorflowRuntimeService;
};

export class ModelListingService {
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

  private readonly catalogRepository: ModelCatalogRepository;
  private readonly artifactRepository: ModelArtifactRepository;
  private readonly modelConfigResolverService: ModelConfigResolverService;
  private readonly tensorflowSequenceDatasetService: TensorflowSequenceDatasetService;
  private readonly tensorflowRuntimeService: TensorflowRuntimeService;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: ModelListingServiceOptions) {
    this.catalogRepository = options.catalogRepository;
    this.artifactRepository = options.artifactRepository;
    this.modelConfigResolverService = options.modelConfigResolverService ?? ModelConfigResolverService.create();
    this.tensorflowSequenceDatasetService = options.tensorflowSequenceDatasetService ?? TensorflowSequenceDatasetService.create();
    this.tensorflowRuntimeService = options.tensorflowRuntimeService ?? TensorflowRuntimeService.create();
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): ModelListingService {
    const modelListingService = new ModelListingService({
      catalogRepository: ModelCatalogRepository.createDefault(),
      artifactRepository: ModelArtifactRepository.createDefault(),
      modelConfigResolverService: ModelConfigResolverService.create(),
      tensorflowSequenceDatasetService: TensorflowSequenceDatasetService.create(),
      tensorflowRuntimeService: TensorflowRuntimeService.create()
    });
    return modelListingService;
  }

  public static create(options: ModelListingServiceOptions): ModelListingService {
    const modelListingService = new ModelListingService(options);
    return modelListingService;
  }

  /**
   * @section private:methods
   */

  private sortModelsByScore(items: readonly PersistedModelCatalogItem[]): PersistedModelCatalogItem[] {
    const sortedItems = [...items].sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      const leftTs = left.backtestStats.lastRunTs ?? 0;
      const rightTs = right.backtestStats.lastRunTs ?? 0;
      return rightTs - leftTs;
    });
    return sortedItems;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public async listModels(options: ListModelsOptions): Promise<readonly PredictiveModel[]> {
    const catalog = this.catalogRepository.readCatalog();
    const filteredModels = catalog.models.filter((item) => {
      const isSameAsset = item.asset === options.asset;
      const isSameWindow = item.window === options.window;
      const includeInactive = options.includeInactive ?? false;
      const isAllowedStatus = includeInactive ? true : item.status === "ready";
      const shouldKeep = isSameAsset && isSameWindow && isAllowedStatus;
      return shouldKeep;
    });
    const sortedModels = this.sortModelsByScore(filteredModels);
    const limit = options.limit ?? DEFAULT_MODEL_LIMIT;
    const selectedModels = sortedModels.slice(0, limit);
    const models = selectedModels.map((item) => {
      const model = PredictiveModel.create({
        modelId: item.modelId,
        modelVersion: item.modelVersion,
        asset: item.asset,
        window: item.window,
        score: item.score,
        trainingStats: item.trainingStats,
        backtestStats: item.backtestStats,
        minimumSnapshotCount: item.minimumSnapshotCount,
        artifactPath: item.artifactPath,
        artifactRepository: this.artifactRepository,
        modelConfigResolverService: this.modelConfigResolverService,
        tensorflowSequenceDatasetService: this.tensorflowSequenceDatasetService,
        tensorflowRuntimeService: this.tensorflowRuntimeService
      });
      return model;
    });
    return models;
  }

  /**
   * @section static:methods
   */

  // empty
}
