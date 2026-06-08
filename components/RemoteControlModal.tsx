import React, { useState, useEffect } from "react";
import { Modal, View, StyleSheet, Platform } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { StyledButton } from "./StyledButton";
import Logger from "@/utils/Logger";

const logger = Logger.withTag('RemoteControlModal');

export const RemoteControlModal: React.FC = () => {
  const { isModalVisible, hideModal, serverUrl, error } = useRemoteControlStore();
  const [renderError, setRenderError] = useState<string | null>(null);

  // 在 Android 5 上，QRCode SVG 可能会崩溃，我们需要捕获这个错误
  const handleQRCodeError = (err: any) => {
    logger.error('QRCode rendering error:', err);
    setRenderError('二维码生成失败，请稍后重试');
    
    // 延迟重置错误状态
    const timer = setTimeout(() => {
      setRenderError(null);
    }, 3000);
    
    return () => clearTimeout(timer);
  };

  // 监听 Modal 关闭时重置错误
  useEffect(() => {
    if (!isModalVisible) {
      setRenderError(null);
    }
  }, [isModalVisible]);

  return (
    <Modal animationType="fade" transparent={true} visible={isModalVisible} onRequestClose={hideModal}>
      <View style={styles.modalContainer}>
        <ThemedView style={styles.modalContent}>
          <ThemedText style={styles.title}>手机扫码</ThemedText>
          <View style={styles.qrContainer}>
            {serverUrl && !renderError ? (
              <View style={styles.qrWrapper}>
                <QRCode
                  value={serverUrl}
                  size={200}
                  backgroundColor="white"
                  color="black"
                  quiet={4}
                  onError={handleQRCodeError}
                  getRef={(ref) => {
                    // Store ref for potential future use
                  }}
                />
              </View>
            ) : renderError ? (
              <ThemedText style={styles.errorMessage}>{renderError}</ThemedText>
            ) : (
              <ThemedText style={styles.statusText}>
                {error ? `错误: ${error}` : "正在生成二维码..."}
              </ThemedText>
            )}
          </View>
          <ThemedText style={styles.instructions}>
            使用手机扫描上方二维码，即可在浏览器中向 TV 发送消息。{serverUrl && `或者访问 ${serverUrl}`}
          </ThemedText>
          <StyledButton 
            text="关闭" 
            onPress={hideModal} 
            style={styles.button} 
            variant="primary" 
          />
        </ThemedView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.7)",
  },
  modalContent: {
    width: "85%",
    maxWidth: 400,
    padding: 24,
    borderRadius: 12,
    alignItems: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 10,
    paddingTop: 10,
  },
  qrContainer: {
    width: 220,
    height: 220,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#f0f0f0",
    borderRadius: 8,
    marginBottom: 20,
    overflow: "hidden",
    // Android 5 兼容性：添加额外的约束
    ...(Platform.OS === 'android' && {
      borderWidth: 1,
      borderColor: "#e0e0e0",
    }),
  },
  qrWrapper: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "white",
    // 防止 SVG 过度绘制
    overflow: "hidden",
  },
  statusText: {
    textAlign: "center",
    fontSize: 16,
  },
  errorMessage: {
    textAlign: "center",
    fontSize: 14,
    color: "#ff6b6b",
  },
  instructions: {
    textAlign: "center",
    marginBottom: 24,
    fontSize: 16,
    color: "#ccc",
  },
  button: {
    width: "100%",
  },
});