/**
 * @section imports:externals
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @section imports:internals
 */

import { modelConfigSchema, type ModelConfig } from "../model-config.schema.ts";

/**
 * @section consts
 */

const CURRENT_DIRECTORY_PATH = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PRESET_DIRECTORY_NAME = "preset";

/**
 * @section types
 */

// empty

export class ModelConfigFileLoader {
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

  private readonly presetDirectoryPath: string;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(presetDirectoryPath: string) {
    this.presetDirectoryPath = presetDirectoryPath;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): ModelConfigFileLoader {
    const defaultPresetDirectoryPath = join(CURRENT_DIRECTORY_PATH, DEFAULT_PRESET_DIRECTORY_NAME);
    const loader = new ModelConfigFileLoader(defaultPresetDirectoryPath);
    return loader;
  }

  /**
   * @section private:methods
   */

  private resolvePresetFilePath(fileName: string): string {
    const absoluteFilePath = join(this.presetDirectoryPath, fileName);
    return absoluteFilePath;
  }

  private readRawPreset(fileName: string): unknown {
    const presetFilePath = this.resolvePresetFilePath(fileName);
    const presetFileContent = readFileSync(presetFilePath, "utf8");
    const rawPreset = JSON.parse(presetFileContent) as unknown;
    return rawPreset;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public loadByFileName(fileName: string): ModelConfig {
    const rawPreset = this.readRawPreset(fileName);
    const parsedConfig = modelConfigSchema.parse(rawPreset);
    return parsedConfig;
  }

  public loadManyByFileName(fileNames: readonly string[]): readonly ModelConfig[] {
    const parsedConfigs = fileNames.map((fileName) => {
      const config = this.loadByFileName(fileName);
      return config;
    });
    return parsedConfigs;
  }

  /**
   * @section static:methods
   */

  // empty
}
