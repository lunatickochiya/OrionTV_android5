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
  results: SearchResult[];
  timestamp: number;
}

const CACHE_KEY_PREFIX = 'search_cache_';
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CACHE_ENTRIES = 50;

class SearchCache {
  private memoryCache: Map<string, CacheEntry> = new Map();

  /**
   * Get search results from cache
   * @param query Search query
   * @returns Cached results or null if expired or not found
   */
  public async get(query: string): Promise<SearchResult[] | null> {
    try {
      const cacheKey = this.generateCacheKey(query);

      // Check memory cache first
      const memoryCached = this.memoryCache.get(cacheKey);
      if (memoryCached && !this.isExpired(memoryCached)) {
        logger.debug(`Cache hit (memory) for query: "${query}"`);
        return memoryCached.results;
      }

      // Check persistent storage
      const persistedData = await AsyncStorage.getItem(cacheKey);
      if (persistedData) {
        const entry: CacheEntry = JSON.parse(persistedData);
        if (!this.isExpired(entry)) {
          logger.debug(`Cache hit (storage) for query: "${query}"`);
          // Update memory cache
          this.memoryCache.set(cacheKey, entry);
          return entry.results;
        } else {
          // Remove expired entry
          await AsyncStorage.removeItem(cacheKey);
          this.memoryCache.delete(cacheKey);
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
      const cacheKey = this.generateCacheKey(query);
      const entry: CacheEntry = {
        results,
        timestamp: Date.now(),
      };

      // Store in memory
      this.memoryCache.set(cacheKey, entry);

      // Store in persistent storage
      await AsyncStorage.setItem(cacheKey, JSON.stringify(entry));

      // Clean up old entries if cache is too large
      await this.cleanupOldEntries();

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
        logger.debug(`Cleared cache for query: "${query}"`);
      } else {
        this.memoryCache.clear();
        const keys = await AsyncStorage.getAllKeys();
        const cacheKeys = keys.filter((key) => key.startsWith(CACHE_KEY_PREFIX));
        await AsyncStorage.multiRemove(cacheKeys);
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
   * Generate cache key from query
   */
  private generateCacheKey(query: string): string {
    return `${CACHE_KEY_PREFIX}${query.toLowerCase().trim()}`;
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
        const entries: Array<{ key: string; timestamp: number }> = [];

        for (const key of cacheKeys) {
          const data = await AsyncStorage.getItem(key);
          if (data) {
            const entry: CacheEntry = JSON.parse(data);
            entries.push({ key, timestamp: entry.timestamp });
          }
        }

        // Sort by timestamp and remove oldest ones
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = entries.slice(0, entries.length - MAX_CACHE_ENTRIES);

        for (const entry of toRemove) {
          await AsyncStorage.removeItem(entry.key);
          this.memoryCache.delete(entry.key);
        }

        logger.debug(`Cleaned up ${toRemove.length} old cache entries`);
      }
    } catch (error) {
      logger.warn('Error cleaning up cache:', error);
    }
  }
}

export const searchCache = new SearchCache();
