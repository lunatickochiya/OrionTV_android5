import { create } from 'zustand';
import { remoteControlService } from '@/services/remoteControlService';
import Logger from '@/utils/Logger';

const logger = Logger.withTag('RemoteControlStore');

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Sleep utility function for delaying async operations
 */
const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

interface RemoteControlState {
  isServerRunning: boolean;
  serverUrl: string | null;
  error: string | null;
  retryCount: number;
  isInitializing: boolean;
  startServer: () => Promise<void>;
  stopServer: () => void;
  isModalVisible: boolean;
  showModal: (targetPage?: string) => void;
  hideModal: () => void;
  lastMessage: string | null;
  targetPage: string | null;
  setMessage: (message: string, targetPage?: string) => void;
  clearMessage: () => void;
  resetError: () => void;
}

export const useRemoteControlStore = create<RemoteControlState>((set, get) => {
  // Helper function to perform the actual server start logic
  const performServerStart = async (isRetry: boolean = false): Promise<void> => {
    const currentState = get();
    if (!isRetry && (currentState.isServerRunning || currentState.isInitializing)) {
      return;
    }
    
    if (!isRetry) {
      set({ isInitializing: true, error: null });
    }
    
    try {
      remoteControlService.init({
        onMessage: (message: string) => {
          try {
            logger.debug('Received message:', message);
            const currentState = get();
            // Use the current targetPage from the store
            set({ lastMessage: message, targetPage: currentState.targetPage });
          } catch (e) {
            logger.error('Error handling message:', e);
          }
        },
        onHandshake: () => {
          try {
            logger.debug('Handshake successful');
            set({ isModalVisible: false });
          } catch (e) {
            logger.error('Error handling handshake:', e);
          }
        },
      });

      try {
        const url = await remoteControlService.startServer();
        logger.info('Server started, URL:', url);
        set({ isServerRunning: true, serverUrl: url, error: null, retryCount: 0, isInitializing: false });
      } catch (serverError) {
        const state = get();
        if (state.retryCount < MAX_RETRY_ATTEMPTS) {
          const newRetryCount = state.retryCount + 1;
          logger.warn(`Server start failed, retrying (${newRetryCount}/${MAX_RETRY_ATTEMPTS})...`);
          set({ retryCount: newRetryCount, isInitializing: false });
          
          // Wait before retrying to space out retry attempts
          await sleep(RETRY_DELAY_MS);
          
          // Retry with isRetry flag to avoid state conflicts
          await performServerStart(true);
        } else {
          const errorMessage = '启动失败，请检查网络连接后重试。';
          logger.error('Failed to start server after retries:', serverError);
          set({ error: errorMessage, isServerRunning: false, isInitializing: false });
        }
      }
    } catch (error) {
      const errorMessage = '启动失败，请强制退应用后重试。';
      logger.error('Unexpected error in startServer:', error);
      set({ error: errorMessage, isServerRunning: false, isInitializing: false });
    }
  };

  return {
    isServerRunning: false,
    serverUrl: null,
    error: null,
    retryCount: 0,
    isInitializing: false,
    isModalVisible: false,
    lastMessage: null,
    targetPage: null,

    startServer: async () => {
      await performServerStart(false);
    },

    stopServer: () => {
    try {
      if (get().isServerRunning) {
        remoteControlService.stopServer();
        set({ isServerRunning: false, serverUrl: null, retryCount: 0 });
      }
    } catch (error) {
      logger.error('Error stopping server:', error);
      // 即使出错也更新状态
      set({ isServerRunning: false, serverUrl: null, retryCount: 0 });
    }
  },

  showModal: (targetPage?: string) => {
    try {
      set({ isModalVisible: true, targetPage, retryCount: 0, error: null });
    } catch (e) {
      logger.error('Error showing modal:', e);
    }
  },

  hideModal: () => {
    try {
      set({ isModalVisible: false, targetPage: null });
    } catch (e) {
      logger.error('Error hiding modal:', e);
    }
  },

  setMessage: (message: string, targetPage?: string) => {
    try {
      set({ lastMessage: `${message}_${Date.now()}`, targetPage });
    } catch (e) {
      logger.error('Error setting message:', e);
    }
  },

  clearMessage: () => {
    try {
      set({ lastMessage: null, targetPage: null });
    } catch (e) {
      logger.error('Error clearing message:', e);
    }
  },

  resetError: () => {
    try {
      set({ error: null, retryCount: 0 });
    } catch (e) {
      logger.error('Error resetting error:', e);
    }
  },
  };
});