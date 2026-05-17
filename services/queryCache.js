/**
 * In-Memory Query Cache Service
 * Caches query results to reduce API calls and improve response time
 * Implements LRU (Least Recently Used) eviction policy
 */

class QueryCache {
  constructor(maxSize = 100, ttlMs = 3600000) {
    // maxSize: max queries to cache
    // ttlMs: time-to-live in milliseconds (default 1 hour)
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generate cache key from query and collection
   */
  generateKey(query, collectionName) {
    return `${collectionName}::${query.toLowerCase().trim()}`;
  }

  /**
   * Set cache entry
   */
  set(query, collectionName, result) {
    const key = this.generateKey(query, collectionName);

    // If cache is full, remove oldest entry (LRU)
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
      console.log(`[QueryCache] Evicted oldest entry (cache full at ${this.maxSize})`);
    }

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      hits: 0,
    });

    console.log(`[QueryCache] Cached: ${key} (total: ${this.cache.size}/${this.maxSize})`);
  }

  /**
   * Get cache entry if valid (not expired)
   */
  get(query, collectionName) {
    const key = this.generateKey(query, collectionName);
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    // Check if expired
    const age = Date.now() - entry.timestamp;
    if (age > this.ttlMs) {
      this.cache.delete(key);
      console.log(`[QueryCache] Cache expired for: ${key}`);
      this.misses++;
      return null;
    }

    // Update entry (move to end for LRU)
    entry.hits++;
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    console.log(
      `[QueryCache] Cache HIT: ${key} (hits: ${this.hits}, misses: ${this.misses}, ratio: ${(
        (this.hits / (this.hits + this.misses)) *
        100
      ).toFixed(1)}%)`
    );

    return entry.result;
  }

  /**
   * Clear specific cache entry
   */
  invalidate(query, collectionName) {
    const key = this.generateKey(query, collectionName);
    const deleted = this.cache.delete(key);
    if (deleted) {
      console.log(`[QueryCache] Invalidated: ${key}`);
    }
    return deleted;
  }

  /**
   * Clear all cache for a collection (when document is updated)
   */
  invalidateCollection(collectionName) {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${collectionName}::`)) {
        this.cache.delete(key);
        count++;
      }
    }
    console.log(`[QueryCache] Invalidated ${count} entries for collection: ${collectionName}`);
    return count;
  }

  /**
   * Clear entire cache
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    console.log(`[QueryCache] Cleared entire cache (${size} entries)`);
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? ((this.hits / total) * 100).toFixed(1) : "N/A",
      utilization: ((this.cache.size / this.maxSize) * 100).toFixed(1),
    };
  }

  /**
   * Print cache statistics
   */
  printStats() {
    const stats = this.getStats();
    console.log(`
[QueryCache Stats]
  Size: ${stats.size}/${stats.maxSize}
  Hit Rate: ${stats.hitRate}% (${stats.hits} hits, ${stats.misses} misses)
  Utilization: ${stats.utilization}%
    `);
  }
}

// Create singleton instance
export const queryCache = new QueryCache(100, 3600000); // 100 queries, 1 hour TTL

/**
 * Middleware to check cache before processing
 */
export function getCachedResult(query, collectionName) {
  return queryCache.get(query, collectionName);
}

/**
 * Cache result after processing
 */
export function cacheResult(query, collectionName, result) {
  queryCache.set(query, collectionName, result);
}

/**
 * Get cache statistics for monitoring
 */
export function getCacheStats() {
  return queryCache.getStats();
}

/**
 * Clear cache for a specific collection
 */
export function invalidateCollectionCache(collectionName) {
  return queryCache.invalidateCollection(collectionName);
}
