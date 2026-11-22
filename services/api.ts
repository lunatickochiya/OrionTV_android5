import AsyncStorage from "@react-native-async-storage/async-storage";
import { searchCache } from "./searchCache";

// region: --- Interface Definitions ---
export interface DoubanItem {
  title: string;
  poster: string;
  rate?: string;
}

export interface DoubanResponse {
  code: number;
  message: string;
  list: DoubanItem[];
}

export interface VideoDetail {
  id: string;
  title: string;
  poster: string;
  source: string;
  source_name: string;
  desc?: string;
  type?: string;
  year?: string;
  area?: string;
  director?: string;
  actor?: string;
  remarks?: string;
}

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

export interface Favorite {
  cover: string;
  title: string;
  source_name: string;
  total_episodes: number;
  search_title: string;
  year: string;
  save_time?: number;
}

export interface PlayRecord {
  title: string;
  source_name: string;
  cover: string;
  index: number;
  total_episodes: number;
  play_time: number;
  total_time: number;
  save_time: number;
  year: string;
}

export interface ApiSite {
  key: string;
  api: string;
  name: string;
  detail?: string;
}

export interface ServerConfig {
  SiteName: string;
  StorageType: "localstorage" | "redis" | string;
  // MoonTVPlus 起新增的可选字段（旧版 MoonTV 不返回）
  Version?: string;
  TVModeEnabled?: boolean;
}

/**
 * M3U8 去广告代理端点风格：
 * - moontvplus: MoonTVPlus 的外部播放器专用端点 /api/proxy-m3u8（token 鉴权 + 服务端去广告）
 * - legacy: 旧版 MoonTV 的 /api/proxy/m3u8（cookie 鉴权，moontv-source 参数）
 * - unknown: 尚未探测
 */
export type ProxyEndpointStyle = "moontvplus" | "legacy" | "unknown";

export class API {
  public baseURL: string = "";
  public proxyToken: string = "";

  // 会话恢复回调（由 authStore 注册），401 时自动重登并重试一次
  private sessionRestorer: (() => Promise<boolean>) | null = null;

  constructor(baseURL?: string) {
    if (baseURL) {
      this.baseURL = baseURL;
    }
  }

  public setBaseUrl(url: string) {
    this.baseURL = url;
  }

  public setProxyToken(token: string) {
    this.proxyToken = token;
  }

  public setSessionRestorer(restorer: (() => Promise<boolean>) | null) {
    this.sessionRestorer = restorer;
  }

