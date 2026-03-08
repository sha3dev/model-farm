/**
 * @section imports:externals
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import type { PersistedModelCatalog, PersistedModelCatalogItem } from "./model-catalog.types.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

// empty

export class ModelCatalogRepository {
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

  private readonly catalogFilePath: string;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(catalogFilePath: string) {
    this.catalogFilePath = catalogFilePath;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): ModelCatalogRepository {
    const repository = new ModelCatalogRepository(CONFIG.MODEL_REGISTRY_FILE_PATH);
    return repository;
  }

  /**
   * @section private:methods
   */

  private ensureCatalogDirectory(): void {
    const catalogDirectoryPath = dirname(this.catalogFilePath);
    mkdirSync(catalogDirectoryPath, { recursive: true });
  }

  private createEmptyCatalog(): PersistedModelCatalog {
    const emptyCatalog: PersistedModelCatalog = { generatedAtTs: Date.now(), models: [] };
    return emptyCatalog;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public readCatalog(): PersistedModelCatalog {
    this.ensureCatalogDirectory();
    const hasCatalogFile = existsSync(this.catalogFilePath);
    const defaultCatalog = this.createEmptyCatalog();
    const catalog = hasCatalogFile ? (JSON.parse(readFileSync(this.catalogFilePath, "utf8")) as PersistedModelCatalog) : defaultCatalog;
    return catalog;
  }

  public writeCatalog(catalog: PersistedModelCatalog): void {
    this.ensureCatalogDirectory();
    const serializedCatalog = JSON.stringify(catalog, null, 2);
    writeFileSync(this.catalogFilePath, serializedCatalog, "utf8");
  }

  public upsertModel(item: PersistedModelCatalogItem): PersistedModelCatalog {
    const currentCatalog = this.readCatalog();
    const nextModels = currentCatalog.models.filter((model) => {
      return !(model.modelId === item.modelId && model.modelVersion === item.modelVersion);
    });
    nextModels.push(item);
    const nextCatalog: PersistedModelCatalog = { generatedAtTs: Date.now(), models: nextModels };
    this.writeCatalog(nextCatalog);
    return nextCatalog;
  }

  public getCatalogFilePath(): string {
    const catalogFilePath = this.catalogFilePath;
    return catalogFilePath;
  }

  /**
   * @section static:methods
   */

  // empty
}
