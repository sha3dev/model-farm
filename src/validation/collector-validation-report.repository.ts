/**
 * @section imports:externals
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @section imports:internals
 */

import CONFIG from "../config.ts";
import type { CollectorValidationRunResult, WindowValidationReport } from "./collector-validation.types.ts";

/**
 * @section consts
 */

const summaryFileName = "summary.json";
const consoleSummaryFileName = "console-summary.txt";

/**
 * @section types
 */

type WriteWindowReportOptions = { reportRootPath: string; asset: string; window: string; report: WindowValidationReport };
type WriteSummaryOptions = { reportRootPath: string; result: CollectorValidationRunResult; consoleSummary: string };

export class CollectorValidationReportRepository {
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

  private readonly defaultReportsRootPath: string;

  /**
   * @section public:properties
   */

  // empty

  /**
   * @section constructor
   */

  public constructor(defaultReportsRootPath: string) {
    this.defaultReportsRootPath = defaultReportsRootPath;
  }

  /**
   * @section static:properties
   */

  // empty

  /**
   * @section factory
   */

  public static createDefault(): CollectorValidationReportRepository {
    const repository = new CollectorValidationReportRepository(CONFIG.VALIDATION_REPORTS_ROOT_PATH);
    return repository;
  }

  public static create(defaultReportsRootPath: string): CollectorValidationReportRepository {
    const repository = new CollectorValidationReportRepository(defaultReportsRootPath);
    return repository;
  }

  /**
   * @section private:methods
   */

  private ensureDirectory(directoryPath: string): void {
    mkdirSync(directoryPath, { recursive: true });
  }

  /**
   * @section protected:methods
   */

  // empty

  /**
   * @section public:methods
   */

  public buildReportRootPath(reportLabel: string, runTs: number, reportDirectoryPath?: string): string {
    const baseRootPath = reportDirectoryPath ?? this.defaultReportsRootPath;
    const reportRootPath = join(baseRootPath, reportLabel, String(runTs));
    return reportRootPath;
  }

  public writeWindowReport(options: WriteWindowReportOptions): string {
    this.ensureDirectory(options.reportRootPath);
    const filePath = join(options.reportRootPath, `window-${options.asset}-${options.window}.json`);
    writeFileSync(filePath, JSON.stringify(options.report, null, 2), "utf8");
    return filePath;
  }

  public writeSummary(options: WriteSummaryOptions): { summaryFilePath: string; consoleSummaryFilePath: string } {
    this.ensureDirectory(options.reportRootPath);
    const summaryFilePath = join(options.reportRootPath, summaryFileName);
    const consoleFilePath = join(options.reportRootPath, consoleSummaryFileName);
    writeFileSync(summaryFilePath, JSON.stringify(options.result, null, 2), "utf8");
    writeFileSync(consoleFilePath, options.consoleSummary, "utf8");
    const filePaths = { summaryFilePath, consoleSummaryFilePath: consoleFilePath };
    return filePaths;
  }

  /**
   * @section static:methods
   */

  // empty
}
