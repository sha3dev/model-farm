/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import type { ModelConfig } from "../model-config.schema.ts";
import { ModelConfigFileLoader } from "./model-config-file-loader.ts";

/**
 * @section consts
 */

const MODEL_CONFIG_PRESET_FILE_NAMES: readonly string[] = ["gru-5m.model-config.json", "gru-15m.model-config.json"];
const MODEL_CONFIG_FILE_LOADER = ModelConfigFileLoader.createDefault();
const LOADED_MODEL_CONFIGS = MODEL_CONFIG_FILE_LOADER.loadManyByFileName(MODEL_CONFIG_PRESET_FILE_NAMES);
const GRU_5M_LOADED_MODEL_CONFIG = LOADED_MODEL_CONFIGS[0];
const GRU_15M_LOADED_MODEL_CONFIG = LOADED_MODEL_CONFIGS[1];

/**
 * @section types
 */

// empty

if (!GRU_5M_LOADED_MODEL_CONFIG || !GRU_15M_LOADED_MODEL_CONFIG) {
  throw new Error("Failed to load required model presets: gru-5m.model-config.json and gru-15m.model-config.json");
}

export const gru5mModelConfig: ModelConfig = GRU_5M_LOADED_MODEL_CONFIG;
export const gru15mModelConfig: ModelConfig = GRU_15M_LOADED_MODEL_CONFIG;
export const modelConfigCatalog: readonly ModelConfig[] = [gru5mModelConfig, gru15mModelConfig];
export const modelConfigById: ReadonlyMap<string, ModelConfig> = new Map(modelConfigCatalog.map((config) => [config.modelId, config]));
