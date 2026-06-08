import React, { useEffect } from "react";
import { Modal, View, StyleSheet, ActivityIndicator } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useRemoteControlStore } from "@/stores/remoteControlStore";
import { ThemedView } from "./ThemedView";
import { ThemedText } from "./ThemedText";
import { StyledButton } from "./StyledButton";
import { useThemeColor } from "@/hooks/useThemeColor";

export const RemoteControlModal: React.FC = () => {
  const { isModalVisible, hideModal, serverUrl, error, isServerRunning, startServer } = useRemoteControlStore();
  const backgroundColor = useThemeColor({}, "background");
  const textColor = useThemeColor({}, "text");

  // Start server when modal is shown
  useEffect(() => {
    if (isModalVisible && !isServerRunning && !serverUrl && !error) {
      startServer();
    }
  }, [isModalVisible, isServerRunning, serverUrl, error]);

  return (
    <Modal animationType="fade" transparent={true} visible={isModalVisible} onRequestClose={hideModal}>
      <View style={styles.modalContainer}>
        <ThemedView style={styles.modalContent}>
          <ThemedText style={styles.title}>手机扫码</ThemedText>
          <View style={styles.qrContainer}>
          {serverUrl ? (
              <>
                <QRCode value={serverUrl} size={200} backgroundColor="white" color="black" />
              </>
            ) : error ? (
              <View style={styles.errorContainer}>
                <ThemedText style={styles.errorText}>{error}</ThemedText>
              </View>
            ) : (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#007AFF" />
                <ThemedText style={styles.loadingText}>正在启动远程控制服务器...</ThemedText>
              </View>
            )}
          </View>
          
          {serverUrl && (
            <ThemedText style={styles.instructions}>
              使用手机扫描上方二维码，即可在浏览器中向 TV 发送消息。或者访问{"\n"}{serverUrl}
            </ThemedText>
          )}

          {error && (
            <ThemedText style={styles.troubleText}>
              故障排除：{"\n"}
              • 确保设备连接到WiFi{"\n"}
              • 检查网络连接是否正常{"\n"}
              • 尝试关闭并重新开启应用
            </ThemedText>
          )}

          <View style={styles.buttonContainer}>
            {error && (
              <StyledButton
                text="重试"
                onPress={startServer}
                style={[styles.button, styles.retryButton]}
                variant="primary"
              />
            )}
            <StyledButton
              text="关闭"
              onPress={hideModal}
              style={[styles.button, error && styles.closeButtonWithRetry]}
              variant="primary"
            />
          </View>
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
  },
  loadingContainer: {
    justifyContent: "center",
    alignItems: "center",
    width: "100%",
    height: "100%",
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    textAlign: "center",
  },
  errorContainer: {
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    width: "100%",
  },
  errorText: {
    textAlign: "center",
    fontSize: 14,
    color: "#FF6B6B",
    fontWeight: "500",
  },
  instructions: {
    textAlign: "center",
    marginBottom: 16,
    fontSize: 14,
    color: "#ccc",
  },
  troubleText: {
    textAlign: "center",
    marginBottom: 20,
    fontSize: 12,
    color: "#999",
    lineHeight: 18,
  },
  buttonContainer: {
    width: "100%",
    flexDirection: "row",
    gap: 8,
  },
  button: {
    flex: 1,
  },
  retryButton: {
    marginRight: 0,
  },
  closeButtonWithRetry: {
    flex: 1,
  },
});
