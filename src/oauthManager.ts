import { Logger } from 'homebridge';
import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface OAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
}

export class OAuthManager {
  private tokens: OAuthTokens | null = null;
  private tokenExpiry = 0;

  constructor(
    private readonly log: Logger,
    private readonly config: OAuthConfig,
    private readonly storagePath: string,
  ) {}

  /**
   * Get a valid access token, refreshing if necessary
   */
  async getValidAccessToken(): Promise<string> {
    if (!this.tokens) {
      throw new Error('No OAuth tokens available. Please complete the authorization flow first.');
    }

    // Check if token is expired or will expire in the next 5 minutes
    if (Date.now() >= this.tokenExpiry - 300000) {
      await this.refreshAccessToken();
    }

    return this.tokens.access_token;
  }

  /**
   * Refresh the access token using the refresh token
   */
  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens?.refresh_token) {
      throw new Error('No refresh token available');
    }

    try {
      this.log.debug('Refreshing access token...');

      const response = await axios.post('https://auth-global.api.smartthings.com/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: this.tokens.refresh_token,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      this.tokens = response.data;
      if (this.tokens) {
        this.tokenExpiry = Date.now() + (this.tokens.expires_in * 1000);
      }

      // Save tokens to storage
      await this.saveTokens();

      this.log.debug('Access token refreshed successfully');
    } catch (error) {
      this.log.error('Failed to refresh access token:', error);
      throw error;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(authorizationCode: string): Promise<void> {
    try {
      this.log.debug('Exchanging authorization code for tokens...');

      const response = await axios.post('https://auth-global.api.smartthings.com/oauth/token', {
        grant_type: 'authorization_code',
        code: authorizationCode,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
      }, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      this.tokens = response.data;
      if (this.tokens) {
        this.tokenExpiry = Date.now() + (this.tokens.expires_in * 1000);
      }

      // Save tokens to storage
      await this.saveTokens();

      this.log.debug('Successfully obtained OAuth tokens');
    } catch (error) {
      this.log.error('Failed to exchange code for tokens:', error);
      throw error;
    }
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  generateAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state: state,
    });

    return `https://auth-global.api.smartthings.com/oauth/authorize?${params.toString()}`;
  }

  /**
   * Load tokens from storage
   */
  async loadTokens(): Promise<void> {
    try {
      const data = await fs.readFile(this.storagePath, 'utf8');
      this.tokens = JSON.parse(data);
      if (this.tokens) {
        this.tokenExpiry = Date.now() + (this.tokens.expires_in * 1000);
      }
      this.log.debug('OAuth tokens loaded from storage');
    } catch (error) {
      this.log.debug('No stored OAuth tokens found');
    }
  }

  /**
   * Save tokens to storage
   */
  private async saveTokens(): Promise<void> {
    try {
      if (!this.tokens) {
        throw new Error('No tokens to save');
      }

      // Ensure directory exists
      const dir = path.dirname(this.storagePath);
      await fs.mkdir(dir, { recursive: true });

      await fs.writeFile(this.storagePath, JSON.stringify(this.tokens, null, 2));
      this.log.debug('OAuth tokens saved to storage');
    } catch (error) {
      this.log.error('Failed to save OAuth tokens:', error);
    }
  }

  /**
   * Check if we have valid tokens
   */
  hasValidTokens(): boolean {
    return this.tokens !== null && Date.now() < this.tokenExpiry;
  }

  /**
   * Clear stored tokens
   */
  async clearTokens(): Promise<void> {
    try {
      await fs.unlink(this.storagePath);
      this.tokens = null;
      this.tokenExpiry = 0;
      this.log.debug('OAuth tokens cleared');
    } catch (error) {
      this.log.debug('No tokens to clear');
    }
  }
}