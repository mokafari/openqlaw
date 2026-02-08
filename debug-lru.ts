import { LRUCache } from "./src/gateway/lru-cache.js";

// Debug test for LRU cache
console.log("Debugging LRU Cache...");

const cache = new LRUCache<string, { ts: number; ok: boolean; payload?: unknown }>(3, 5000);

console.log("=== Step 1: Add 3 items ===");
cache.set("key1", { ts: Date.now(), ok: true, payload: "value1" });
console.log("Added key1, size:", cache.size);

cache.set("key2", { ts: Date.now(), ok: true, payload: "value2" });
console.log("Added key2, size:", cache.size);

cache.set("key3", { ts: Date.now(), ok: true, payload: "value3" });
console.log("Added key3, size:", cache.size);

console.log("=== Step 2: Check all keys exist ===");
console.log("key1 exists:", cache.get("key1") !== undefined);
console.log("key2 exists:", cache.get("key2") !== undefined);
console.log("key3 exists:", cache.get("key3") !== undefined);

console.log("=== Step 3: Add key4 (should evict oldest) ===");
cache.set("key4", { ts: Date.now(), ok: true, payload: "value4" });
console.log("Added key4, size:", cache.size);

console.log("=== Step 4: Check which keys still exist ===");
console.log("key1 exists:", cache.get("key1") !== undefined, "- should be FALSE");
console.log("key2 exists:", cache.get("key2") !== undefined, "- should be TRUE");
console.log("key3 exists:", cache.get("key3") !== undefined, "- should be TRUE");
console.log("key4 exists:", cache.get("key4") !== undefined, "- should be TRUE");
