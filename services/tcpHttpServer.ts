import TcpSocket from 'react-native-tcp-socket';
import NetInfo from '@react-native-community/netinfo';
import Logger from '@/utils/Logger';
import { Platform } from 'react-native';

const logger = Logger.withTag('TCPHttpServer');

const PORT = 12346;
const REQUEST_TIMEOUT = 30000; // 30秒超时
const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB 最大请求大小

interface HttpRequest {
  method: string;
  url: string;
  headers: { [key: string]: string };
  body: string;
}

interface HttpResponse {
  statusCode: number;
  headers: { [key: string]: string };
  body: string;
}

type RequestHandler = (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;

class TCPHttpServer {
  private server: TcpSocket.Server | null = null;
  private isRunning = false;
  private requestHandler: RequestHandler | null = null;
  private sockets = new Set<TcpSocket.Socket>();
  private requestTimeouts = new Map<TcpSocket.Socket, NodeJS.Timeout>();

  constructor() {
    this.server = null;
  }

  private parseHttpRequest(data: string): HttpRequest | null {
    try {
      // Android 5 兼容性：检查请求大小
      if (data.length > MAX_REQUEST_SIZE) {
        logger.warn('[TCPHttpServer] Request size exceeds limit');
        return null;
      }

      const lines = data.split('\r\n');
      const requestLine = lines[0]?.split(' ');
      
      if (!requestLine || requestLine.length < 3) {
        return null;
      }

      const method = requestLine[0];
      const url = requestLine[1];
      const headers: { [key: string]: string } = {};
      
      let bodyStartIndex = -1;
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line === '') {
          bodyStartIndex = i + 1;
          break;
        }
        const colonIndex = line.indexOf(':');
        if (colonIndex > 0) {
          const key = line.substring(0, colonIndex).trim().toLowerCase();
          const value = line.substring(colonIndex + 1).trim();
          headers[key] = value;
        }
      }

      const body = bodyStartIndex > 0 ? lines.slice(bodyStartIndex).join('\r\n') : '';

      return { method, url, headers, body };
    } catch (error) {
      logger.warn('[TCPHttpServer] Error parsing HTTP request:', error);
      return null;
    }
  }

  private formatHttpResponse(response: HttpResponse): string {
    try {
      const statusTexts: { [key: number]: string } = {
        200: 'OK',
        400: 'Bad Request',
        404: 'Not Found',
        500: 'Internal Server Error'
      };

      const statusText = statusTexts[response.statusCode] || 'Unknown';
      
      // 安全地计算内容长度
      let contentLength = 0;
      try {
        contentLength = new TextEncoder().encode(response.body).length;
      } catch (e) {
        logger.warn('[TCPHttpServer] Error encoding response body:', e);
        contentLength = response.body.length;
      }

      const headers = {
        'Content-Length': contentLength.toString(),
        'Connection': 'close',
        ...response.headers
      };

      let httpResponse = `HTTP/1.1 ${response.statusCode} ${statusText}\r\n`;
      
      for (const [key, value] of Object.entries(headers)) {
        httpResponse += `${key}: ${value}\r\n`;
      }
      
      httpResponse += '\r\n';
      httpResponse += response.body;

      return httpResponse;
    } catch (error) {
      logger.error('[TCPHttpServer] Error formatting response:', error);
      // 返回一个基本的错误响应
      return 'HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n';
    }
  }

  // 为 socket 设置超时
  private setSocketTimeout(socket: TcpSocket.Socket) {
    // 清除旧的超时
    const oldTimeout = this.requestTimeouts.get(socket);
    if (oldTimeout) {
      clearTimeout(oldTimeout);
    }

    // 设置新的超时
    const timeout = setTimeout(() => {
      logger.warn('[TCPHttpServer] Socket request timeout');
      try {
        socket.end();
      } catch (e) {
        logger.warn('[TCPHttpServer] Error closing socket on timeout:', e);
      }
      this.sockets.delete(socket);
      this.requestTimeouts.delete(socket);
    }, REQUEST_TIMEOUT);

    this.requestTimeouts.set(socket, timeout);
  }

  // 清除 socket 相关资源
  private cleanupSocket(socket: TcpSocket.Socket) {
    try {
      this.sockets.delete(socket);
      const timeout = this.requestTimeouts.get(socket);
      if (timeout) {
        clearTimeout(timeout);
        this.requestTimeouts.delete(socket);
      }
    } catch (e) {
      logger.warn('[TCPHttpServer] Error cleaning up socket:', e);
    }
  }

  // 获取本地IP地址，支持多种网络类型和Android TV
  private async getLocalIPAddress(): Promise<string | null> {
    try {
      const netState = await NetInfo.fetch();
      logger.debug('[TCPHttpServer] Network state:', JSON.stringify(netState));

      // 支持多种网络连接类型：wifi、ethernet、cellular等
      // 特别是Android TV可能使用cellular或其他类型的网络
      const supportedTypes = ['wifi', 'ethernet', 'cellular', 'wimax', 'bluetooth'];
      
      if (netState.isConnected === false) {
        logger.warn('[TCPHttpServer] Device is not connected to any network');
        throw new Error('设备未连接到任何网络。请连接WiFi或移动网络后重试。');
      }

      // 优先从details中获取IP地址
      const details = netState.details as any;
      if (details && details.ipAddress) {
        logger.info('[TCPHttpServer] Got IP address from netState:', details.ipAddress);
        return details.ipAddress;
      }

      // 备用方案：如果NetInfo无法获取IP，尝试使用localhost（用于本地测试）
      // 实际生产环境应该先尝试其他方式获取IP
      if (netState.type && supportedTypes.includes(netState.type)) {
        logger.warn('[TCPHttpServer] Connected via', netState.type, 'but no IP found, attempting fallback');
        // 对于Android TV，可能需要使用特定的网络接口查询
        // 这里返回null以触发错误处理，让用户知道存在问题
        throw new Error(`已连接到${netState.type}，但无法获取IP地址。请检查网络设置。`);
      }

      logger.warn('[TCPHttpServer] Unsupported network type:', netState.type);
      throw new Error(`不支持的网络类型: ${netState.type}。请使用WiFi连接。`);
    } catch (error) {
      if (error instanceof Error) {
        logger.error('[TCPHttpServer] Error getting IP address:', error.message);
        throw error;
      }
      logger.error('[TCPHttpServer] Error getting IP address:', error);
      throw new Error('无法获取设备IP地址。请检查网络连接。');
    }
  }

  public setRequestHandler(handler: RequestHandler) {
    this.requestHandler = handler;
  }

  public async start(): Promise<string> {
    try {
      const ipAddress = await this.getLocalIPAddress();

      if (this.isRunning) {
        logger.debug('[TCPHttpServer] Server is already running.');
        return `http://${ipAddress}:${PORT}`;
      }

      return new Promise((resolve, reject) => {
        try {
          this.server = TcpSocket.createServer((socket: TcpSocket.Socket) => {
            try {
              logger.debug('[TCPHttpServer] Client connected');
              this.sockets.add(socket);
              this.setSocketTimeout(socket);
              
              let requestData = '';
              
              socket.on('data', async (data: string | Buffer) => {
                try {
                  // 清除之前的超时，重新设置
                  this.setSocketTimeout(socket);

                  requestData += data.toString();
                  
                  // 检查是否有完整的 HTTP 请求
                  if (requestData.includes('\r\n\r\n')) {
                    try {
                      const request = this.parseHttpRequest(requestData);
                      if (request && this.requestHandler) {
                        try {
                          const response = await this.requestHandler(request);
                          const httpResponse = this.formatHttpResponse(response);
                          socket.write(httpResponse);
                        } catch (handlerError) {
                          logger.warn('[TCPHttpServer] Request handler error:', handlerError);
                          const errorResponse = this.formatHttpResponse({
                            statusCode: 500,
                            headers: { 'Content-Type': 'text/plain' },
                            body: 'Internal Server Error'
                          });
                          socket.write(errorResponse);
                        }
                      } else {
                        const errorResponse = this.formatHttpResponse({
                          statusCode: 400,
                          headers: { 'Content-Type': 'text/plain' },
                          body: 'Bad Request'
                        });
                        socket.write(errorResponse);
                      }
                    } catch (parseError) {
                      logger.warn('[TCPHttpServer] Error processing request:', parseError);
                      const errorResponse = this.formatHttpResponse({
                        statusCode: 500,
                        headers: { 'Content-Type': 'text/plain' },
                        body: 'Internal Server Error'
                      });
                      try {
                        socket.write(errorResponse);
                      } catch (writeError) {
                        logger.warn('[TCPHttpServer] Error writing error response:', writeError);
                      }
                    }
                    
                    try {
                      socket.end();
                    } catch (endError) {
                      logger.warn('[TCPHttpServer] Error ending socket:', endError);
                    }
                    requestData = '';
                  }
                } catch (dataError) {
                  logger.warn('[TCPHttpServer] Error handling socket data:', dataError);
                  try {
                    socket.end();
                  } catch (e) {
                    logger.warn('[TCPHttpServer] Error closing socket after data error:', e);
                  }
                }
              });

              socket.on('error', (error: Error) => {
                logger.warn('[TCPHttpServer] Socket error:', error);
                this.cleanupSocket(socket);
              });

              socket.on('close', () => {
                logger.debug('[TCPHttpServer] Client disconnected');
                this.cleanupSocket(socket);
              });
            } catch (socketError) {
              logger.error('[TCPHttpServer] Error setting up socket:', socketError);
              try {
                socket.end();
              } catch (e) {
                logger.warn('[TCPHttpServer] Error closing socket after setup error:', e);
              }
              this.cleanupSocket(socket);
            }
          });

          this.server.listen({ port: PORT, host: '0.0.0.0' }, () => {
            logger.info(`[TCPHttpServer] Server listening on ${ipAddress}:${PORT}`);
            this.isRunning = true;
            resolve(`http://${ipAddress}:${PORT}`);
          });

          this.server.on('error', (error: Error) => {
            logger.error('[TCPHttpServer] Server error:', error);
            this.isRunning = false;
            this.cleanup();
            reject(error);
          });

        } catch (error) {
          logger.error('[TCPHttpServer] Failed to create server:', error);
          this.cleanup();
          reject(error);
        }
      });
    } catch (error) {
      logger.error('[TCPHttpServer] Failed to start server:', error);
      throw error;
    }
  }

  public stop() {
    try {
      this.cleanup();
      logger.debug('[TCPHttpServer] Server stopped');
    } catch (error) {
      logger.warn('[TCPHttpServer] Error stopping server:', error);
    }
  }

  private cleanup() {
    // 关闭所有 socket
    for (const socket of this.sockets) {
      try {
        socket.destroy();
      } catch (e) {
        logger.warn('[TCPHttpServer] Error destroying socket:', e);
      }
    }
    this.sockets.clear();

    // 清除所有超时
    for (const timeout of this.requestTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.requestTimeouts.clear();

    // 关闭服务器
    if (this.server && this.isRunning) {
      try {
        this.server.close();
      } catch (e) {
        logger.warn('[TCPHttpServer] Error closing server:', e);
      }
      this.server = null;
      this.isRunning = false;
    }
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }
}

export default TCPHttpServer;
