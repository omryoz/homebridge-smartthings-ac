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

export type AuthRequiredReason = 'no_tokens' | 'invalid_grant' | 'no_refresh_token';

export class AuthRequiredError extends Error {
  constructor(public readonly reason: AuthRequiredReason, message: string) {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

// Refresh proactively this long before access-token expiry.
const REFRESH_MARGIN_MS = 60 * 60 * 1000; // 1 hour
// Single-attempt retry tuning for the /oauth/token call.
const REFRESH_MAX_ATTEMPTS = 3;
const REFRESH_BASE_BACKOFF_MS = 1000;

export class OAuthManager {
  private tokens: OAuthTokens | null = null;
  private tokenExpiry = 0;
  private refreshInflight: Promise<void> | null = null;

  constructor(
    private readonly log: Logger,
    private readonly config: OAuthConfig,
    private readonly storagePath: string,
  ) {}

  /**
   * Get a valid access token, refreshing if necessary.
   * Throws AuthRequiredError only when a real user-driven re-authorization is needed.
   */
  async getValidAccessToken(): Promise<string> {
    // Defensive: if memory was lost but the file is still good, recover from disk.
    if (!this.tokens) {
      this.log.debug('In-memory tokens are null; attempting disk reload');
      await this.loadTokens();
    }
    if (!this.tokens) {
      throw new AuthRequiredError(
        'no_tokens',
        'No OAuth tokens available. Please complete the authorization flow first.',
      );
    }

    const timeUntilExpiry = this.tokenExpiry - Date.now();
    const shouldRefresh = timeUntilExpiry <= REFRESH_MARGIN_MS;

    this.log.debug('Token validation check:', {
      currentTime: new Date().toISOString(),
      tokenExpiry: new Date(this.tokenExpiry).toISOString(),
      timeUntilExpiryMinutes: Math.round(timeUntilExpiry / 60000),
      shouldRefresh,
    });

    if (shouldRefresh) {
      await this.ensureRefresh();
    }

    // tokens may have been replaced by refresh
    if (!this.tokens) {
      throw new AuthRequiredError('no_tokens', 'OAuth tokens unexpectedly null after refresh');
    }
    return this.tokens.access_token;
  }

  /**
   * Force a refresh now (used by the scheduler). Same dedup as getValidAccessToken.
   */
  async refreshNow(): Promise<void> {
    await this.ensureRefresh();
  }

  /**
   * Return the existing in-flight refresh promise, or start a new one.
   * Multiple concurrent callers share the same refresh — never two parallel
   * POSTs to /oauth/token with the same refresh_token.
   */
  private ensureRefresh(): Promise<void> {
    if (!this.refreshInflight) {
      this.refreshInflight = this.refreshWithRetry().finally(() => {
        this.refreshInflight = null;
      });
    }
    return this.refreshInflight;
  }

  /**
   * Retry the refresh on transient errors only. invalid_grant short-circuits
   * to AuthRequiredError immediately — no point retrying a revoked token.
   */
  private async refreshWithRetry(): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= REFRESH_MAX_ATTEMPTS; attempt++) {
      try {
        await this.refreshAccessToken();
        return;
      } catch (error) {
        lastError = error;

        if (this.isInvalidGrant(error)) {
          this.log.error('Refresh token rejected by SmartThings (invalid_grant) — re-authorization required');
          throw new AuthRequiredError(
            'invalid_grant',
            'SmartThings refresh token is no longer valid. Please re-authorize the plugin.',
          );
        }

        if (attempt < REFRESH_MAX_ATTEMPTS) {
          const backoff = REFRESH_BASE_BACKOFF_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
          this.log.warn(`Token refresh attempt ${attempt} failed; retrying in ${backoff}ms`);
          await new Promise(resolve => setTimeout(resolve, backoff));
        }
      }
    }
    this.log.error(`Token refresh failed after ${REFRESH_MAX_ATTEMPTS} attempts — keeping existing tokens`);
    throw lastError;
  }

  /**
   * RFC 6749 §5.2: invalid_grant means the refresh token is no longer valid.
   * SmartThings returns this with HTTP 400 (sometimes 401) and a body of
   * { error: 'invalid_grant', error_description: '...' }.
   */
  private isInvalidGrant(error: unknown): boolean {
    if (!axios.isAxiosError(error) || !error.response) {
      return false;
    }
    const status = error.response.status;
    if (status !== 400 && status !== 401) {
      return false;
    }
    const data = error.response.data as { error?: string } | undefined;
    return data?.error === 'invalid_grant';
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
      // Per-attempt detail at debug; refreshWithRetry surfaces the final outcome.
      this.log.debug('Refresh attempt failed:', error);
      if (axios.isAxiosError(error)) {
        this.log.debug('Axios error details:', {
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
      // Real failure: file existed (fs.access succeeded) but read/parse failed.
      this.log.warn('OAuth token file is unreadable or corrupt:', error);
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