import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  findRecoveryRoute,
  findAllRecoveryRoutes,
  executeRecoveryRoute,
  addCustomRoute,
  removeCustomRoute,
  getAllRoutes,
  getRecoverySuggestions,
  type ErrorRecoveryRoute,
} from "./error-recovery-routes.js";

describe("error-recovery-routes", () => {
  describe("findRecoveryRoute", () => {
    it("finds ENOENT route for file not found error", () => {
      const error = new Error("ENOENT: no such file or directory, open '/path/to/file'");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toBe("File or directory not found");
      expect(route?.requiredCapabilities).toContain("READ");
      expect(route?.requiredCapabilities).toContain("WRITE");
    });

    it("finds permission denied route for EACCES error", () => {
      const error = new Error("EACCES: permission denied, open '/protected/file'");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toContain("Permission denied");
      expect(route?.requiredCapabilities).toContain("ELEVATED");
    });

    it("finds connection refused route for ECONNREFUSED error", () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:18789");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toContain("connection refused");
      expect(route?.requiredCapabilities).toContain("NETWORK");
    });

    it("finds TypeScript error route", () => {
      const error = new Error("src/index.ts:42:10 - error TS2339: Property 'foo' does not exist");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toBe("TypeScript compilation error");
      expect(route?.recoverySteps).toContain("rebuild: Run build again to verify");
    });

    it("finds module not found route", () => {
      const error = new Error("Cannot find module 'missing-package'");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toBe("Missing module or import error");
      expect(route?.recoverySteps).toContain("install_deps: Run pnpm install");
    });

    it("finds out of memory route", () => {
      const error = new Error("FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toContain("Out of memory");
    });

    it("finds too many files route", () => {
      const error = new Error("EMFILE: too many open files, open '/some/file'");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toContain("Too many open files");
    });

    it("finds network timeout route", () => {
      const error = new Error("connect ETIMEDOUT 192.168.1.1:443");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toContain("Network timeout");
    });

    it("finds disk full route", () => {
      const error = new Error("ENOSPC: no space left on device");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toContain("Out of disk space");
    });

    it("finds gateway down route", () => {
      const error = new Error("Gateway not running or unreachable");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.diagnosis).toContain("Gateway service not running");
    });

    it("returns null for unknown error", () => {
      const error = new Error("Some completely unknown error type xyz123");
      const route = findRecoveryRoute(error);

      expect(route).toBeNull();
    });
  });

  describe("findAllRecoveryRoutes", () => {
    it("finds multiple matching routes when applicable", () => {
      // An error that could match multiple patterns
      const error = new Error("EACCES: permission denied while accessing network resource");
      const routes = findAllRecoveryRoutes(error);

      expect(routes.length).toBeGreaterThanOrEqual(1);
      expect(routes.some((r) => r.diagnosis.includes("Permission denied"))).toBe(true);
    });

    it("returns empty array for unknown error", () => {
      const error = new Error("Completely unique error xyz789abc");
      const routes = findAllRecoveryRoutes(error);

      expect(routes).toEqual([]);
    });
  });

  describe("executeRecoveryRoute", () => {
    it("executes a route without handler", async () => {
      const route: ErrorRecoveryRoute = {
        errorPattern: "test-error",
        diagnosis: "Test error",
        recoverySteps: ["step1: Do thing", "step2: Do other thing"],
        requiredCapabilities: ["READ"],
        estimatedDuration: 1000,
      };

      const result = await executeRecoveryRoute(route, {
        workspaceDir: "/tmp",
        error: new Error("test-error occurred"),
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toContain("step1: Do thing");
      expect(result.stepsCompleted).toContain("step2: Do other thing");
      expect(result.duration).toBeGreaterThan(0);
    });

    it("executes route with custom handler", async () => {
      const route: ErrorRecoveryRoute = {
        errorPattern: "custom-error",
        diagnosis: "Custom error",
        recoverySteps: ["custom_step"],
        requiredCapabilities: ["READ"],
        estimatedDuration: 500,
        handler: async (error, context) => {
          return {
            success: true,
            stepsCompleted: ["custom_handler_executed"],
            duration: 100,
          };
        },
      };

      const result = await executeRecoveryRoute(route, {
        workspaceDir: "/tmp",
        error: new Error("custom-error"),
        attempt: 1,
        maxAttempts: 3,
      });

      expect(result.success).toBe(true);
      expect(result.stepsCompleted).toContain("custom_handler_executed");
    });
  });

  describe("custom routes", () => {
    afterEach(() => {
      // Clean up custom routes after each test
      removeCustomRoute("my-custom-pattern");
      removeCustomRoute(/custom-regex/);
    });

    it("adds custom route with string pattern", () => {
      const initialCount = getAllRoutes().length;

      addCustomRoute("my-custom-pattern", {
        diagnosis: "My custom error",
        recoverySteps: ["custom_step"],
        requiredCapabilities: ["READ"],
        estimatedDuration: 1000,
      });

      const routes = getAllRoutes();
      expect(routes.length).toBe(initialCount + 1);

      const error = new Error("Error: my-custom-pattern occurred");
      const route = findRecoveryRoute(error);
      expect(route?.diagnosis).toBe("My custom error");
    });

    it("adds custom route with regex pattern", () => {
      addCustomRoute(/custom-regex/, {
        diagnosis: "Regex matched error",
        recoverySteps: ["regex_step"],
        requiredCapabilities: ["WRITE"],
        estimatedDuration: 2000,
      });

      const error = new Error("Something custom-regex something else");
      const route = findRecoveryRoute(error);
      expect(route?.diagnosis).toBe("Regex matched error");
    });

    it("custom routes take priority over default routes", () => {
      // Add a custom route that matches ENOENT with high priority
      addCustomRoute("ENOENT", {
        diagnosis: "Custom ENOENT handler",
        recoverySteps: ["custom_enoent"],
        requiredCapabilities: ["READ"],
        estimatedDuration: 500,
        priority: 1, // Very high priority
      });

      const error = new Error("ENOENT: no such file or directory");
      const route = findRecoveryRoute(error);

      // Should match custom route first due to priority
      expect(route?.diagnosis).toBe("Custom ENOENT handler");

      // Cleanup
      removeCustomRoute("ENOENT");
    });

    it("removes custom route", () => {
      addCustomRoute("removable-pattern", {
        diagnosis: "Removable",
        recoverySteps: [],
        requiredCapabilities: [],
        estimatedDuration: 0,
      });

      const beforeRemove = getAllRoutes().length;
      const removed = removeCustomRoute("removable-pattern");

      expect(removed).toBe(true);
      expect(getAllRoutes().length).toBe(beforeRemove - 1);
    });

    it("returns false when removing non-existent route", () => {
      const removed = removeCustomRoute("non-existent-pattern");
      expect(removed).toBe(false);
    });
  });

  describe("getRecoverySuggestions", () => {
    it("returns suggestions for known error", () => {
      const error = new Error("ECONNREFUSED 127.0.0.1:8080");
      const suggestions = getRecoverySuggestions(error);

      expect(suggestions).not.toBeNull();
      expect(suggestions?.diagnosis).toContain("connection refused");
      expect(suggestions?.steps.length).toBeGreaterThan(0);
      expect(suggestions?.estimatedTime).toBeGreaterThan(0);
      expect(suggestions?.capabilities).toContain("NETWORK");
    });

    it("returns null for unknown error", () => {
      const error = new Error("Unknown error xyz123abc");
      const suggestions = getRecoverySuggestions(error);

      expect(suggestions).toBeNull();
    });
  });

  describe("getAllRoutes", () => {
    it("returns all default routes", () => {
      const routes = getAllRoutes();

      // Should have at least the default routes we defined
      expect(routes.length).toBeGreaterThan(10);

      // Verify some expected routes exist
      const patterns = routes.map((r) => r.errorPattern.toString());
      expect(patterns.some((p) => p.includes("ENOENT"))).toBe(true);
      expect(patterns.some((p) => p.includes("ECONNREFUSED"))).toBe(true);
      expect(patterns.some((p) => p.includes("TS"))).toBe(true);
    });
  });

  describe("priority ordering", () => {
    it("returns routes ordered by priority", () => {
      // Create an error that could match multiple patterns
      const error = new Error("ENOSPC: no space left on device causing process to crash");

      const routes = findAllRecoveryRoutes(error);
      if (routes.length > 1) {
        // Verify ordering by priority (lower = higher priority)
        for (let i = 1; i < routes.length; i++) {
          const prevPriority = routes[i - 1].priority ?? 50;
          const currPriority = routes[i].priority ?? 50;
          expect(prevPriority).toBeLessThanOrEqual(currPriority);
        }
      }
    });
  });

  describe("handler integration", () => {
    it("ENOENT handler extracts path from error", async () => {
      const error = new Error("ENOENT: no such file or directory, open '/path/to/missing/file.txt'");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();
      expect(route?.handler).toBeDefined();

      // Execute the handler
      const result = await executeRecoveryRoute(route!, {
        workspaceDir: "/tmp",
        error,
        attempt: 1,
        maxAttempts: 3,
      });

      // Handler should complete with steps that mention the path
      expect(result.stepsCompleted.some((s) => s.includes("check_path"))).toBe(true);
    });

    it("connection refused handler checks for gateway", async () => {
      const error = new Error("connect ECONNREFUSED 127.0.0.1:18789");
      const route = findRecoveryRoute(error);

      expect(route).not.toBeNull();

      const result = await executeRecoveryRoute(route!, {
        workspaceDir: "/tmp",
        error,
        attempt: 1,
        maxAttempts: 3,
      });

      // Should have checked the service
      expect(result.stepsCompleted.some((s) => s.includes("check_service"))).toBe(true);
    });
  });
});
