import { createRequire } from "node:module";

declare const __OPENCLAW_VERSION__: string | undefined;

export interface BuildInfo {
  version: string;
  commit: string | null;
  commitShort: string | null;
  builtAt: string | null;
}

function readVersionFromPackageJson(): string | null {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function readBuildInfo(): BuildInfo | null {
  try {
    const require = createRequire(import.meta.url);
    const candidates = ["../build-info.json", "./build-info.json", "../dist/build-info.json"];
    for (const candidate of candidates) {
      try {
        const info = require(candidate) as { version?: string; commit?: string; builtAt?: string };
        if (info.version || info.commit) {
          return {
            version: info.version ?? "0.0.0",
            commit: info.commit ?? null,
            commitShort: info.commit?.slice(0, 9) ?? null,
            builtAt: info.builtAt ?? null,
          };
        }
      } catch {
        // ignore missing candidate
      }
    }
    return null;
  } catch {
    return null;
  }
}

const buildInfo = readBuildInfo();

// Single source of truth for the current OpenClaw version.
// - Embedded/bundled builds: injected define or env var.
// - Dev/npm builds: package.json.
export const VERSION =
  (typeof __OPENCLAW_VERSION__ === "string" && __OPENCLAW_VERSION__) ||
  process.env.OPENCLAW_BUNDLED_VERSION ||
  readVersionFromPackageJson() ||
  buildInfo?.version ||
  "0.0.0";

// Full build info for verification
export const BUILD_INFO: BuildInfo = buildInfo ?? {
  version: VERSION,
  commit: null,
  commitShort: null,
  builtAt: null,
};

// Helper to get version string with commit
export function getVersionString(): string {
  if (BUILD_INFO.commitShort) {
    return `${VERSION} (${BUILD_INFO.commitShort})`;
  }
  return VERSION;
}
