/**
 * @section imports:externals
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * @section imports:internals
 */

import type { PersistedModelMetadata } from "./model-catalog.types.ts";

/**
 * @section consts
 */

const METADATA_FILE_NAME = "metadata.json";

/**
 * @section types
 */

// empty

export class ModelMetadataRepository {
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

  public static create(): ModelMetadataRepository {
    const repository = new ModelMetadataRepository();
    return repository;
  }

  /**
   * @section private:methods
   */

  private ensureMetadataDirectory(metadataPath: string): void {
    const metadataDirectoryPath = dirname(metadataPath);
    mkdirSync(metadataDirectoryPath, { recursive: true });
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public buildMetadataPath(artifactPath: string): string {
    const metadataPath = join(dirname(artifactPath), METADATA_FILE_NAME);
    return metadataPath;
  }

  public writeMetadata(metadataPath: string, metadata: PersistedModelMetadata): void {
    this.ensureMetadataDirectory(metadataPath);
    const serializedMetadata = JSON.stringify(metadata, null, 2);
    writeFileSync(metadataPath, serializedMetadata, "utf8");
  }

  public readMetadata(metadataPath: string): PersistedModelMetadata {
    const serializedMetadata = readFileSync(metadataPath, "utf8");
    const parsedMetadata = JSON.parse(serializedMetadata) as PersistedModelMetadata;
    return parsedMetadata;
  }

  /**
   * @section static:methods
   */

  // empty
}
