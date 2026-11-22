import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { View, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, BackHandler } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { useResponsiveLayout } from "@/hooks/useResponsiveLayout";
import { getCommonResponsiveStyles } from "@/utils/ResponsiveStyles";

interface CustomScrollViewProps {
  data: any[];
  renderItem: ({ item, index }: { item: any; index: number }) => React.ReactNode;
  numColumns?: number; // 如果不提供，将使用响应式默认值
  loading?: boolean;
  loadingMore?: boolean;
  error?: string | null;
  onEndReached?: () => void;
  /** @deprecated 已改用 FlatList 的 onEndReachedThreshold（0.5 屏）触发加载 */
  loadMoreThreshold?: number;
  emptyMessage?: string;
  ListFooterComponent?: React.ComponentType<any> | React.ReactElement | null;
  keyExtractor?: (item: any, index: number) => string;
}

/**
 * 虚拟化网格列表（FlatList numColumns）。
 * 之前基于 ScrollView 全量渲染所有行，翻页加载的卡片与海报位图
 * 全部驻留内存，在 Android 5 低内存 TV 上极易 OOM；
 * 改为 FlatList 后屏外条目自动卸载回收。
 */
const CustomScrollView: React.FC<CustomScrollViewProps> = ({
  data,
  renderItem,
  numColumns,
  loading = false,
  loadingMore = false,
  error = null,
  onEndReached,
  emptyMessage = "暂无内容",
  ListFooterComponent,
  keyExtractor,
}) => {
  const listRef = useRef<FlatList>(null);
  const [showScrollToTop, setShowScrollToTop] = useState(false);
  const responsiveConfig = useResponsiveLayout();
  const commonStyles = getCommonResponsiveStyles(responsiveConfig);
  const { deviceType } = responsiveConfig;

  const scrollToTop = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }, []);

  // 添加返回键处理逻辑
  useEffect(() => {
    if (deviceType === 'tv') {
      const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (showScrollToTop) {
          scrollToTop();
          return true; // 阻止默认的返回行为
        }
        return false; // 允许默认的返回行为
      });

      return () => backHandler.remove();
    }
  }, [showScrollToTop, deviceType, scrollToTop]);

  // 使用响应式列数，如果没有明确指定的话
  const effectiveColumns = numColumns || responsiveConfig.columns;

  const handleScroll = useCallback(
    ({ nativeEvent }: { nativeEvent: any }) => {
      const { contentOffset } = nativeEvent;
      // 显示/隐藏返回顶部按钮
      setShowScrollToTop(contentOffset.y > 200);
    },
    []
  );

  // 稳定 key：优先 item 自身的业务标识（id+source），避免翻页增量时 key 错位
  const internalKeyExtractor = useCallback(
    (item: any, index: number): string => {
      if (keyExtractor) return keyExtractor(item, index);
      if (item && item.id !== undefined) {
        return `${item.source ?? ''}-${item.id}`;
      }
      if (item && item.title !== undefined) {
        return `${item.source ?? ''}-${item.title}`;
      }
      return String(index);
    },
    [keyExtractor]
  );

  const renderFooter = () => {
    if (ListFooterComponent) {
      if (React.isValidElement(ListFooterComponent)) {
        return ListFooterComponent;
      } else if (typeof ListFooterComponent === "function") {
        const Component = ListFooterComponent as React.ComponentType<any>;
        return <Component />;
      }
      return null;
    }
    if (loadingMore) {
      return <ActivityIndicator style={{ marginVertical: 20 }} size="large" />;
    }
    return null;
  };

  // 动态样式（缓存，避免每次 render 重建）
  const dynamicStyles = useMemo(() => StyleSheet.create({
    listContent: {
      paddingBottom: responsiveConfig.spacing * 2,
      paddingHorizontal: responsiveConfig.spacing / 2,
    },
    itemContainer: {
      width: responsiveConfig.cardWidth,
      marginRight: responsiveConfig.spacing,
      marginBottom: responsiveConfig.spacing,
    },
    scrollToTopButton: {
      position: 'absolute',
      right: responsiveConfig.spacing,
      bottom: responsiveConfig.spacing * 2,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      padding: responsiveConfig.spacing,
      borderRadius: responsiveConfig.spacing,
      opacity: showScrollToTop ? 1 : 0,
    },
  }), [responsiveConfig.spacing, responsiveConfig.cardWidth, showScrollToTop]);

  if (loading) {
    return (
      <View style={commonStyles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={commonStyles.center}>
        <ThemedText type="subtitle" style={{ padding: responsiveConfig.spacing }}>
          {error}
        </ThemedText>
      </View>
    );
  }

  if (data.length === 0) {
    return (
      <View style={commonStyles.center}>
        <ThemedText>{emptyMessage}</ThemedText>
      </View>
    );
  }

  // 虚拟化窗口参数：TV 端滚屏慢、焦点跳转多，保留稍大的首屏渲染量
  const initialNumToRender = Math.max(effectiveColumns * 3, 8);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={listRef}
        // numColumns 运行期变化需强制重建
        key={`grid-${effectiveColumns}`}
        numColumns={effectiveColumns}
        data={data}
        renderItem={({ item, index }) => (
          <View style={dynamicStyles.itemContainer}>
            {renderItem({ item, index })}
          </View>
        )}
        keyExtractor={internalKeyExtractor}
        contentContainerStyle={dynamicStyles.listContent}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={deviceType !== 'tv'}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        ListFooterComponent={renderFooter}
        initialNumToRender={initialNumToRender}
        maxToRenderPerBatch={effectiveColumns}
        windowSize={7}
      />
      {deviceType !== 'tv' && (
        <TouchableOpacity
          style={dynamicStyles.scrollToTopButton}
          onPress={scrollToTop}
          activeOpacity={0.8}
        >
          <ThemedText>⬆️</ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
};

export default CustomScrollView;
