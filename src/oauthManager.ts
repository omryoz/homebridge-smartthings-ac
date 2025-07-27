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
  expires_at?: number;
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

    // Check if token is expired or will expire in the next 15 minutes (more aggressive refresh)
    const timeUntilExpiry = this.tokenExpiry - Date.now();
    const shouldRefresh = timeUntilExpiry <= 900000; // 15 minutes

    this.log.debug('Token validation check:', {
      currentTime: new Date().toISOString(),
      tokenExpiry: new Date(this.tokenExpiry).toISOString(),
      timeUntilExpiry: Math.round(timeUntilExpiry / 60000), // minutes
      shouldRefresh,
    });

    if (shouldRefresh) {
      this.log.debug('Token expires soon, refreshing...');
      await this.refreshAccessToken();
    } else {
      this.log.debug('Token is still valid, no refresh needed');
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
      this.log.debug('Current token expires at:', new Date(this.tokenExpiry).toISOString());

      const response = await axios.post('https://api.smartthings.com/v1/oauth/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refresh_token,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64'),
          },
        },
      );

      // Log the response structure for debugging
      this.log.debug('Token refresh response received:', {
        hasAccessToken: !!response.data.access_token,
        hasRefreshToken: !!response.data.refresh_token,
        expiresIn: response.data.expires_in,
        tokenType: response.data.token_type,
        scope: response.data.scope,
      });

      // Validate the response
      if (!response.data.access_token) {
        throw new Error('No access token received in refresh response');
      }

      // Store the old token for comparison
      const oldAccessToken = this.tokens.access_token;
      const oldRefreshToken = this.tokens.refresh_token;

      // Update tokens with new data
      this.tokens = {
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token || this.tokens.refresh_token, // Preserve old refresh token if new one not provided
        expires_in: response.data.expires_in,
        scope: response.data.scope,
        token_type: response.data.token_type,
      };

      // Calculate new expiry time
      this.tokens.expires_at = Date.now() + (this.tokens.expires_in * 1000);
      this.tokenExpiry = this.tokens.expires_at;

      // Log token changes
      this.log.debug('Token refresh details:', {
        accessTokenChanged: oldAccessToken !== this.tokens.access_token,
        refreshTokenChanged: oldRefreshToken !== this.tokens.refresh_token,
        newExpiry: new Date(this.tokenExpiry).toISOString(),
        expiresInMinutes: Math.round(this.tokens.expires_in / 60),
      });

      // Save tokens to storage
      await this.saveTokens();

      this.log.debug('Access token refreshed successfully');
    } catch (error) {
      this.log.error('Failed to refresh access token:', error);
      
      // Log more details about the error
      if (axios.isAxiosError(error)) {
        this.log.error('Axios error details:', {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
        });
      }
      
      throw error;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(authorizationCode: string): Promise<void> {
    try {
      this.log.debug('Exchanging authorization code for tokens...');

      const response = await axios.post('https://api.smartthings.com/v1/oauth/token',
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: authorizationCode,
          redirect_uri: this.config.redirectUri,
        }).toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': 'Basic ' + Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64'),
          },
        },
      );

      this.tokens = response.data;
      if (this.tokens) {
        this.tokens.expires_at = Date.now() + (this.tokens.expires_in * 1000);
        this.tokenExpiry = this.tokens.expires_at;
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
    this.log.debug('Generating OAuth URL with:');
    this.log.debug('  client_id:', this.config.clientId);
    this.log.debug('  redirect_uri:', this.config.redirectUri);
    this.log.debug('  scope:', this.config.scope);
    this.log.debug('  state:', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scope,
      state: state,
    });

    const url = `https://api.smartthings.com/v1/oauth/authorize?${params.toString()}`;
    this.log.debug('Generated OAuth URL:', url);

    return url;
  }

  /**
   * Load tokens from storage
   */
  async loadTokens(): Promise<void> {
    try {
      this.log.debug('Attempting to load OAuth tokens from:', this.storagePath);

      // Check if file exists first
      try {
        await fs.access(this.storagePath);
        this.log.debug('OAuth tokens file exists');
      } catch (accessError) {
        this.log.debug('OAuth tokens file does not exist:', this.storagePath);
        return;
      }

      const data = await fs.readFile(this.storagePath, 'utf8');
      this.log.debug('File contents length:', data.length);

      this.tokens = JSON.parse(data);
      if (this.tokens) {
        if (this.tokens.expires_at) {
          this.tokenExpiry = this.tokens.expires_at;
          this.log.debug('OAuth tokens loaded successfully, expires at:', new Date(this.tokenExpiry));
        } else {
          this.tokenExpiry = Date.now() + (this.tokens.expires_in * 1000);
          this.tokens.expires_at = this.tokenExpiry;
          this.log.debug('OAuth tokens loaded (legacy format), expires at:', new Date(this.tokenExpiry));
          await this.saveTokens();
        }
      }
      this.log.debug('OAuth tokens loaded from storage');
    } catch (error) {
      this.log.debug('No stored OAuth tokens found:', error);
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
   * Get detailed token information for debugging
   */
  getDetailedTokenInfo(): {
    hasTokens: boolean;
    hasValidTokens: boolean;
    expiresAt: Date;
    timeUntilExpiry: number;
    timeUntilExpiryMinutes: number;
    accessTokenLength: number;
    refreshTokenLength: number;
    expiresIn: number;
    tokenType: string;
    scope: string;
    } {
    const now = Date.now();
    const expiresAt = new Date(this.tokenExpiry);
    const timeUntilExpiry = this.tokenExpiry - now;

    return {
      hasTokens: this.tokens !== null,
      hasValidTokens: this.hasValidTokens(),
      expiresAt,
      timeUntilExpiry,
      timeUntilExpiryMinutes: Math.round(timeUntilExpiry / 60000),
      accessTokenLength: this.tokens?.access_token?.length || 0,
      refreshTokenLength: this.tokens?.refresh_token?.length || 0,
      expiresIn: this.tokens?.expires_in || 0,
      tokenType: this.tokens?.token_type || 'unknown',
      scope: this.tokens?.scope || 'unknown',
    };
  }

  /**
   * Get token expiry information
   */
  getTokenExpiryInfo(): { isValid: boolean; expiresAt: Date; timeUntilExpiry: number } {
    const now = Date.now();
    const expiresAt = new Date(this.tokenExpiry);
    const timeUntilExpiry = this.tokenExpiry - now;

    return {
      isValid: this.hasValidTokens(),
      expiresAt,
      timeUntilExpiry,
    };
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