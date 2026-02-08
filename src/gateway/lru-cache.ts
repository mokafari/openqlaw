/**
 * Simple LRU (Least Recently Used) cache implementation.
 * No external dependencies - uses Map for O(1) operations.
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = Math.max(1, maxSize);
    this.ttlMs = Math.max(0, ttlMs);
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);

      // Check TTL if applicable (assumes value has a 'ts' property for TTL check)
      if (this.ttlMs > 0 && typeof value === "object" && value !== null) {
        const entry = value as any;
        if (typeof entry.ts === "number" && Date.now() - entry.ts > this.ttlMs) {
          this.cache.delete(key);
          return undefined;
        }
      }
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      // Key exists, delete to update order
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Cache is full, delete oldest (first) entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Clean expired entries based on TTL.
   * Call periodically for TTL-based eviction.
   */
  cleanup(): number {
    if (this.ttlMs <= 0) {
      return 0;
    }

    const now = Date.now();
    const toDelete: K[] = [];

    for (const [key, value] of this.cache.entries()) {
      if (typeof value === "object" && value !== null) {
        const entry = value as any;
        if (typeof entry.ts === "number" && now - entry.ts > this.ttlMs) {
          toDelete.push(key);
        }
      }
    }

    for (const key of toDelete) {
      this.cache.delete(key);
    }

    return toDelete.length;
  }
}
