/**
 * @section imports:externals
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import type { ModelArtifactState } from "./model-catalog.types.ts";

/**
 * @section consts
 */

const MODEL_STATE_FILE_NAME = "model-state.json";

/**
 * @section types
 */

type SaveArtifactOptions = { artifactPath: string; state: ModelArtifactState };

export class ModelArtifactRepository {
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

  private readonly artifactsRootPath: string;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(artifactsRootPath: string) {
    this.artifactsRootPath = artifactsRootPath;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): ModelArtifactRepository {
    const repository = new ModelArtifactRepository(CONFIG.MODEL_ARTIFACTS_ROOT_PATH);
    return repository;
  }

  /**
   * @section private:methods
   */

  private resolveModelStateFilePath(artifactPath: string): string {
    const stateFilePath = join(artifactPath, MODEL_STATE_FILE_NAME);
    return stateFilePath;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public ensureArtifactPath(artifactPath: string): void {
    mkdirSync(artifactPath, { recursive: true });
  }

  public saveArtifact(options: SaveArtifactOptions): void {
    this.ensureArtifactPath(options.artifactPath);
    const stateFilePath = this.resolveModelStateFilePath(options.artifactPath);
    const serializedState = JSON.stringify(options.state, null, 2);
    writeFileSync(stateFilePath, serializedState, "utf8");
  }

  public readArtifactState(artifactPath: string): ModelArtifactState {
    const stateFilePath = this.resolveModelStateFilePath(artifactPath);
    const serializedState = readFileSync(stateFilePath, "utf8");
    const parsedState = JSON.parse(serializedState) as ModelArtifactState;
    return parsedState;
  }

  public buildArtifactPath(asset: string, window: string, modelId: string, modelVersion: string): string {
    const artifactPath = join(this.artifactsRootPath, asset, window, modelId, modelVersion, "saved_model");
    return artifactPath;
  }

  public ensureRootPath(): void {
    mkdirSync(this.artifactsRootPath, { recursive: true });
  }

  /**
   * @section static:methods
   */

  // empty
}
