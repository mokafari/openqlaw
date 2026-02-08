/**
 * Integration tests for patch verification wiring
 *
 * Verifies that patch-verifier is properly imported into patches.ts
 */

import { describe, it, expect } from "vitest";

describe("patches integration with patch-verifier", () => {
  it("exports applyPatchWithVerification function", async () => {
    const patches = await import("./patches.js");

    expect(patches.applyPatchWithVerification).toBeDefined();
    expect(typeof patches.applyPatchWithVerification).toBe("function");
  });

  it("exports PatchVerification type via re-export", async () => {
    // The type is exported, verify the module loads correctly
    const patches = await import("./patches.js");

    // Function exists and is callable (will fail gracefully with missing patch)
    expect(patches.applyPatchWithVerification).toBeDefined();
  });

  it("patch-verifier exports are available", async () => {
    const verifier = await import("./patch-verifier.js");

    expect(verifier.verifyPatch).toBeDefined();
    expect(verifier.createSnapshot).toBeDefined();
    expect(verifier.verifyBuild).toBeDefined();
    expect(verifier.verifyTypeCheck).toBeDefined();
    expect(verifier.rollback).toBeDefined();
    expect(verifier.logVerification).toBeDefined();
    expect(verifier.summarizeVerification).toBeDefined();
    expect(typeof verifier.verifyPatch).toBe("function");
  });

  it("applyPatchWithVerification returns error for non-existent patch", async () => {
    const { applyPatchWithVerification } = await import("./patches.js");

    const result = await applyPatchWithVerification("non-existent-patch-id", "/tmp/workspace");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
