import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export interface DeadCodeCandidate {
  functionName: string;
  filePath: string;
  location: {
    line: number;
    column: number;
  };
  exportType: "named" | "default" | "function" | "interface" | "type" | "class";
  importCount: number;
  callCount: number;
  lastModified: Date;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  reason: string;
  usedByTests: boolean;
  lineCount: number;
}

export interface DeadCodeReport {
  timestamp: Date;
  totalFiles: number;
  totalFunctions: number;
  candidatesFound: number;
  candidates: DeadCodeCandidate[];
  summary: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    totalLinesOfDeadCode: number;
  };
}

export class DeadCodeAnalyzer {
  private projectRoot: string;
  private program: ts.Program;
  private typeChecker: ts.TypeChecker;
  private sourceFiles: readonly ts.SourceFile[];

  constructor(projectRoot = "/Users/gustav/openclaw") {
    this.projectRoot = projectRoot;

    // Create TypeScript program
    const configPath = path.join(projectRoot, "tsconfig.json");
    const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
    const compilerOptions = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot);

    this.program = ts.createProgram({
      rootNames: compilerOptions.fileNames,
      options: compilerOptions.options,
    });

    this.typeChecker = this.program.getTypeChecker();
    this.sourceFiles = this.program
      .getSourceFiles()
      .filter(
        (sf) =>
          sf.fileName.includes("/src/") &&
          !sf.fileName.includes(".test.ts") &&
          !sf.fileName.includes("node_modules"),
      );
  }

  async analyze(): Promise<DeadCodeReport> {
    console.log("🔍 Starting dead code analysis...");
    console.log(`📁 Analyzing ${this.sourceFiles.length} source files`);

    const candidates: DeadCodeCandidate[] = [];
    const exportMap = new Map<string, { file: string; name: string; node: ts.Node }>();
    const importMap = new Map<string, number>();
    const callMap = new Map<string, number>();

    // Step 1: Find all exports
    console.log("📤 Finding all exports...");
    for (const sourceFile of this.sourceFiles) {
      this.findExports(sourceFile, exportMap);
    }

    // Step 2: Count imports and calls
    console.log("📥 Counting imports and function calls...");
    for (const sourceFile of this.sourceFiles) {
      this.countImportsAndCalls(sourceFile, importMap, callMap);
    }

    // Step 3: Analyze each export for dead code indicators
    console.log("🕵️ Analyzing exports for dead code indicators...");
    for (const [fullName, exportInfo] of exportMap) {
      const importCount = importMap.get(fullName) || 0;
      const callCount = callMap.get(exportInfo.name) || 0;
      const isTestUsage = this.checkTestFileUsage(exportInfo.name);

      const candidate = await this.analyzeExport(exportInfo, importCount, callCount, isTestUsage);

      if (candidate) {
        candidates.push(candidate);
      }
    }

    // Sort by confidence and potential impact
    candidates.sort((a, b) => {
      const confidenceOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
      const confidenceDiff = confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
      if (confidenceDiff !== 0) return confidenceDiff;

      return b.lineCount - a.lineCount; // Larger functions first
    });

    console.log(`✅ Analysis complete! Found ${candidates.length} candidates`);

    return {
      timestamp: new Date(),
      totalFiles: this.sourceFiles.length,
      totalFunctions: exportMap.size,
      candidatesFound: candidates.length,
      candidates,
      summary: this.generateSummary(candidates),
    };
  }

  private findExports(
    sourceFile: ts.SourceFile,
    exportMap: Map<string, { file: string; name: string; node: ts.Node }>,
  ) {
    const visit = (node: ts.Node) => {
      // Named exports: export { foo, bar }
      if (
        ts.isExportDeclaration(node) &&
        node.exportClause &&
        ts.isNamedExports(node.exportClause)
      ) {
        for (const exportSpecifier of node.exportClause.elements) {
          const name = exportSpecifier.name.getText();
          const fullName = `${sourceFile.fileName}:${name}`;
          exportMap.set(fullName, { file: sourceFile.fileName, name, node });
        }
      }

      // Function exports: export function foo() {}
      if (ts.isFunctionDeclaration(node) && this.hasExportModifier(node)) {
        const name = node.name?.getText() || "anonymous";
        const fullName = `${sourceFile.fileName}:${name}`;
        exportMap.set(fullName, { file: sourceFile.fileName, name, node });
      }

      // Class exports: export class Foo {}
      if (ts.isClassDeclaration(node) && this.hasExportModifier(node)) {
        const name = node.name?.getText() || "anonymous";
        const fullName = `${sourceFile.fileName}:${name}`;
        exportMap.set(fullName, { file: sourceFile.fileName, name, node });
      }

      // Interface exports: export interface Foo {}
      if (ts.isInterfaceDeclaration(node) && this.hasExportModifier(node)) {
        const name = node.name.getText();
        const fullName = `${sourceFile.fileName}:${name}`;
        exportMap.set(fullName, { file: sourceFile.fileName, name, node });
      }

      // Type exports: export type Foo = string
      if (ts.isTypeAliasDeclaration(node) && this.hasExportModifier(node)) {
        const name = node.name.getText();
        const fullName = `${sourceFile.fileName}:${name}`;
        exportMap.set(fullName, { file: sourceFile.fileName, name, node });
      }

      // Variable exports: export const foo = ...
      if (ts.isVariableStatement(node) && this.hasExportModifier(node)) {
        for (const declaration of node.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) {
            const name = declaration.name.getText();
            const fullName = `${sourceFile.fileName}:${name}`;
            exportMap.set(fullName, { file: sourceFile.fileName, name, node });
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private countImportsAndCalls(
    sourceFile: ts.SourceFile,
    importMap: Map<string, number>,
    callMap: Map<string, number>,
  ) {
    const visit = (node: ts.Node) => {
      // Import statements: import { foo } from './bar'
      if (ts.isImportDeclaration(node) && node.importClause && node.importClause.namedBindings) {
        if (ts.isNamedImports(node.importClause.namedBindings)) {
          for (const importSpecifier of node.importClause.namedBindings.elements) {
            const name = importSpecifier.name.getText();
            const moduleName = (node.moduleSpecifier as ts.StringLiteral).text;
            const resolvedPath = this.resolveModulePath(sourceFile.fileName, moduleName);
            if (resolvedPath) {
              const fullName = `${resolvedPath}:${name}`;
              importMap.set(fullName, (importMap.get(fullName) || 0) + 1);
            }
          }
        }
      }

      // Function calls: foo()
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const name = node.expression.getText();
        callMap.set(name, (callMap.get(name) || 0) + 1);
      }

      // Property access calls: obj.method()
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const name = node.expression.name.getText();
        callMap.set(name, (callMap.get(name) || 0) + 1);
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private resolveModulePath(currentFile: string, moduleName: string): string | null {
    if (!moduleName.startsWith(".")) return null; // External modules

    try {
      const currentDir = path.dirname(currentFile);
      let resolvedPath = path.resolve(currentDir, moduleName);

      // Try common extensions
      const extensions = [".ts", ".tsx", ".js", ".jsx"];
      for (const ext of extensions) {
        const withExt = resolvedPath + ext;
        if (fs.existsSync(withExt)) {
          return withExt;
        }
      }

      // Try index files
      for (const ext of extensions) {
        const indexPath = path.join(resolvedPath, "index" + ext);
        if (fs.existsSync(indexPath)) {
          return indexPath;
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  private hasExportModifier(node: ts.Node): boolean {
    return node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword) || false;
  }

  private checkTestFileUsage(functionName: string): boolean {
    try {
      // Quick grep check for test file usage
      const grepResult = execSync(
        `cd "${this.projectRoot}" && grep -r "${functionName}" src/**/*.test.ts 2>/dev/null || true`,
        { encoding: "utf8" },
      );
      return grepResult.trim().length > 0;
    } catch {
      return false;
    }
  }

  private async analyzeExport(
    exportInfo: { file: string; name: string; node: ts.Node },
    importCount: number,
    callCount: number,
    usedByTests: boolean,
  ): Promise<DeadCodeCandidate | null> {
    const { file, name, node } = exportInfo;

    // Skip if actively used
    if (importCount > 3 || callCount > 5) {
      return null;
    }

    // Calculate line count
    const sourceFile = node.getSourceFile();
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart());
    const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
    const lineCount = end.line - start.line + 1;

    // Skip very small functions (likely not worth cleaning up)
    if (lineCount < 5 && importCount > 0) {
      return null;
    }

    // Determine confidence level
    let confidence: "HIGH" | "MEDIUM" | "LOW";
    let reason: string;

    if (importCount === 0 && callCount === 0 && !usedByTests) {
      confidence = "HIGH";
      reason = "No imports, no calls, not used by tests";
    } else if (importCount === 1 && callCount === 0) {
      confidence = "MEDIUM";
      reason = "Single import but never called";
    } else if (usedByTests && importCount === 0 && callCount === 0) {
      confidence = "MEDIUM";
      reason = "Only used by test files";
    } else if (importCount <= 1 && callCount <= 1) {
      confidence = "LOW";
      reason = "Minimal usage detected";
    } else {
      return null; // Not a candidate
    }

    // Get file modification time
    const stats = fs.statSync(file);
    const lastModified = stats.mtime;

    // Determine export type
    let exportType: DeadCodeCandidate["exportType"] = "named";
    if (ts.isFunctionDeclaration(node)) exportType = "function";
    else if (ts.isClassDeclaration(node)) exportType = "class";
    else if (ts.isInterfaceDeclaration(node)) exportType = "interface";
    else if (ts.isTypeAliasDeclaration(node)) exportType = "type";

    const relativePath = path.relative(this.projectRoot, file);

    return {
      functionName: name,
      filePath: relativePath,
      location: {
        line: start.line + 1,
        column: start.character + 1,
      },
      exportType,
      importCount,
      callCount,
      lastModified,
      confidence,
      reason,
      usedByTests,
      lineCount,
    };
  }

  private generateSummary(candidates: DeadCodeCandidate[]) {
    const summary = {
      highConfidence: candidates.filter((c) => c.confidence === "HIGH").length,
      mediumConfidence: candidates.filter((c) => c.confidence === "MEDIUM").length,
      lowConfidence: candidates.filter((c) => c.confidence === "LOW").length,
      totalLinesOfDeadCode: candidates.reduce((sum, c) => sum + c.lineCount, 0),
    };

    return summary;
  }

  // Utility methods for reporting
  static formatReport(report: DeadCodeReport): string {
    const { candidates, summary, timestamp } = report;

    let output = `# Dead Code Analysis Report\n\n`;
    output += `**Generated:** ${timestamp.toISOString()}\n`;
    output += `**Files Analyzed:** ${report.totalFiles}\n`;
    output += `**Total Exports:** ${report.totalFunctions}\n`;
    output += `**Dead Code Candidates:** ${report.candidatesFound}\n\n`;

    output += `## Summary\n\n`;
    output += `- 🔴 **High Confidence:** ${summary.highConfidence} candidates (${candidates.filter((c) => c.confidence === "HIGH").reduce((sum, c) => sum + c.lineCount, 0)} lines)\n`;
    output += `- 🟡 **Medium Confidence:** ${summary.mediumConfidence} candidates (${candidates.filter((c) => c.confidence === "MEDIUM").reduce((sum, c) => sum + c.lineCount, 0)} lines)\n`;
    output += `- 🟢 **Low Confidence:** ${summary.lowConfidence} candidates (${candidates.filter((c) => c.confidence === "LOW").reduce((sum, c) => sum + c.lineCount, 0)} lines)\n`;
    output += `- **Total Dead Code Lines:** ${summary.totalLinesOfDeadCode}\n\n`;

    // Group by confidence
    for (const confidence of ["HIGH", "MEDIUM", "LOW"] as const) {
      const group = candidates.filter((c) => c.confidence === confidence);
      if (group.length === 0) continue;

      output += `## ${confidence} Confidence (${group.length} candidates)\n\n`;

      for (const candidate of group.slice(0, 20)) {
        // Limit to top 20 per category
        output += `### \`${candidate.functionName}\` (${candidate.exportType})\n\n`;
        output += `- **File:** ${candidate.filePath}:${candidate.location.line}\n`;
        output += `- **Reason:** ${candidate.reason}\n`;
        output += `- **Imports:** ${candidate.importCount} | **Calls:** ${candidate.callCount} | **Lines:** ${candidate.lineCount}\n`;
        output += `- **Last Modified:** ${candidate.lastModified.toDateString()}\n`;
        if (candidate.usedByTests) {
          output += `- **⚠️ Used by tests**\n`;
        }
        output += `\n`;
      }

      if (group.length > 20) {
        output += `*... and ${group.length - 20} more candidates*\n\n`;
      }
    }

    return output;
  }

  static async saveReport(report: DeadCodeReport, outputPath: string): Promise<void> {
    const reportText = this.formatReport(report);
    await fs.promises.writeFile(outputPath, reportText, "utf8");
  }
}
