import { create } from 'zustand';
import { remoteControlService } from '@/services/remoteControlService';
import Logger from '@/utils/Logger';

const logger = Logger.withTag('RemoteControlStore');

interface RemoteControlState {
  isServerRunning: boolean;
  serverUrl: string | null;
  error: string | null;
  startServer: () => Promise<void>;
  stopServer: () => void;
  isModalVisible: boolean;
  showModal: (targetPage?: string) => void;
  hideModal: () => void;
  lastMessage: string | null;
  targetPage: string | null;
  setMessage: (message: string, targetPage?: string) => void;
  clearMessage: () => void;
}

export const useRemoteControlStore = create<RemoteControlState>((set, get) => ({
  isServerRunning: false,
  serverUrl: null,
  error: null,
  isModalVisible: false,
  lastMessage: null,
  targetPage: null,

  startServer: async () => {
    if (get().isServerRunning) {
      return;
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
        set({ isServerRunning: true, serverUrl: url, error: null });
      } catch (serverError) {
        const errorMessage = '启动失败，请检查网络连接后重试。';
        logger.error('Failed to start server:', serverError);
        set({ error: errorMessage, isServerRunning: false });
      }
    } catch (error) {
      const errorMessage = '启动失败，请强制退应用后重试。';
      logger.error('Unexpected error in startServer:', error);
      set({ error: errorMessage, isServerRunning: false });
    }
  },

  stopServer: () => {
    try {
      if (get().isServerRunning) {
        remoteControlService.stopServer();
        set({ isServerRunning: false, serverUrl: null });
      }
    } catch (error) {
      logger.error('Error stopping server:', error);
      // 即使出错也更新状态
      set({ isServerRunning: false, serverUrl: null });
    }
  },

  showModal: (targetPage?: string) => {
    try {
      set({ isModalVisible: true, targetPage });
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
}));