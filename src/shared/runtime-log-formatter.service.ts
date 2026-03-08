/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import type { BacktestStats } from "../model-catalog/model-catalog.types.ts";

/**
 * @section consts
 */

const ANSI_RESET = "\u001B[0m";
const ANSI_GREEN = "\u001B[32m";
const ANSI_RED = "\u001B[31m";
const ANSI_YELLOW = "\u001B[33m";
const ANSI_CYAN = "\u001B[36m";

/**
 * @section types
 */

// empty

export class RuntimeLogFormatterService {
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

  public static create(): RuntimeLogFormatterService {
    const runtimeLogFormatterService = new RuntimeLogFormatterService();
    return runtimeLogFormatterService;
  }

  /**
   * @section private:methods
   */

  private colorize(text: string, colorCode: string): string {
    const shouldColorize = process.stdout.isTTY === true;
    const colorizedText = shouldColorize ? `${colorCode}${text}${ANSI_RESET}` : text;
    return colorizedText;
  }

  private formatOutcomeLabel(backtestStats: BacktestStats): string {
    const resolvedOutcome = backtestStats.resolvedOutcome ?? "unknown";
    const formattedOutcomeLabel = resolvedOutcome === "up" ? "UP" : resolvedOutcome === "down" ? "DOWN" : "FLAT";
    return formattedOutcomeLabel;
  }

  private formatRelevantPredictionLabel(backtestStats: BacktestStats): string {
    const relevantPrediction = backtestStats.firstRelevantPrediction;
    let relevantPredictionLabel = "first-signal=none";
    if (relevantPrediction !== null) {
      const tokenPrice = relevantPrediction.predictedClass === "up" ? relevantPrediction.pmUpPrice : relevantPrediction.pmDownPrice;
      const predictionLabel = relevantPrediction.predictedClass.toUpperCase();
      relevantPredictionLabel = `first-signal=${predictionLabel} at ${relevantPrediction.minuteOffsetLabel} conf=${relevantPrediction.confidence.toFixed(3)} token=${tokenPrice?.toFixed(3) ?? "n/a"}`;
    }
    return relevantPredictionLabel;
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public formatBacktestSummary(asset: string, window: string, modelId: string, backtestStats: BacktestStats, score: number): string {
    const outcomeLabel = this.formatOutcomeLabel(backtestStats);
    const relevantPrediction = backtestStats.firstRelevantPrediction;
    const resultLabel =
      relevantPrediction === null
        ? this.colorize("NO-SIGNAL", ANSI_YELLOW)
        : relevantPrediction.isCorrect === true
          ? this.colorize("HIT", ANSI_GREEN)
          : relevantPrediction.isCorrect === false
            ? this.colorize("MISS", ANSI_RED)
            : this.colorize("FLAT", ANSI_CYAN);
    const formattedSummary =
      `[model] ${asset}/${window} model=${modelId} outcome=${outcomeLabel} ` +
      `${this.formatRelevantPredictionLabel(backtestStats)} ` +
      `acc=${(backtestStats.accuracy ?? 0).toFixed(3)} auc=${(backtestStats.auc ?? 0).toFixed(3)} score=${score.toFixed(2)} ${resultLabel}`;
    return formattedSummary;
  }

  /**
   * @section static:methods
   */

  // empty
}
