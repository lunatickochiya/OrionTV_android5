import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag('SearchCache');

export interface SearchResult {
  id: number;
  title: string;
  poster: string;
  episodes: string[];
  source: string;
  source_name: string;
  class?: string;
  year: string;
  desc?: string;
  type_name?: string;
}

interface CacheEntry {
  /** 规范化后的原始查询：hash 碰撞时用于校验，避免不同查询串结果 */
  query: string;
  results: SearchResult[];
  timestamp: number;
}

const CACHE_KEY_PREFIX = 'search_cache_';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_ENTRIES = 50;
// Cleanup is deferred until cache exceeds max by this amount to reduce overhead
const CLEANUP_THRESHOLD_BUFFER = 10;

class SearchCache {
  private memoryCache: Map<string, CacheEntry> = new Map();
  /**
   * 持久层条目计数缓存：避免每次 set 都 getAllKeys 全量枚举。
   * null 表示尚未统计（首次 set 时统计一次），此后按写入增量维护，
   * cleanup 后重新统计。
   */
  private storageCount: number | null = null;

  /**
   * Simple hash function for cache key generation
   * Uses a DJB2-like algorithm suitable for generating collision-resistant cache keys
   * This approach is fast, deterministic, and sufficient for cache key purposes
   */
  private hashQuery(query: string): string {
    let hash = 0;
    const normalized = query.toLowerCase().trim();
    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Get search results from cache
   * @param query Search query
   * @returns Cached results or null if expired, not found, or hash collision
   */
  public async get(query: string): Promise<SearchResult[] | null> {
    try {
      const normalized = this.normalizeQuery(query);
      const cacheKey = this.generateCacheKey(query);

      // Check memory cache first
      const memoryCached = this.memoryCache.get(cacheKey);
      if (memoryCached) {
        if (this.isExpired(memoryCached)) {
          this.memoryCache.delete(cacheKey);
        } else if (this.matchesQuery(memoryCached, normalized)) {
          logger.debug(`Cache hit (memory) for query: "${query}"`);
          return memoryCached.results;
        } else {
          // hash 碰撞：清掉错误条目，按 miss 处理
          logger.warn(`Cache key collision detected for query: "${query}", discarding stale entry`);
          this.memoryCache.delete(cacheKey);
        }
      }

      // Check persistent storage
      const persistedData = await AsyncStorage.getItem(cacheKey);
      if (persistedData) {
        const entry: CacheEntry = JSON.parse(persistedData);
        if (this.isExpired(entry)) {
          // Remove expired entry
          await AsyncStorage.removeItem(cacheKey);
          this.memoryCache.delete(cacheKey);
        } else if (this.matchesQuery(entry, normalized)) {
          logger.debug(`Cache hit (storage) for query: "${query}"`);
          // Update memory cache
          this.memoryCache.set(cacheKey, entry);
          return entry.results;
        } else {
          // hash 碰撞：清掉错误条目，按 miss 处理
          logger.warn(`Cache key collision detected for query: "${query}", discarding persisted entry`);
          await AsyncStorage.removeItem(cacheKey);
        }
      }

      logger.debug(`Cache miss for query: "${query}"`);
      return null;
    } catch (error) {
      logger.warn(`Error retrieving cache for query "${query}":`, error);
      return null;
    }
  }

  /**
   * Set search results in cache
   * @param query Search query
   * @param results Search results
   */
  public async set(query: string, results: SearchResult[]): Promise<void> {
    try {
      const normalized = this.normalizeQuery(query);
      const cacheKey = this.generateCacheKey(query);
      const entry: CacheEntry = {
        query: normalized,
        results,
        timestamp: Date.now(),
      };

      // Store in memory（超限时淘汰最旧条目，Map 迭代序即插入序）
      if (!this.memoryCache.has(cacheKey) && this.memoryCache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = this.memoryCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.memoryCache.delete(oldestKey);
        }
      }
      this.memoryCache.set(cacheKey, entry);

      // Store in persistent storage
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));

      // 惰性统计：首次写入时统计一次持久层条目数，此后按写入增量维护，
      // 避免每次 set 都 getAllKeys 全量枚举（AsyncStorage 全库扫描开销）
      if (this.storageCount === null) {
        const stats = await this.getStats();
        this.storageCount = stats.storageCacheSize;
      } else {
        this.storageCount += 1;
      }

