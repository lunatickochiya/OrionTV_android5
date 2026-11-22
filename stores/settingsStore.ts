import { create } from "zustand";
import { SettingsManager } from "@/services/storage";
import { api, ServerConfig, ProxyEndpointStyle } from "@/services/api";
import { storageConfig } from "@/services/storageConfig";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "@/utils/Logger";

const logger = Logger.withTag('SettingsStore');

// 探测结果的持久化 key（独立于 SettingsManager，避免污染既有 settings 结构）
const PROXY_ENDPOINT_STYLE_KEY = 'proxyEndpointStyle';

// 模块级引用：当前正在进行的 fetchServerConfig Promise。
// 供 authStore.checkLoginStatus 直接 await，避免用固定超时轮询导致冷启动误判。
let serverConfigPromise: Promise<void> | null = null;

/**
 * 获取当前正在进行的 fetchServerConfig Promise（若没有则返回 null）。
 * 调用方可 await 它以确保 serverConfig 已就绪，而不是用固定超时轮询。
 */
export function getServerConfigPromise(): Promise<void> | null {
  return serverConfigPromise;
}

interface SettingsState {
  apiBaseUrl: string;
  m3uUrl: string;
  remoteInputEnabled: boolean;
  blockAdsEnabled: boolean;
  proxyM3U8Token: string;
  videoSource: {
    enabledAll: boolean;
    sources: {
      [key: string]: boolean;
    };
  };
  isModalVisible: boolean;
  serverConfig: ServerConfig | null;
  isLoadingServerConfig: boolean;
  // 后端 M3U8 代理端点风格（探测后缓存）
  proxyEndpointStyle: ProxyEndpointStyle;
  loadSettings: () => Promise<void>;
  fetchServerConfig: () => Promise<void>;
  detectProxyEndpointStyle: () => Promise<ProxyEndpointStyle>;
  setApiBaseUrl: (url: string) => void;
  setM3uUrl: (url: string) => void;
  setRemoteInputEnabled: (enabled: boolean) => void;
  setBlockAdsEnabled: (enabled: boolean) => void;
  setProxyM3U8Token: (token: string) => void;
  saveSettings: () => Promise<void>;
  setVideoSource: (config: { enabledAll: boolean; sources: { [key: string]: boolean } }) => void;
  showModal: () => void;
  hideModal: () => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  apiBaseUrl: "",
  m3uUrl: "",
  liveStreamSources: [],
  remoteInputEnabled: false,
  blockAdsEnabled: true,
  isModalVisible: false,
  serverConfig: null,
  isLoadingServerConfig: false,
  proxyM3U8Token: "",
  proxyEndpointStyle: "unknown",
  videoSource: {
    enabledAll: true,
    sources: {},
  },
  loadSettings: async () => {
    const settings = await SettingsManager.get();
    set({
      apiBaseUrl: settings.apiBaseUrl,
      m3uUrl: settings.m3uUrl,
      remoteInputEnabled: settings.remoteInputEnabled || false,
      blockAdsEnabled: settings.blockAdsEnabled !== undefined ? settings.blockAdsEnabled : true,
      proxyM3U8Token: settings.proxyM3U8Token || "",
      videoSource: settings.videoSource || {
        enabledAll: true,
        sources: {},
      },
    });
    // 恢复上次探测的后端代理风格（避免每次冷启动都重新探测）
    try {
      const savedStyle = await AsyncStorage.getItem(PROXY_ENDPOINT_STYLE_KEY);
      if (savedStyle === "moontvplus" || savedStyle === "legacy") {
        set({ proxyEndpointStyle: savedStyle });
      }
    } catch {
      // 读取失败按 unknown 处理，后续重新探测
    }
    if (settings.apiBaseUrl) {
      api.setBaseUrl(settings.apiBaseUrl);
      api.setProxyToken(settings.proxyM3U8Token || "");
      await get().fetchServerConfig();
    }
  },
  fetchServerConfig: () => {
    const p = (async () => {
      set({ isLoadingServerConfig: true });
      try {
        const config = await api.getServerConfig();
        if (config) {
          storageConfig.setStorageType(config.StorageType);
          set({ serverConfig: config });
          // fire-and-forget：后台探测后端代理端点风格，不阻塞启动流程
          get().detectProxyEndpointStyle().catch(() => {});
        }
      } catch (error) {
        set({ serverConfig: null });
        logger.error("Failed to fetch server config:", error);
      } finally {
        set({ isLoadingServerConfig: false });
      }
    })();
    serverConfigPromise = p;
    return p;
  },
  detectProxyEndpointStyle: async () => {
    const { proxyEndpointStyle } = get();
    if (proxyEndpointStyle !== "unknown") {
      return proxyEndpointStyle;
    }
    const style = await api.probeProxyEndpointStyle();
    if (style !== "unknown") {
      set({ proxyEndpointStyle: style });
      AsyncStorage.setItem(PROXY_ENDPOINT_STYLE_KEY, style).catch(() => {});
    }
    return style;
  },
  setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
  setM3uUrl: (url) => set({ m3uUrl: url }),
  setRemoteInputEnabled: (enabled) => set({ remoteInputEnabled: enabled }),
  setBlockAdsEnabled: (enabled) => set({ blockAdsEnabled: enabled }),
  setProxyM3U8Token: (token) => set({ proxyM3U8Token: token }),
  setVideoSource: (config) => set({ videoSource: config }),
  saveSettings: async () => {
    const { apiBaseUrl, m3uUrl, remoteInputEnabled, videoSource, blockAdsEnabled, proxyM3U8Token } = get();
    const currentSettings = await SettingsManager.get()
    const currentApiBaseUrl = currentSettings.apiBaseUrl;
    let processedApiBaseUrl = apiBaseUrl.trim();
    if (processedApiBaseUrl.endsWith("/")) {
      processedApiBaseUrl = processedApiBaseUrl.slice(0, -1);
    }

    if (!/^https?:\/\//i.test(processedApiBaseUrl)) {
      const hostPart = processedApiBaseUrl.split("/")[0];
      // Simple check for IP address format.
      const isIpAddress = /^((\d{1,3}\.){3}\d{1,3})(:\d+)?$/.test(hostPart);
      // Check if the domain includes a port.
      const hasPort = /:\d+/.test(hostPart);

      if (isIpAddress || hasPort) {
        processedApiBaseUrl = "http://" + processedApiBaseUrl;
      } else {
        processedApiBaseUrl = "https://" + processedApiBaseUrl;
      }
    }

    await SettingsManager.save({
      apiBaseUrl: processedApiBaseUrl,
      m3uUrl,
      remoteInputEnabled,
      videoSource,
      blockAdsEnabled,
      proxyM3U8Token,
    });
    if ( currentApiBaseUrl !== processedApiBaseUrl) {
      await AsyncStorage.setItem('authCookies', '');
      // 后端地址变更：重置代理端点风格，重新探测
      set({ proxyEndpointStyle: "unknown" });
      AsyncStorage.removeItem(PROXY_ENDPOINT_STYLE_KEY).catch(() => {});
    }
    api.setBaseUrl(processedApiBaseUrl);
    api.setProxyToken(proxyM3U8Token);
    // Also update the URL in the state so the input field shows the processed URL
    set({ isModalVisible: false, apiBaseUrl: processedApiBaseUrl });
    await get().fetchServerConfig();
  },
  showModal: () => set({ isModalVisible: true }),
  hideModal: () => set({ isModalVisible: false }),
}));
