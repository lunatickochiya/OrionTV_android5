import TCPHttpServer from "./tcpHttpServer";
import Logger from '@/utils/Logger';
import { Platform } from 'react-native';

const logger = Logger.withTag('RemoteControl');

const getRemotePageHTML = () => {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <title>OrionTV Remote</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; padding: 20px; }
      h3 { color: #eee; }
      #container { display: flex; flex-direction: column; align-items: center; width: 90%; max-width: 400px; }
      #text { width: 100%; padding: 15px; font-size: 16px; border-radius: 8px; border: 1px solid #333; background-color: #2a2a2a; color: white; margin-bottom: 20px; box-sizing: border-box; }
      button { width: 100%; padding: 15px; font-size: 18px; font-weight: bold; border: none; border-radius: 8px; background-color: #007AFF; color: white; cursor: pointer; }
      button:active { background-color: #0056b3; }
    </style>
  </head>
  <body>
    <div id="container">
      <h3>向电视发送文本</h3>
      <input id="text" placeholder="请输入..." />
      <button onclick="send()">发送</button>
    </div>
    <script>
      window.addEventListener('DOMContentLoaded', () => {
        try {
          fetch('/handshake', { method: 'POST' }).catch(err => console.info('Handshake failed:', err));
        } catch (e) {
          console.error('Handshake error:', e);
        }
      });
      function send() {
        try {
          const input = document.getElementById("text");
          const value = input.value;
          if (value) {
            fetch("/message", {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: value })
            })
            .catch(err => console.info('Message send failed:', err));
            input.value = '';
          }
        } catch (e) {
          console.error('Send error:', e);
        }
      }
    </script>
  </body>
  </html>
  `;
};

class RemoteControlService {
  private httpServer: TCPHttpServer;
  private onMessage: (message: string) => void = () => {};
  private onHandshake: () => void = () => {};

  constructor() {
    this.httpServer = new TCPHttpServer();
    this.setupRequestHandler();
  }

  private setupRequestHandler() {
    this.httpServer.setRequestHandler((request) => {
      try {
        logger.debug("[RemoteControl] Received request:", request.method, request.url);

        try {
          if (request.method === "GET" && request.url === "/") {
            return {
              statusCode: 200,
              headers: { "Content-Type": "text/html; charset=utf-8" },
              body: getRemotePageHTML(),
            };
          } else if (request.method === "POST" && request.url === "/message") {
            try {
              const parsedBody = JSON.parse(request.body || "{}");
              const message = parsedBody.message;
              if (message) {
                try {
                  this.onMessage(message);
                } catch (callbackError) {
                  logger.warn("[RemoteControl] Error in onMessage callback:", callbackError);
                }
              }
              return {
                statusCode: 200,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "ok" }),
              };
            } catch (parseError) {
              logger.warn("[RemoteControl] Failed to parse message body:", parseError);
              return {
                statusCode: 400,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ error: "Invalid JSON" }),
              };
            }
          } else if (request.method === "POST" && request.url === "/handshake") {
            try {
              this.onHandshake();
            } catch (callbackError) {
              logger.warn("[RemoteControl] Error in onHandshake callback:", callbackError);
            }
            return {
              statusCode: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "ok" }),
            };
          } else {
            return {
              statusCode: 404,
              headers: { "Content-Type": "text/plain" },
              body: "Not Found",
            };
          }
        } catch (error) {
          logger.warn("[RemoteControl] Request handler error:", error);
          return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Internal Server Error" }),
          };
        }
      } catch (error) {
        logger.error("[RemoteControl] Unexpected error in setupRequestHandler:", error);
        return {
          statusCode: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Internal Server Error" }),
        };
      }
    });
  }

  public init(actions: { onMessage: (message: string) => void; onHandshake: () => void }) {
    try {
      this.onMessage = actions.onMessage;
      this.onHandshake = actions.onHandshake;
    } catch (error) {
      logger.error("[RemoteControl] Error initializing RemoteControlService:", error);
    }
  }

  public async startServer(): Promise<string> {
    try {
      logger.debug("[RemoteControl] Attempting to start server...");

      try {
        const url = await this.httpServer.start();
        logger.info(`[RemoteControl] Server started successfully at: ${url}`);
        return url;
      } catch (error) {
        logger.error("[RemoteControl] Failed to start server:", error);
        throw new Error(error instanceof Error ? error.message : "Failed to start server");
      }
    } catch (error) {
      logger.error("[RemoteControl] Unexpected error in startServer:", error);
      throw error;
    }
  }

  public stopServer() {
    try {
      logger.debug("[RemoteControl] Stopping server...");
      this.httpServer.stop();
    } catch (error) {
      logger.error("[RemoteControl] Error stopping server:", error);
      // 即使出错也尝试清理资源
      try {
        this.httpServer.stop();
      } catch (e) {
        logger.warn("[RemoteControl] Error in cleanup:", e);
      }
    }
  }

  public isRunning(): boolean {
    try {
      return this.httpServer.getIsRunning();
    } catch (error) {
      logger.error("[RemoteControl] Error checking server status:", error);
      return false;
    }
  }
}

export const remoteControlService = new RemoteControlService();