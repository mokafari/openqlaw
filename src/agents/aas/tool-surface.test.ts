import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolSurfaceMetadata } from "./types.js";
import {
  toolRegistry,
  TOOL_SURFACE,
  getToolMetadata,
  getToolPreconditions,
  getToolSideEffects,
  getToolContextAreas,
  validateToolPreconditions,
  registerToolSurfaces,
  unregisterToolSurfaces,
  clearDynamicRegistry,
  getDynamicRegistrySize,
  onToolRegistration,
} from "./tool-surface.js";

describe("tool-surface", () => {
  beforeEach(() => {
    clearDynamicRegistry();
  });

  describe("static TOOL_SURFACE", () => {
    it("contains built-in tools", () => {
      expect(TOOL_SURFACE.read).toBeDefined();
      expect(TOOL_SURFACE.write).toBeDefined();
      expect(TOOL_SURFACE.exec).toBeDefined();
      expect(TOOL_SURFACE.browser).toBeDefined();
    });

    it("has correct metadata structure", () => {
      const read = TOOL_SURFACE.read;
      expect(read.toolName).toBe("read");
      expect(read.contextAreas).toContain("filesystem");
      expect(Array.isArray(read.preconditions)).toBe(true);
      expect(Array.isArray(read.sideEffects)).toBe(true);
    });
  });

  describe("toolRegistry", () => {
    describe("registerToolSurface", () => {
      it("registers a new tool", () => {
        const customTool: ToolSurfaceMetadata = {
          toolName: "custom_tool",
          contextAreas: ["filesystem"],
          preconditions: ["custom.ready"],
          sideEffects: ["custom.done"],
        };

        toolRegistry.registerToolSurface(customTool);

        const result = toolRegistry.getToolSurface("custom_tool");
        expect(result).toEqual(customTool);
        expect(getDynamicRegistrySize()).toBe(1);
      });

      it("overwrites existing dynamic tool", () => {
        const tool1: ToolSurfaceMetadata = {
          toolName: "my_tool",
          contextAreas: ["filesystem"],
          preconditions: [],
          sideEffects: [],
        };
        const tool2: ToolSurfaceMetadata = {
          toolName: "my_tool",
          contextAreas: ["web"],
          preconditions: ["updated"],
          sideEffects: [],
        };

        toolRegistry.registerToolSurface(tool1);
        toolRegistry.registerToolSurface(tool2);

        const result = toolRegistry.getToolSurface("my_tool");
        expect(result?.contextAreas).toEqual(["web"]);
        expect(result?.preconditions).toEqual(["updated"]);
      });

      it("can override static tools", () => {
        const customRead: ToolSurfaceMetadata = {
          toolName: "read",
          contextAreas: ["filesystem", "custom"],
          preconditions: ["custom.auth"],
          sideEffects: [],
        };

        toolRegistry.registerToolSurface(customRead);

        const result = toolRegistry.getToolSurface("read");
        expect(result?.contextAreas).toContain("custom");
        expect(result?.preconditions).toContain("custom.auth");
      });
    });

    describe("unregisterTool", () => {
      it("removes a dynamic tool", () => {
        const customTool: ToolSurfaceMetadata = {
          toolName: "temp_tool",
          contextAreas: ["filesystem"],
          preconditions: [],
          sideEffects: [],
        };

        toolRegistry.registerToolSurface(customTool);
        expect(toolRegistry.getToolSurface("temp_tool")).toBeDefined();

        toolRegistry.unregisterTool("temp_tool");
        expect(toolRegistry.getToolSurface("temp_tool")).toBeNull();
      });

      it("does not affect static tools", () => {
        toolRegistry.unregisterTool("read");
        // Should still get static tool
        const result = toolRegistry.getToolSurface("read");
        expect(result).toEqual(TOOL_SURFACE.read);
      });

      it("restores static tool after unregistering override", () => {
        const customRead: ToolSurfaceMetadata = {
          toolName: "read",
          contextAreas: ["custom"],
          preconditions: [],
          sideEffects: [],
        };

        toolRegistry.registerToolSurface(customRead);
        expect(toolRegistry.getToolSurface("read")?.contextAreas).toContain("custom");

        toolRegistry.unregisterTool("read");
        expect(toolRegistry.getToolSurface("read")?.contextAreas).toContain("filesystem");
      });
    });

    describe("getToolSurface", () => {
      it("returns null for unknown tools", () => {
        expect(toolRegistry.getToolSurface("nonexistent")).toBeNull();
      });

      it("prioritizes dynamic over static", () => {
        const customExec: ToolSurfaceMetadata = {
          toolName: "exec",
          contextAreas: ["terminal", "custom"],
          preconditions: ["elevated"],
          sideEffects: [],
        };

        toolRegistry.registerToolSurface(customExec);

        const result = toolRegistry.getToolSurface("exec");
        expect(result?.preconditions).toContain("elevated");
        expect(result?.contextAreas).toContain("custom");
      });
    });

    describe("listRegisteredTools", () => {
      it("includes all static tools", () => {
        const tools = toolRegistry.listRegisteredTools();
        const names = tools.map((t) => t.toolName);

        expect(names).toContain("read");
        expect(names).toContain("write");
        expect(names).toContain("exec");
      });

      it("includes dynamic tools", () => {
        toolRegistry.registerToolSurface({
          toolName: "skill_tool",
          contextAreas: ["custom"],
          preconditions: [],
          sideEffects: [],
        });

        const tools = toolRegistry.listRegisteredTools();
        const names = tools.map((t) => t.toolName);

        expect(names).toContain("skill_tool");
      });

      it("dynamic tools override static in list", () => {
        toolRegistry.registerToolSurface({
          toolName: "read",
          contextAreas: ["overridden"],
          preconditions: [],
          sideEffects: [],
        });

        const tools = toolRegistry.listRegisteredTools();
        const readTools = tools.filter((t) => t.toolName === "read");

        expect(readTools).toHaveLength(1);
        expect(readTools[0].contextAreas).toContain("overridden");
      });
    });

    describe("getToolsByContextArea", () => {
      it("returns tools for filesystem area", () => {
        const tools = toolRegistry.getToolsByContextArea("filesystem");
        const names = tools.map((t) => t.toolName);

        expect(names).toContain("read");
        expect(names).toContain("write");
        expect(names).toContain("edit");
      });

      it("returns empty for unknown area", () => {
        const tools = toolRegistry.getToolsByContextArea("unknown_area");
        expect(tools).toHaveLength(0);
      });

      it("includes dynamically registered tools", () => {
        toolRegistry.registerToolSurface({
          toolName: "my_web_tool",
          contextAreas: ["web"],
          preconditions: [],
          sideEffects: [],
        });

        const tools = toolRegistry.getToolsByContextArea("web");
        const names = tools.map((t) => t.toolName);

        expect(names).toContain("my_web_tool");
        expect(names).toContain("web_search");
      });
    });
  });

  describe("helper functions", () => {
    describe("getToolMetadata", () => {
      it("returns metadata for static tools", () => {
        const meta = getToolMetadata("read");
        expect(meta?.toolName).toBe("read");
      });

      it("returns metadata for dynamic tools", () => {
        toolRegistry.registerToolSurface({
          toolName: "dynamic_tool",
          contextAreas: ["messaging"],
          preconditions: [],
          sideEffects: ["sent"],
        });

        const meta = getToolMetadata("dynamic_tool");
        expect(meta?.toolName).toBe("dynamic_tool");
        expect(meta?.sideEffects).toContain("sent");
      });

      it("returns undefined for unknown tools", () => {
        expect(getToolMetadata("unknown")).toBeUndefined();
      });
    });

    describe("getToolPreconditions", () => {
      it("returns preconditions for tools", () => {
        toolRegistry.registerToolSurface({
          toolName: "auth_tool",
          contextAreas: ["system"],
          preconditions: ["auth.valid", "session.active"],
          sideEffects: [],
        });

        const preconds = getToolPreconditions("auth_tool");
        expect(preconds).toContain("auth.valid");
        expect(preconds).toContain("session.active");
      });

      it("returns empty array for unknown tools", () => {
        expect(getToolPreconditions("unknown")).toEqual([]);
      });
    });

    describe("getToolSideEffects", () => {
      it("returns side effects for tools", () => {
        const effects = getToolSideEffects("write");
        expect(effects).toContain("filesystem.modified");
      });
    });

    describe("getToolContextAreas", () => {
      it("returns context areas for tools", () => {
        const areas = getToolContextAreas("browser");
        expect(areas).toContain("browser");
      });
    });

    describe("validateToolPreconditions", () => {
      it("validates all preconditions met", () => {
        toolRegistry.registerToolSurface({
          toolName: "validated_tool",
          contextAreas: ["system"],
          preconditions: ["a", "b"],
          sideEffects: [],
        });

        const state = new Set(["a", "b", "c"]);
        const result = validateToolPreconditions("validated_tool", state);

        expect(result.valid).toBe(true);
        expect(result.missing).toEqual([]);
      });

      it("reports missing preconditions", () => {
        toolRegistry.registerToolSurface({
          toolName: "validated_tool",
          contextAreas: ["system"],
          preconditions: ["a", "b", "c"],
          sideEffects: [],
        });

        const state = new Set(["a"]);
        const result = validateToolPreconditions("validated_tool", state);

        expect(result.valid).toBe(false);
        expect(result.missing).toContain("b");
        expect(result.missing).toContain("c");
      });
    });
  });

  describe("batch operations", () => {
    describe("registerToolSurfaces", () => {
      it("registers multiple tools at once", () => {
        registerToolSurfaces([
          { toolName: "batch1", contextAreas: ["a"], preconditions: [], sideEffects: [] },
          { toolName: "batch2", contextAreas: ["b"], preconditions: [], sideEffects: [] },
          { toolName: "batch3", contextAreas: ["c"], preconditions: [], sideEffects: [] },
        ]);

        expect(getDynamicRegistrySize()).toBe(3);
        expect(toolRegistry.getToolSurface("batch1")).toBeDefined();
        expect(toolRegistry.getToolSurface("batch2")).toBeDefined();
        expect(toolRegistry.getToolSurface("batch3")).toBeDefined();
      });
    });

    describe("unregisterToolSurfaces", () => {
      it("unregisters multiple tools at once", () => {
        registerToolSurfaces([
          { toolName: "remove1", contextAreas: [], preconditions: [], sideEffects: [] },
          { toolName: "remove2", contextAreas: [], preconditions: [], sideEffects: [] },
        ]);

        unregisterToolSurfaces(["remove1", "remove2"]);

        expect(getDynamicRegistrySize()).toBe(0);
      });
    });
  });

  describe("registration listeners", () => {
    it("notifies on registration", () => {
      const listener = vi.fn();
      const unsubscribe = onToolRegistration(listener);

      toolRegistry.registerToolSurface({
        toolName: "listened_tool",
        contextAreas: [],
        preconditions: [],
        sideEffects: [],
      });

      expect(listener).toHaveBeenCalledWith({
        action: "register",
        toolName: "listened_tool",
        tool: expect.objectContaining({ toolName: "listened_tool" }),
      });

      unsubscribe();
    });

    it("notifies on unregistration", () => {
      const listener = vi.fn();

      toolRegistry.registerToolSurface({
        toolName: "to_remove",
        contextAreas: [],
        preconditions: [],
        sideEffects: [],
      });

      const unsubscribe = onToolRegistration(listener);
      toolRegistry.unregisterTool("to_remove");

      expect(listener).toHaveBeenCalledWith({
        action: "unregister",
        toolName: "to_remove",
        tool: undefined,
      });

      unsubscribe();
    });

    it("unsubscribe stops notifications", () => {
      const listener = vi.fn();
      const unsubscribe = onToolRegistration(listener);

      unsubscribe();

      toolRegistry.registerToolSurface({
        toolName: "after_unsub",
        contextAreas: [],
        preconditions: [],
        sideEffects: [],
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it("handles listener errors gracefully", () => {
      const badListener = vi.fn(() => {
        throw new Error("Listener error");
      });
      const goodListener = vi.fn();

      const unsub1 = onToolRegistration(badListener);
      const unsub2 = onToolRegistration(goodListener);

      // Should not throw
      expect(() => {
        toolRegistry.registerToolSurface({
          toolName: "error_test",
          contextAreas: [],
          preconditions: [],
          sideEffects: [],
        });
      }).not.toThrow();

      // Good listener should still be called
      expect(goodListener).toHaveBeenCalled();

      unsub1();
      unsub2();
    });
  });
});
