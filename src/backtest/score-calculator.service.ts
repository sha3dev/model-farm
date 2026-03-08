/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import type { BacktestStats } from "../model-catalog/model-catalog.types.ts";

/**
 * @section consts
 */

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;

/**
 * @section types
 */

type CalculateScoreOptions = { backtestStats: BacktestStats; trainedAtTs: number | null; stabilityFactor: number; overfitPenalty: number };

export class ScoreCalculatorService {
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

  public static create(): ScoreCalculatorService {
    const service = new ScoreCalculatorService();
    return service;
  }

  /**
   * @section private:methods
   */

  private normalizeMetric(value: number | null): number {
    const normalized = value === null ? 0 : Math.min(Math.max(value, 0), 1);
    return normalized;
  }

  private calculateRecencyFactor(trainedAtTs: number | null): number {
    const nowTs = Date.now();
    const ageHours = trainedAtTs === null ? Number.POSITIVE_INFINITY : (nowTs - trainedAtTs) / MILLISECONDS_PER_HOUR;
    const recencyFactor = ageHours === Number.POSITIVE_INFINITY ? 0 : Math.max(0, 1 - ageHours / 24);
    return recencyFactor;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public calculateScore(options: CalculateScoreOptions): number {
    const normalizedAuc = this.normalizeMetric(options.backtestStats.auc);
    const normalizedF1 = this.normalizeMetric(options.backtestStats.f1);
    const normalizedLogLoss = this.normalizeMetric(options.backtestStats.logLoss);
    const recencyFactor = this.calculateRecencyFactor(options.trainedAtTs);
    const composite =
      CONFIG.MODEL_SCORE_AUC_WEIGHT * normalizedAuc +
      CONFIG.MODEL_SCORE_F1_WEIGHT * normalizedF1 +
      CONFIG.MODEL_SCORE_LOG_LOSS_WEIGHT * (1 - normalizedLogLoss) +
      CONFIG.MODEL_SCORE_RECENCY_WEIGHT * recencyFactor +
      CONFIG.MODEL_SCORE_STABILITY_WEIGHT * options.stabilityFactor;
    const rawScore = 100 * composite - options.overfitPenalty;
    const boundedScore = Math.min(100, Math.max(0, rawScore));
    return boundedScore;
  }

  /**
   * @section static:methods
   */

  // empty
}
