import { useCallback, useState, useRef, RefObject, useMemo } from 'react';
import { Video, ResizeMode } from 'expo-av';
import Toast from 'react-native-toast-message';
import usePlayerStore from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { api } from '@/services/api';
import { isM3U8Url } from '@/services/m3u8Filter';
import useDetailStore from '@/stores/detailStore';
import Logger from '@/utils/Logger';

const logger = Logger.withTag('VideoHandlers');

// 去广告代理模式状态机：MoonTVPlus 端点 → 旧版 MoonTV 端点 → 直连
type AdBlockMode = 'moontvplus' | 'legacy' | 'direct';

interface UseVideoHandlersProps {
  videoRef: RefObject<Video>;
  currentEpisode: { url: string; title: string } | undefined;
  initialPosition: number;
  introEndTime?: number;
  playbackRate: number;
  handlePlaybackStatusUpdate: (status: any) => void;
  deviceType: string;
  detail?: { poster?: string; source?: string };
}

export const useVideoHandlers = ({
  videoRef,
  currentEpisode,
  initialPosition,
  introEndTime,
  playbackRate,
  handlePlaybackStatusUpdate,
  deviceType,
  detail,
}: UseVideoHandlersProps) => {
  const failedProxyUrls = useRef<Set<string>>(new Set());
  const [adBlockMode, setAdBlockMode] = useState<AdBlockMode>('moontvplus');

  const onLoad = useCallback(async () => {
    console.info(`[PERF] Video onLoad - video ready to play`);
    
    try {
      const jumpPosition = initialPosition || introEndTime || 0;
      if (jumpPosition > 0) {
        console.info(`[PERF] Setting initial position to ${jumpPosition}ms`);
        await videoRef.current?.setPositionAsync(jumpPosition);
      }
      
      console.info(`[AUTOPLAY] Attempting to start playback after onLoad`);
      await videoRef.current?.playAsync();
      console.info(`[AUTOPLAY] Auto-play successful after onLoad`);
      
      usePlayerStore.setState({ isLoading: false });
      console.info(`[PERF] Video loading complete - isLoading set to false`);
    } catch (error) {
      console.warn(`[AUTOPLAY] Failed to auto-play after onLoad:`, error);
      usePlayerStore.setState({ isLoading: false });
    }
  }, [videoRef, initialPosition, introEndTime]);

  const onLoadStart = useCallback(() => {
    if (!currentEpisode?.url) return;
    
    console.info(`[PERF] Video onLoadStart - starting to load video: ${currentEpisode.url.substring(0, 100)}...`);
    usePlayerStore.setState({ isLoading: true });
  }, [currentEpisode?.url]);

  // 根据当前模式与后端探测结果生成代理 URL；direct 或不适用时返回 null
  const buildProxyUrl = useCallback((url: string, source: string): string | null => {
    if (adBlockMode === 'direct') return null;
    const { proxyEndpointStyle } = useSettingsStore.getState();
    if (adBlockMode === 'legacy') {
      // 已知后端是 MoonTVPlus 时无需再回退旧端点（该路径只对直播源有效）
      if (proxyEndpointStyle === 'moontvplus') return null;
      return api.getM3U8ProxyUrl(url, source);
    }
    // adBlockMode === 'moontvplus'
    if (proxyEndpointStyle === 'legacy') {
      return api.getM3U8ProxyUrl(url, source);
    }
    return api.getMoonTVPlusProxyM3U8Url(url, source);
  }, [adBlockMode]);

  // 代理失败后的降级目标：moontvplus → legacy（仅旧版后端）→ direct
  const degradeAdBlockMode = useCallback((current: AdBlockMode): AdBlockMode => {
    if (current === 'moontvplus') {
      const { proxyEndpointStyle } = useSettingsStore.getState();
      // 已探测为 MoonTVPlus 的后端没有可用的旧端点，直接直连
      return proxyEndpointStyle === 'moontvplus' ? 'direct' : 'legacy';
    }
    return 'direct';
  }, []);

  const onError = useCallback((error: any) => {
    if (!currentEpisode?.url) return;

    console.error(`[ERROR] Video playback error:`, error);

    if (adBlockMode !== 'direct' && useSettingsStore.getState().blockAdsEnabled && isM3U8Url(currentEpisode.url)) {
      const apiBaseUrl = useSettingsStore.getState().apiBaseUrl;
      if (apiBaseUrl) {
        const source = detail?.source || useDetailStore.getState()?.detail?.source || '';
        const proxyUrl = adBlockMode === 'moontvplus'
          ? api.getMoonTVPlusProxyM3U8Url(currentEpisode.url, source)
          : api.getM3U8ProxyUrl(currentEpisode.url, source);
        if (!failedProxyUrls.current.has(proxyUrl)) {
          failedProxyUrls.current.add(proxyUrl);
          const nextMode = degradeAdBlockMode(adBlockMode);
          logger.warn(`[AD_BLOCK] Proxy mode '${adBlockMode}' failed, degrading to '${nextMode}'`);
          setAdBlockMode(nextMode);
          return;
        }
      }
    }
    
    const errorString = (error as any)?.error?.toString() || error?.toString() || '';
    const isSSLError = errorString.includes('SSLHandshakeException') || 
                      errorString.includes('CertPathValidatorException') ||
                      errorString.includes('Trust anchor for certification path not found');
    const isNetworkError = errorString.includes('HttpDataSourceException') ||
                         errorString.includes('IOException') ||
                         errorString.includes('SocketTimeoutException');
    
    if (isSSLError) {
      console.error(`[SSL_ERROR] SSL certificate validation failed for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "SSL证书错误，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('ssl', currentEpisode.url);
    } else if (isNetworkError) {
      console.error(`[NETWORK_ERROR] Network connection failed for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "网络连接失败，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('network', currentEpisode.url);
    } else {
      console.error(`[VIDEO_ERROR] Other video error for URL: ${currentEpisode.url}`);
      Toast.show({ 
        type: "error", 
        text1: "视频播放失败，正在尝试其他播放源...",
        text2: "请稍候"
      });
      usePlayerStore.getState().handleVideoError('other', currentEpisode.url);
    }
  }, [currentEpisode?.url, detail?.source, adBlockMode, degradeAdBlockMode]);

  const blockAdsEnabled = useSettingsStore((s) => s.blockAdsEnabled);

  const getVideoUrl = useCallback((url: string): string => {
    if (!url) return url;
    const apiBaseUrl = useSettingsStore.getState().apiBaseUrl;
    if (!blockAdsEnabled || !apiBaseUrl || !isM3U8Url(url)) {
      return url;
    }
    const source = detail?.source || useDetailStore.getState()?.detail?.source || '';
    const proxyUrl = buildProxyUrl(url, source);
    if (proxyUrl === null) {
      logger.info('[AD_BLOCK] Proxy unavailable, using direct playback');
      return url;
    }
    if (failedProxyUrls.current.has(proxyUrl)) {
      logger.info('[AD_BLOCK] Skipping previously failed proxy URL, using direct playback');
      return url;
    }
    return proxyUrl;
  }, [blockAdsEnabled, detail?.source, buildProxyUrl]);

  const videoUrl = useMemo(() => getVideoUrl(currentEpisode?.url || ''), [currentEpisode?.url, getVideoUrl]);

  const videoProps = useMemo(() => ({
    source: { uri: videoUrl },
    posterSource: { uri: detail?.poster ?? "" },
    resizeMode: ResizeMode.CONTAIN,
    rate: playbackRate,
    onPlaybackStatusUpdate: handlePlaybackStatusUpdate,
    onLoad,
    onLoadStart,
    onError,
    useNativeControls: deviceType !== 'tv',
    shouldPlay: true,
  }), [
    videoUrl,
    detail?.poster,
    playbackRate,
    handlePlaybackStatusUpdate,
    onLoad,
    onLoadStart,
    onError,
    deviceType,
  ]);

  return {
    onLoad,
    onLoadStart,
    onError,
    videoProps,
  };
};