import * as http from 'http';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';

interface OAuthCallbackData {
  code?: string;
  state?: string;
  error?: string;
  error_description?: string;
}

interface OAuthServerConfig {
  port: number;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  state: string;
}

class OAuthServer {
  private server: http.Server | null = null;
  private config: OAuthServerConfig;
  private authCode: string | null = null;
  private authError: string | null = null;
  private isListening = false;

  constructor(config: OAuthServerConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.listen(this.config.port, () => {
        this.isListening = true;
        console.log(`🔐 OAuth callback server listening on port ${this.config.port}`);
        resolve();
      });

      this.server.on('error', (error) => {
        console.error('❌ OAuth server error:', error);
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server && this.isListening) {
        this.server.close(() => {
          this.isListening = false;
          console.log('🔐 OAuth callback server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const parsedUrl = url.parse(req.url!, true);
    const pathname = parsedUrl.pathname;

    if (pathname === '/oauth/callback') {
      this.handleOAuthCallback(parsedUrl.query as OAuthCallbackData, res);
    } else if (pathname === '/') {
      this.handleRoot(req, res);
    } else {
      this.handleNotFound(res);
    }
  }

  private handleOAuthCallback(query: OAuthCallbackData, res: http.ServerResponse): void {
    console.log('📥 Received OAuth callback:', query);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (query.error) {
      this.authError = `${query.error}: ${query.error_description || 'Unknown error'}`;
      console.error('❌ OAuth error:', this.authError);
      this.sendErrorResponse(res, this.authError);
      return;
    }

    if (!query.code) {
      this.authError = 'No authorization code received';
      console.error('❌ OAuth error:', this.authError);
      this.sendErrorResponse(res, this.authError);
      return;
    }

    if (query.state && query.state !== this.config.state) {
      this.authError = 'State mismatch - possible CSRF attack';
      console.error('❌ OAuth error:', this.authError);
      this.sendErrorResponse(res, this.authError);
      return;
    }

    this.authCode = query.code;
    console.log('✅ Authorization code received successfully');

    // Send success response
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(this.getSuccessHTML());
  }

  private handleRoot(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(this.getRootHTML());
  }

  private handleNotFound(res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private sendErrorResponse(res: http.ServerResponse, error: string): void {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end(this.getErrorHTML(error));
  }

  private getSuccessHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Success</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
        .message { color: #666; font-size: 16px; }
    </style>
</head>
<body>
    <div class="success">✅ Authentication Successful!</div>
    <div class="message">You can close this window now.</div>
    <script>
        setTimeout(() => {
            window.close();
        }, 3000);
    </script>
</body>
</html>`;
  }

  private getErrorHTML(error: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>OAuth Error</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .error { color: #dc3545; font-size: 24px; margin-bottom: 20px; }
        .message { color: #666; font-size: 16px; }
    </style>
</head>
<body>
    <div class="error">❌ Authentication Failed</div>
    <div class="message">${error}</div>
    <div class="message">Please check your configuration and try again.</div>
</body>
</html>`;
  }

  private getRootHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>SmartThings OAuth Server</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .title { color: #007bff; font-size: 24px; margin-bottom: 20px; }
        .message { color: #666; font-size: 16px; }
    </style>
</head>
<body>
    <div class="title">🔐 SmartThings OAuth Server</div>
    <div class="message">This server handles OAuth callbacks for SmartThings integration tests.</div>
    <div class="message">Status: Running</div>
</body>
</html>`;
  }

  async waitForAuthCode(timeoutMs: number = 60000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('OAuth timeout - no authorization code received'));
      }, timeoutMs);

      const checkAuthCode = () => {
        if (this.authCode) {
          clearTimeout(timeout);
          resolve(this.authCode!);
        } else if (this.authError) {
          clearTimeout(timeout);
          reject(new Error(this.authError));
        } else {
          setTimeout(checkAuthCode, 100);
        }
      };

      checkAuthCode();
    });
  }

  getAuthCode(): string | null {
    return this.authCode;
  }

  getAuthError(): string | null {
    return this.authError;
  }

  isServerRunning(): boolean {
    return this.isListening;
  }
}

export { OAuthServer, OAuthServerConfig, OAuthCallbackData }; 