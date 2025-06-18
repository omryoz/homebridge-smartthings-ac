import { Logger } from 'homebridge';
import { OAuthManager, OAuthConfig } from './oauthManager';
import * as http from 'http';
import * as url from 'url';
import * as crypto from 'crypto';

export class OAuthSetup {
  private server: http.Server | null = null;
  private state: string;

  constructor(
    private readonly log: Logger,
    private readonly oauthManager: OAuthManager,
    private readonly port: number = 3000,
  ) {
    this.state = crypto.randomBytes(16).toString('hex');
  }

  /**
   * Start the OAuth authorization flow
   */
  async startAuthorizationFlow(): Promise<string> {
    return new Promise((resolve, reject) => {
      // Create a simple HTTP server to handle the OAuth callback
      this.server = http.createServer(async (req, res) => {
        try {
          const parsedUrl = url.parse(req.url!, true);

          if (parsedUrl.pathname === '/oauth/callback') {
            const { code, state, error } = parsedUrl.query as any;

            if (error) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h1>Authorization Failed</h1>
                    <p>Error: ${error}</p>
                    <p>Please try again.</p>
                  </body>
                </html>
              `);
              reject(new Error(`OAuth error: ${error}`));
              return;
            }

            if (state !== this.state) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h1>Authorization Failed</h1>
                    <p>Invalid state parameter. Please try again.</p>
                  </body>
                </html>
              `);
              reject(new Error('Invalid state parameter'));
              return;
            }

            if (!code) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end(`
                <html>
                  <body>
                    <h1>Authorization Failed</h1>
                    <p>No authorization code received.</p>
                  </body>
                </html>
              `);
              reject(new Error('No authorization code received'));
              return;
            }

            // Exchange the authorization code for tokens
            await this.oauthManager.exchangeCodeForTokens(code);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`
              <html>
                <body>
                  <h1>Authorization Successful!</h1>
                  <p>Your SmartThings account has been successfully connected.</p>
                  <p>You can now close this window and return to Homebridge.</p>
                </body>
              </html>
            `);

            // Close the server
            this.server?.close();
            this.server = null;

            resolve('Authorization completed successfully');
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
          }
        } catch (error) {
          this.log.error('Error handling OAuth callback:', error);
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body>
                <h1>Authorization Failed</h1>
                <p>An error occurred during authorization.</p>
                <p>Please try again.</p>
              </body>
            </html>
          `);
          reject(error);
        }
      });

      this.server.listen(this.port, () => {
        this.log.info(`OAuth callback server started on port ${this.port}`);

        // Generate the authorization URL
        const authUrl = this.oauthManager.generateAuthorizationUrl(this.state);

        this.log.info('Please visit the following URL to authorize the plugin:');
        this.log.info(authUrl);
        this.log.info('');
        this.log.info('After authorization, you will be redirected back to this application.');
      });

      this.server.on('error', (error) => {
        this.log.error('OAuth server error:', error);
        reject(error);
      });
    });
  }

  /**
   * Stop the OAuth server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}