  private async _fetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.baseURL) {
      throw new Error("API_URL_NOT_SET");
    }

    // 框架默认会携带 cookie，无需手动设置
    const response = await fetch(`${this.baseURL}${url}`, options);

    if (response.status === 401) {
      // 会话过期：自动重登后重试一次（登录接口本身除外，避免循环）
      if (this.sessionRestorer && !url.startsWith("/api/login")) {
        const restored = await this.sessionRestorer();
        if (restored) {
          const retryResponse = await fetch(`${this.baseURL}${url}`, options);
          if (retryResponse.status === 401) {
            throw new Error("UNAUTHORIZED");
          }
          if (!retryResponse.ok) {
            throw new Error(`HTTP error! status: ${retryResponse.status}`);
          }
          return retryResponse;
        }
      }
      throw new Error("UNAUTHORIZED");
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response;
  }

  async login(username?: string | undefined, password?: string): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    // 存储cookie到AsyncStorage
    const cookies = response.headers.get("Set-Cookie");
    if (cookies) {
      await AsyncStorage.setItem("authCookies", cookies);
    }

    return response.json();
  }

  async logout(): Promise<{ ok: boolean }> {
    const response = await this._fetch("/api/logout", {
      method: "POST",
    });
    await AsyncStorage.setItem("authCookies", '');
    return response.json();
  }

  async getServerConfig(): Promise<ServerConfig> {
    const response = await this._fetch("/api/server-config");
    return response.json();
  }

  async getFavorites(key?: string): Promise<Record<string, Favorite> | Favorite | null> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url);
    return response.json();
  }

  async addFavorite(key: string, favorite: Omit<Favorite, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, favorite }),
    });
    return response.json();
  }

  async deleteFavorite(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/favorites?key=${encodeURIComponent(key)}` : "/api/favorites";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getPlayRecords(): Promise<Record<string, PlayRecord>> {
    const response = await this._fetch("/api/playrecords");
    return response.json();
  }

  async savePlayRecord(key: string, record: Omit<PlayRecord, "save_time">): Promise<{ success: boolean }> {
    const response = await this._fetch("/api/playrecords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, record }),
    });
    return response.json();
  }

  async deletePlayRecord(key?: string): Promise<{ success: boolean }> {
    const url = key ? `/api/playrecords?key=${encodeURIComponent(key)}` : "/api/playrecords";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  async getSearchHistory(): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory");
    return response.json();
  }

  async addSearchHistory(keyword: string): Promise<string[]> {
    const response = await this._fetch("/api/searchhistory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyword }),
    });
    return response.json();
  }

  async deleteSearchHistory(keyword?: string): Promise<{ success: boolean }> {
    const url = keyword ? `/api/searchhistory?keyword=${keyword}` : "/api/searchhistory";
    const response = await this._fetch(url, { method: "DELETE" });
    return response.json();
  }

  getImageProxyUrl(imageUrl: string): string {
    return `${this.baseURL}/api/image-proxy?url=${encodeURIComponent(imageUrl)}`;
  }

  getM3U8ProxyUrl(videoUrl: string, source: string): string {
    let url = `${this.baseURL}/api/proxy/m3u8?url=${encodeURIComponent(videoUrl)}&moontv-source=${encodeURIComponent(source)}`;
    if (this.proxyToken) {
      url += `&token=${encodeURIComponent(this.proxyToken)}`;
    }
    return url;
  }

  /**
   * MoonTVPlus 外部播放器代理 URL：
   * GET /api/proxy-m3u8?url=<原始m3u8>&source=<源key>&token=<鉴权token>[&adblock=false]
   * 服务端执行去广告（含站长自定义规则），无需登录 cookie。
   */
  getMoonTVPlusProxyM3U8Url(videoUrl: string, source: string, adBlock: boolean = true): string {
    let url = `${this.baseURL}/api/proxy-m3u8?url=${encodeURIComponent(videoUrl)}&source=${encodeURIComponent(source)}`;
    if (this.proxyToken) {
      url += `&token=${encodeURIComponent(this.proxyToken)}`;
    }
    if (!adBlock) {
      url += `&adblock=false`;
    }
    return url;
  }

  /**
   * 探测后端 M3U8 代理端点风格。
   * MoonTVPlus 存在 /api/proxy-m3u8 路由（无参数返回 400/401），
   * 旧版 MoonTV 没有该路由（404）。
   */
  async probeProxyEndpointStyle(): Promise<ProxyEndpointStyle> {
    if (!this.baseURL) {
      return "unknown";
    }
    try {
      const response = await fetch(`${this.baseURL}/api/proxy-m3u8`);
      return response.status === 404 ? "legacy" : "moontvplus";
    } catch {
      return "unknown";
    }
  }

  getM3U8SegmentUrl(videoUrl: string): string {
    return `${this.baseURL}/api/proxy/segment?url=${encodeURIComponent(videoUrl)}`;
  }

  getM3U8KeyUrl(keyUrl: string): string {
    return `${this.baseURL}/api/proxy/key?url=${encodeURIComponent(keyUrl)}`;
  }

  async getDoubanData(
    type: "movie" | "tv",
    tag: string,
    pageSize: number = 16,
    pageStart: number = 0
  ): Promise<DoubanResponse> {
    const url = `/api/douban?type=${type}&tag=${encodeURIComponent(tag)}&pageSize=${pageSize}&pageStart=${pageStart}`;
    const response = await this._fetch(url);
    return response.json();
  }

  async searchVideos(query: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    // Check cache first
    const cachedResults = await searchCache.get(query);
    if (cachedResults) {
      return { results: cachedResults };
    }

    // Fetch from API if not cached
    const url = `/api/search?q=${encodeURIComponent(query)}`;
    const response = await this._fetch(url, { signal });
    const data = await response.json();

    // Cache the results
    if (data.results && Array.isArray(data.results)) {
      await searchCache.set(query, data.results);
    }

    return data;
  }

  async searchVideo(query: string, resourceId: string, signal?: AbortSignal): Promise<{ results: SearchResult[] }> {
    const url = `/api/search/one?q=${encodeURIComponent(query)}&resourceId=${encodeURIComponent(resourceId)}`;
    const response = await this._fetch(url, { signal });
    const { results } = await response.json();
    return { results: results.filter((item: any) => item.title === query )};
  }

  async getResources(signal?: AbortSignal): Promise<ApiSite[]> {
    const url = `/api/search/resources`;
    const response = await this._fetch(url, { signal });
    return response.json();
  }

  async getVideoDetail(source: string, id: string): Promise<VideoDetail> {
    const url = `/api/detail?source=${source}&id=${id}`;
    const response = await this._fetch(url);
    return response.json();
  }
}

// 默认实例
export let api = new API();
