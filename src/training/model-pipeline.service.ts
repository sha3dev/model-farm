/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { BacktestOrchestratorService } from "../backtest/backtest-orchestrator.service.ts";
import { TrainingOrchestratorService, type TrainingJob } from "./training-orchestrator.service.ts";

/**
 * @section consts
 */

// empty

/**
 * @section types
 */

import type { MarketRecord, MarketSnapshot } from "@sha3/click-collector";

type ModelPipelineServiceOptions = { trainingOrchestrator: TrainingOrchestratorService; backtestOrchestrator: BacktestOrchestratorService };

type ModelPipelineStartOptions = {
  trainingJobProvider: () => Promise<readonly TrainingJob[]>;
  backtestSnapshotProvider: (
    modelId: string,
    modelVersion: string
  ) => Promise<{ snapshots: readonly MarketSnapshot[]; market: Pick<MarketRecord, "priceToBeat" | "finalPrice"> }>;
};

export class ModelPipelineService {
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

  private readonly trainingOrchestrator: TrainingOrchestratorService;
  private readonly backtestOrchestrator: BacktestOrchestratorService;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(options: ModelPipelineServiceOptions) {
    this.trainingOrchestrator = options.trainingOrchestrator;
    this.backtestOrchestrator = options.backtestOrchestrator;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): ModelPipelineService {
    const service = new ModelPipelineService({
      trainingOrchestrator: TrainingOrchestratorService.createDefault(),
      backtestOrchestrator: BacktestOrchestratorService.createDefault()
    });
    return service;
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

  public async start(options: ModelPipelineStartOptions): Promise<void> {
    await this.trainingOrchestrator.start({ jobProvider: options.trainingJobProvider });
    await this.backtestOrchestrator.start({ snapshotProvider: options.backtestSnapshotProvider });
  }

  public stop(): void {
    this.trainingOrchestrator.stop();
    this.backtestOrchestrator.stop();
  }

  /**
   * @section static:methods
   */

  // empty
}

export type { ModelPipelineStartOptions };
