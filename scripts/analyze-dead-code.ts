#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { DeadCodeAnalyzer } from "../src/tools/dead-code-analyzer.js";

async function main() {
  try {
    console.log("🚀 Dead Code Analyzer Starting...\n");

    const projectRoot = "/Users/gustav/openclaw";
    const analyzer = new DeadCodeAnalyzer(projectRoot);

    // Run analysis
    const report = await analyzer.analyze();

    // Save detailed report
    const timestamp = new Date().toISOString().split("T")[0];
    const reportPath = path.join(projectRoot, "memory", `dead-code-audit-${timestamp}.md`);

    // Ensure memory directory exists
    const memoryDir = path.dirname(reportPath);
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }

    await DeadCodeAnalyzer.saveReport(report, reportPath);
    console.log(`📄 Detailed report saved: ${reportPath}`);

    // Also save JSON for further processing
    const jsonPath = reportPath.replace(".md", ".json");
    await fs.promises.writeFile(jsonPath, JSON.stringify(report, null, 2));
    console.log(`📊 JSON data saved: ${jsonPath}`);

    // Print summary to console
    console.log("\n" + DeadCodeAnalyzer.formatReport(report));
  } catch (error) {
    console.error("❌ Analysis failed:", error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
