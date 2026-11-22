/**
 * searchCache 单元测试
 * 覆盖：读写往返、过期、hash 碰撞校验、内存上限、清理逻辑
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { searchCache } from '../searchCache';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const makeResults = (title: string) => [
  {
    id: 1,
    title,
    poster: 'http://example.com/p.jpg',
    episodes: ['http://example.com/e1.m3u8'],
    source: 'src',
    source_name: '源',
    year: '2024',
  },
];

describe('SearchCache', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    await searchCache.clear();
  });

  it('set 后 get 应命中并返回相同数据', async () => {
    const results = makeResults('庆余年');
    await searchCache.set('庆余年', results);

    const cached = await searchCache.get('庆余年');
    expect(cached).toEqual(results);
  });

  it('查询规范化：大小写与首尾空格应命中同一条目', async () => {
    await searchCache.set('  Test Query ', makeResults('Test'));
    expect(await searchCache.get('test query')).not.toBeNull();
    expect(await searchCache.get('  TEST QUERY ')).not.toBeNull();
  });

  it('未缓存的查询应返回 null', async () => {
    expect(await searchCache.get('不存在的关键词')).toBeNull();
  });

  it('hash 碰撞：不同查询命中同一 key 时不得返回错误数据', async () => {
    // 通过私有方法拿到 A、B 两个不同查询的缓存 key，
    // 若两者 hash 相同（碰撞），B 的读取必须返回 null 而非 A 的结果
    const getKey = (q: string) =>
      (searchCache as any).generateCacheKey(q);

    await searchCache.set('queryA', makeResults('A'));

    // 直接构造碰撞场景：把 A 的结果写到 B 的 key 下（模拟碰撞遗留数据）
    const keyA = getKey('queryA');
    const keyB = getKey('queryB');
    const entryA = await AsyncStorage.getItem(keyA);
    expect(entryA).not.toBeNull();
    await AsyncStorage.setItem(keyB, entryA!);

    // B 读取：query 校验失败 → 视为 miss（null），且错误条目被清理
    const cached = await searchCache.get('queryB');
    expect(cached).toBeNull();
    expect(await AsyncStorage.getItem(keyB)).toBeNull();
  });

  it('过期条目应被清除并返回 null', async () => {
    const results = makeResults('庆余年');
    await searchCache.set('庆余年', results);

    // 将时间戳回拨到 25 小时前
    const key = (searchCache as any).generateCacheKey('庆余年');
    const entry = JSON.parse((await AsyncStorage.getItem(key))!);
    entry.timestamp = Date.now() - 25 * 60 * 60 * 1000;
    await AsyncStorage.setItem(key, JSON.stringify(entry));
    (searchCache as any).memoryCache.clear(); // 强制走持久层读取

    expect(await searchCache.get('庆余年')).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
  });

  it('clear(单个查询) 只清对应条目', async () => {
    await searchCache.set('A', makeResults('A'));
    await searchCache.set('B', makeResults('B'));

    await searchCache.clear('A');

    expect(await searchCache.get('A')).toBeNull();
    expect(await searchCache.get('B')).not.toBeNull();
  });

  it('内存缓存应有上限（MAX_CACHE_ENTRIES=50）', async () => {
    const total = 60;
    for (let i = 0; i < total; i++) {
      await searchCache.set(`关键词${i}`, makeResults(`t${i}`));
    }
    const memorySize = (searchCache as any).memoryCache.size;
    // 每次超限写入会淘汰最旧条目：60 次写入后应稳定在 50
    expect(memorySize).toBe(50);
    // 而最新的条目仍在
    expect(await searchCache.get('关键词59')).not.toBeNull();
  });
});
