/**
 * @section imports:externals
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

import type { AssetSymbol, MarketWindow } from "@sha3/click-collector";

type PersistedTrainingWindowRegistryItem = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  marketSlug: string;
  marketStartTs: number;
  marketEndTs: number;
  status: "trained" | "skipped";
  reason: string | null;
  persistedAtTs: number;
};

type PersistedTrainingWindowRegistry = { generatedAtTs: number; items: PersistedTrainingWindowRegistryItem[] };

type MarkWindowConsumedOptions = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  marketSlug: string;
  marketStartTs: number;
  marketEndTs: number;
};

type MarkWindowSkippedOptions = {
  modelId: string;
  modelVersion: string;
  asset: AssetSymbol;
  window: MarketWindow;
  marketSlug: string;
  marketStartTs: number;
  marketEndTs: number;
  reason: string;
};

export class TrainingWindowRegistryRepository {
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

  private readonly registryFilePath: string;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(registryFilePath: string) {
    this.registryFilePath = registryFilePath;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): TrainingWindowRegistryRepository {
    const repository = new TrainingWindowRegistryRepository(CONFIG.TRAINING_WINDOW_REGISTRY_FILE_PATH);
    return repository;
  }

  public static create(registryFilePath: string): TrainingWindowRegistryRepository {
    const repository = new TrainingWindowRegistryRepository(registryFilePath);
    return repository;
  }

  /**
   * @section private:methods
   */

  private ensureRegistryDirectory(): void {
    const registryDirectoryPath = dirname(this.registryFilePath);
    mkdirSync(registryDirectoryPath, { recursive: true });
  }

  private createEmptyRegistry(): PersistedTrainingWindowRegistry {
    const emptyRegistry: PersistedTrainingWindowRegistry = { generatedAtTs: Date.now(), items: [] };
    return emptyRegistry;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public readRegistry(): PersistedTrainingWindowRegistry {
    this.ensureRegistryDirectory();
    const hasRegistryFile = existsSync(this.registryFilePath);
    const registry = hasRegistryFile
      ? (JSON.parse(readFileSync(this.registryFilePath, "utf8")) as PersistedTrainingWindowRegistry)
      : this.createEmptyRegistry();
    return registry;
  }

  public writeRegistry(registry: PersistedTrainingWindowRegistry): void {
    this.ensureRegistryDirectory();
    const serializedRegistry = JSON.stringify(registry, null, 2);
    writeFileSync(this.registryFilePath, serializedRegistry, "utf8");
  }

  public hasConsumedWindow(modelId: string, marketSlug: string): boolean {
    const registry = this.readRegistry();
    const hasConsumedWindow = registry.items.some((item) => item.modelId === modelId && item.marketSlug === marketSlug && item.status === "trained");
    return hasConsumedWindow;
  }

  public hasProcessedWindow(modelId: string, marketSlug: string): boolean {
    const registry = this.readRegistry();
    const hasProcessedWindow = registry.items.some((item) => item.modelId === modelId && item.marketSlug === marketSlug);
    return hasProcessedWindow;
  }

  public markWindowConsumed(options: MarkWindowConsumedOptions): PersistedTrainingWindowRegistry {
    const currentRegistry = this.readRegistry();
    const nextItems = currentRegistry.items.filter((item) => !(item.modelId === options.modelId && item.marketSlug === options.marketSlug));
    const nextItem: PersistedTrainingWindowRegistryItem = { ...options, status: "trained", reason: null, persistedAtTs: Date.now() };
    nextItems.push(nextItem);
    const nextRegistry: PersistedTrainingWindowRegistry = { generatedAtTs: Date.now(), items: nextItems };
    this.writeRegistry(nextRegistry);
    return nextRegistry;
  }

  public markWindowSkipped(options: MarkWindowSkippedOptions): PersistedTrainingWindowRegistry {
    const currentRegistry = this.readRegistry();
    const nextItems = currentRegistry.items.filter((item) => !(item.modelId === options.modelId && item.marketSlug === options.marketSlug));
    const nextItem: PersistedTrainingWindowRegistryItem = { ...options, status: "skipped", reason: options.reason, persistedAtTs: Date.now() };
    nextItems.push(nextItem);
    const nextRegistry: PersistedTrainingWindowRegistry = { generatedAtTs: Date.now(), items: nextItems };
    this.writeRegistry(nextRegistry);
    return nextRegistry;
  }

  public getRegistryFilePath(): string {
    const registryFilePath = this.registryFilePath;
    return registryFilePath;
  }

  /**
   * @section static:methods
   */

  // empty
}
