/**
 * @section imports:externals
 */

// empty

/**
 * @section imports:internals
 */

import { ModelFarmRuntimeService } from "./app/model-farm-runtime.service.ts";
import { CollectorValidationRunnerService } from "./index.ts";

/**
 * @section consts
 */

const validationFlag = "--validate-collector";
const runOnceFlag = "--run-once";

/**
 * @section types
 */

// empty

async function run(): Promise<void> {
  if (process.argv.includes(validationFlag)) {
    const validationRunnerService = await CollectorValidationRunnerService.createDefault();
    const validationResult = await validationRunnerService.runOnce({ reportLabel: "collector-validation-cli" });
    console.log(`model-farm validation: processed ${validationResult.processedMarketCount} markets, reports at ${validationResult.reportRootPath}`);
  } else if (process.argv.includes(runOnceFlag)) {
    const runtimeService = await ModelFarmRuntimeService.createDefault();
    const cycleResult = await runtimeService.runCycleOnce();
    const combinationSummary = cycleResult.combinationResults
      .map(
        (result) => `${result.asset}/${result.window}:trained=${result.trainedJobCount},skipped=${result.skippedMarketCount},durationMs=${result.durationMs}`
      )
      .join(" | ");
    console.log(`model-farm runtime: trained=${cycleResult.trainedJobCount} skipped=${cycleResult.skippedMarketCount} durationMs=${cycleResult.durationMs}`);
    console.log(`model-farm runtime combinations: ${combinationSummary}`);
  } else {
    const runtimeService = await ModelFarmRuntimeService.createDefault();
    process.once("SIGINT", () => runtimeService.stop());
    process.once("SIGTERM", () => runtimeService.stop());
    await runtimeService.start();
  }
}

try {
  await run();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`model-farm runtime failed: ${message}`);
  process.exitCode = 1;
}