      if (this.storageCount > MAX_CACHE_ENTRIES + CLEANUP_THRESHOLD_BUFFER) {
        await this.cleanupOldEntries();
      }

      logger.debug(`Cached search results for query: "${query}"`);
    } catch (error) {
      logger.warn(`Error caching results for query "${query}":`, error);
    }
  }

  /**
   * Clear cache for a specific query or all cache
   * @param query Specific query to clear, or undefined to clear all
   */
  public async clear(query?: string): Promise<void> {
    try {
      if (query) {
        const cacheKey = this.generateCacheKey(query);
        this.memoryCache.delete(cacheKey);
        await AsyncStorage.removeItem(cacheKey);
        if (this.storageCount !== null && this.storageCount > 0) {
          this.storageCount -= 1;
        }
        logger.debug(`Cleared cache for query: "${query}"`);
      } else {
        this.memoryCache.clear();
        const keys = await AsyncStorage.getAllKeys();
        const cacheKeys = keys.filter((key) => key.startsWith(CACHE_KEY_PREFIX));
        await AsyncStorage.multiRemove(cacheKeys);
        this.storageCount = 0;
        logger.debug('Cleared all search cache');
      }
    } catch (error) {
      logger.warn('Error clearing cache:', error);
    }
  }

  /**
   * Get cache statistics
   */
  public async getStats(): Promise<{ memoryCacheSize: number; storageCacheSize: number }> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter((key) => key.startsWith(CACHE_KEY_PREFIX));
      return {
        memoryCacheSize: this.memoryCache.size,
        storageCacheSize: cacheKeys.length,
      };
    } catch (error) {
      logger.warn('Error getting cache stats:', error);
      return { memoryCacheSize: this.memoryCache.size, storageCacheSize: 0 };
    }
  }

  /**
   * Generate cache key from query using hash to prevent collisions
   */
  private generateCacheKey(query: string): string {
    const hash = this.hashQuery(query);
    // Use only hash for safe storage key (avoids special character issues)
    return `${CACHE_KEY_PREFIX}${hash}`;
  }

  /**
   * Normalize query for cache identity (与 hashQuery 保持一致的规范化规则)
   */
  private normalizeQuery(query: string): string {
    return query.toLowerCase().trim();
  }

  /**
   * 校验缓存条目确实属于该查询（防 32 位 hash 碰撞返回无关结果）
   */
  private matchesQuery(entry: CacheEntry, normalizedQuery: string): boolean {
    return entry.query === normalizedQuery;
  }

  /**
   * Check if cache entry is expired
   */
  private isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > CACHE_EXPIRY_MS;
  }

  /**
   * Clean up old cache entries to prevent storage bloat
   */
  private async cleanupOldEntries(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter((key) => key.startsWith(CACHE_KEY_PREFIX));

      // If cache size exceeds limit, remove oldest entries
      if (cacheKeys.length > MAX_CACHE_ENTRIES) {
        // Use multiGet to fetch all entries in one batch for efficiency
        const batchedEntries = await AsyncStorage.multiGet(cacheKeys);
        const entries: { key: string; timestamp: number }[] = [];

        for (const [key, data] of batchedEntries) {
          if (data) {
            try {
              const entry: CacheEntry = JSON.parse(data);
              entries.push({ key, timestamp: entry.timestamp });
            } catch {
              // Skip malformed entries
              logger.warn(`Skipping malformed cache entry: ${key}`);
            }
          }
        }

        // Sort by timestamp and remove oldest ones
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);
        const keysToRemove = toRemove.map((entry) => entry.key);

        if (keysToRemove.length > 0) {
          await AsyncStorage.multiRemove(keysToRemove);
          keysToRemove.forEach((key) => this.memoryCache.delete(key));
          // 同步计数缓存，保持后续阈值判断准确
          this.storageCount = entries.length - keysToRemove.length;
          logger.debug(`Cleaned up ${keysToRemove.length} old cache entries`);
        }
      }
    } catch (error) {
      logger.warn('Error cleaning up cache:', error);
    }
  }
}

export const searchCache = new SearchCache();
