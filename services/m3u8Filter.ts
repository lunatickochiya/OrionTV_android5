/**
 * M3U8 工具函数。
 *
 * 历史说明：本文件原有的客户端 m3u8 广告过滤逻辑
 * （filterAdsFromM3U8 及其辅助函数）已废弃——去广告统一由后端代理完成
 * （旧版 MoonTV: /api/proxy/m3u8；MoonTVPlus: /api/proxy-m3u8，见 services/api.ts），
 * 客户端只负责把播放地址替换为代理地址，故相关死代码已移除。
 */

export function isM3U8Url(url: string): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  return lowerUrl.endsWith('.m3u8') || lowerUrl.includes('.m3u8?') || lowerUrl.includes('.m3u8#');
}
