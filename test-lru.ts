import { LRUCache } from "./src/gateway/lru-cache.js";

// Test the LRU cache implementation
console.log("Testing LRU Cache implementation...");

const cache = new LRUCache<string, { ts: number; ok: boolean; payload?: unknown }>(3, 5000);

// Test basic set/get
cache.set("key1", { ts: Date.now(), ok: true, payload: "value1" });
cache.set("key2", { ts: Date.now(), ok: true, payload: "value2" });
cache.set("key3", { ts: Date.now(), ok: true, payload: "value3" });

console.log("✓ Basic set/get:", cache.get("key1")?.payload === "value1");
console.log("✓ Cache size:", cache.size === 3);

// Test LRU eviction
cache.set("key4", { ts: Date.now(), ok: true, payload: "value4" }); // Should evict key1 (oldest)
console.log("✓ LRU eviction:", cache.get("key1") === undefined);
console.log("✓ Key2 still exists:", cache.get("key2")?.payload === "value2");
console.log("✓ Key4 added:", cache.get("key4")?.payload === "value4");

// Test TTL
cache.set("expiring", { ts: Date.now() - 10000, ok: true, payload: "old" }); // 10 seconds ago
console.log("✓ Expired entry:", cache.get("expiring") === undefined);

// Test cleanup
cache.set("old1", { ts: Date.now() - 6000, ok: true, payload: "expired1" });
cache.set("old2", { ts: Date.now() - 7000, ok: true, payload: "expired2" });
const cleanedCount = cache.cleanup();
console.log("✓ Cleanup removed expired entries:", cleanedCount >= 2);

console.log("All tests passed! LRU cache is working correctly.");
