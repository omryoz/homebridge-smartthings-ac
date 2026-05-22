import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, UnknownContext } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SmartThingsAirConditionerAccessory } from './platformAccessory';
import { BearerTokenAuthenticator, Device, Component, CapabilityReference, SmartThingsClient } from '@smartthings/core-sdk';
import { DeviceAdapter } from './deviceAdapter';
import { OAuthManager, OAuthConfig, AuthRequiredError } from './oauthManager';
import { OAuthSetup } from './oauthSetup';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

export type AuthState = 'ok' | 'refreshing' | 'broken';

const AUTH_REQUIRED_LOG_INTERVAL_MS = 60 * 60 * 1000; // once per hour
const REFRESH_FALLBACK_INTERVAL_MS = 30 * 60 * 1000;  // safety net if scheduling math fails

export class SmartThingsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  private readonly accessories: PlatformAccessory[] = [];
  private client: SmartThingsClient | null = null;
  private oauthManager: OAuthManager | null = null;
  private oauthSetup: OAuthSetup | null = null;
  private isReAuthenticating = false;
  private authState: AuthState = 'ok';
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private lastAuthRequiredLog = 0;

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    // Always register the didFinishLaunching handler
    this.api.on('didFinishLaunching', () => {
      this.loadDevices();
    });

    // Then initialize authentication
    this.initializeAuthentication();
  }

  private async initializeAuthentication() {
    // Check if OAuth is configured
    if (this.config.clientId && this.config.clientSecret) {
      await this.initializeOAuth();
    } else if (this.config.token) {
      await this.initializeLegacyToken();
    } else {
      this.log.error('No authentication method configured. Please set up either OAuth or a Personal Access Token (token).');
      return;
    }
  }

  private async initializeOAuth() {
    try {
      // Use a more reliable path for token storage
      const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
      
      // Try multiple possible Homebridge directories
      const possiblePaths = [
        path.join(homeDir, '.homebridge'),
        '/home/homebridge/.homebridge',
        '/var/lib/homebridge',
        process.env.HOMEBRIDGE_PATH || '',
      ].filter(p => p); // Remove empty paths

      let storagePath = '';
      for (const basePath of possiblePaths) {
        const testPath = path.join(basePath, 'smartthings-oauth-tokens.json');
        try {
          await fs.access(path.dirname(testPath));
          storagePath = testPath;
          this.log.debug('Using token storage path:', storagePath);
          break;
        } catch (error) {
          this.log.debug('Path not accessible:', testPath);
        }
      }

      // Fallback to default if no path found
      if (!storagePath) {
        storagePath = path.join(homeDir, '.homebridge', 'smartthings-oauth-tokens.json');
        this.log.debug('Using fallback token storage path:', storagePath);
      }

      this.log.debug('OAuth token storage path:', storagePath);
      this.log.debug('Home directory:', homeDir);

      // Debug OAuth configuration (masked)
      const clientId = this.config.clientId as string;
      const clientSecret = this.config.clientSecret as string;

      if (clientId) {
        const maskedClientId = clientId.length > 8 ?
          clientId.substring(0, 4) + '...' + clientId.substring(clientId.length - 4) :
          '***';
        this.log.debug('Client ID (masked):', maskedClientId);
      } else {
        this.log.debug('Client ID: NOT CONFIGURED');
      }

      if (clientSecret) {
        const maskedSecret = clientSecret.length > 8 ?
          clientSecret.substring(0, 4) + '...' + clientSecret.substring(clientSecret.length - 4) :
          '***';
        this.log.debug('Client Secret (masked):', maskedSecret);
      } else {
        this.log.debug('Client Secret: NOT CONFIGURED');
      }

      // Check for existing token files in common locations
      await this.checkForExistingTokens();

      const oauthConfig: OAuthConfig = {
        clientId: clientId,
        clientSecret: clientSecret,
        redirectUri: this.config.redirectUri || 'https://raspberrypi.local:3000/oauth/callback',
        scope: 'r:devices:* w:devices:* x:devices:* r:locations:*',
      };

      this.oauthManager = new OAuthManager(this.log, oauthConfig, storagePath);
      await this.oauthManager.loadTokens();

      // Try to obtain a valid access token (will refresh transparently if needed).
      // Only fall back to the interactive OAuth flow if refresh is impossible
      // (no tokens on disk, or refresh_token has been revoked).
      let accessToken: string;
      try {
        accessToken = await this.oauthManager.getValidAccessToken();
        this.setAuthState('ok');
      } catch (error) {
        if (error instanceof AuthRequiredError) {
          this.log.info(`OAuth re-authorization required (${error.reason}). Starting authorization flow...`);
          await this.startOAuthFlow();
          accessToken = await this.oauthManager.getValidAccessToken();
          this.setAuthState('ok');
        } else {
          throw error;
        }
      }

      this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));

      // Start token refresh scheduler (re-arms itself based on actual expiry)
      this.scheduleNextRefresh();

      this.log.info('OAuth authentication initialized successfully');
    } catch (error) {
      this.log.error('Failed to initialize OAuth:', error);
    }
  }

  /**
   * Public accessor for accessories to read current auth state.
   * When 'broken', accessory characteristic handlers should report
   * SERVICE_COMMUNICATION_FAILURE so HomeKit shows "No Response".
   */
  public getAuthState(): AuthState {
    return this.authState;
  }

  private setAuthState(state: AuthState) {
    if (this.authState === state) {
      return;
    }
    this.log.info(`Auth state: ${this.authState} -> ${state}`);
    this.authState = state;
  }

  /**
   * Loud log when re-auth is genuinely required. Rate-limited so we don't
   * spam Homebridge logs on every poll.
   */
  public reportAuthRequired(reason: string) {
    this.setAuthState('broken');
    const now = Date.now();
    if (now - this.lastAuthRequiredLog < AUTH_REQUIRED_LOG_INTERVAL_MS) {
      return;
    }
    this.lastAuthRequiredLog = now;
    this.log.error('=== SmartThings re-authorization required ===');
    this.log.error(`Reason: ${reason}`);
    this.log.error('Restart Homebridge or use the OAuth setup flow to re-authorize the plugin.');
    this.log.error('=============================================');
  }

  private async checkForExistingTokens() {
    const commonPaths = [
      '/home/homebridge/.homebridge/smartthings-oauth-tokens.json',
      '/var/lib/homebridge/smartthings-oauth-tokens.json',
      path.join(process.env.HOME || '', '.homebridge', 'smartthings-oauth-tokens.json'),
      path.join(os.homedir(), '.homebridge', 'smartthings-oauth-tokens.json'),
    ];

    for (const tokenPath of commonPaths) {
      try {
        await fs.access(tokenPath);
        this.log.debug('Found existing OAuth tokens at:', tokenPath);
      } catch (error) {
        this.log.debug('No tokens found at:', tokenPath);
      }
    }
  }

  private initializeLegacyToken() {
    try {
      const token = this.config.token as string;
      this.client = new SmartThingsClient(new BearerTokenAuthenticator(token));
      this.log.info('Legacy token authentication initialized');
    } catch (error) {
      this.log.error('Failed to initialize legacy token authentication:', error);
    }
  }

  private async startOAuthFlow() {
    if (!this.oauthManager) {
      throw new Error('OAuth manager not initialized');
    }

    this.oauthSetup = new OAuthSetup(this.log, this.oauthManager, 3000, true);

    try {
      await this.oauthSetup.startAuthorizationFlow();
      this.log.info('OAuth authorization completed successfully');

      // Recreate client with new token
      const accessToken = await this.oauthManager.getValidAccessToken();
      this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));
    } catch (error) {
      this.log.error('OAuth authorization failed:', error);
      throw error;
    } finally {
      this.oauthSetup?.stop();
    }
  }

  private async forceReAuthentication() {
    if (this.isReAuthenticating) {
      this.log.debug('Re-authentication already in progress, waiting...');
      while (this.isReAuthenticating) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return;
    }

    this.isReAuthenticating = true;
    this.log.warn('Force re-authentication required...');

    try {
      if (!this.oauthManager) {
        this.log.error('No OAuth manager available for re-authentication');
        return;
      }

      // IMPORTANT: do NOT clear existing tokens. startOAuthFlow may fail
      // (user doesn't visit the URL, server can't bind, etc.) — in that
      // case we want to keep whatever we had so the next refresh attempt
      // can still succeed once SmartThings recovers.
      await this.startOAuthFlow();
      this.setAuthState('ok');
      this.log.info('Re-authentication completed successfully');
    } catch (error) {
      this.log.error('Failed to re-authenticate:', error);
      throw error;
    } finally {
      this.isReAuthenticating = false;
    }
  }

  private async loadDevices() {
    // Wait for authentication to complete if needed
    let attempts = 0;
    while (!this.client && attempts < 10) {
      this.log.debug('Waiting for authentication to complete...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      attempts++;
    }

    if (!this.client) {
      this.log.error('SmartThings client not initialized after 10 seconds');
      return;
    }

    try {
      this.log.info('🔍 Loading devices from SmartThings...');
      const devices = await this.client.devices.list();
      this.log.info(`📱 Found ${devices.length} devices total`);
      this.handleDevices(devices);
    } catch (error: unknown) {
      this.log.error('Cannot load devices:', error);

      // On 401, the stored client is using an expired token. Ask OAuthManager
      // for a fresh one (handles refresh + dedup) and retry once. If refresh
      // itself proves the user needs to re-authorize, surface that loudly
      // instead of silently triggering an interactive flow at startup.
      if (this.oauthManager && (error as { response?: { status: number } }).response?.status === 401) {
        try {
          const accessToken = await this.oauthManager.getValidAccessToken();
          this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));
          const devices = await this.client.devices.list();
          this.handleDevices(devices);
        } catch (refreshError) {
          if (refreshError instanceof AuthRequiredError) {
            this.reportAuthRequired(refreshError.message);
          } else {
            this.log.error('Failed to recover device list after 401:', refreshError);
          }
        }
      }
    }
  }

  private handleDevices(devices: Device[]) {
    this.log.info('🔧 Processing devices...');
    let supportedCount = 0;
    let skippedCount = 0;

    for (const device of devices) {
      if (device.components) {
        const capabilities = this.getCapabilities(device);
        const missingCapabilities = this.getMissingCapabilities(capabilities);

        if (device.deviceId && missingCapabilities.length === 0) {
          this.log.info(`✅ Registering device: ${device.label} (${device.deviceId})`);
          this.handleSupportedDevice(device);
          supportedCount++;
        } else {
          this.log.info(`⏭️ Skipping device: ${device.label} (${device.deviceId}) - Missing capabilities: ${missingCapabilities.join(', ')}`);
          skippedCount++;
        }
      } else {
        this.log.info(`⏭️ Skipping device: ${device.label} (${device.deviceId}) - No components`);
        skippedCount++;
      }
    }

    this.log.info(`📊 Device processing complete: ${supportedCount} supported, ${skippedCount} skipped`);
  }

  private getMissingCapabilities(capabilities: string[]): string[] {
    return SmartThingsAirConditionerAccessory.requiredCapabilities
      .filter((el) => !capabilities.includes(el));
  }

  private handleSupportedDevice(device: Device) {
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === device.deviceId);
    if (existingAccessory) {
      this.handleExistingDevice(device, existingAccessory);
    } else {
      this.handleNewDevice(device);
    }
  }

  private getCapabilities(device: Device) {
    return device.components?.flatMap((component: Component) => component.capabilities)
      .map((capabilityReference: CapabilityReference) => capabilityReference.id) ?? [];
  }

  private handleExistingDevice(device: Device, accessory: PlatformAccessory<UnknownContext>) {
    this.log.info('Restoring existing accessory from cache:', device.label);
    
    // Force cache reset for existing accessories on plugin restart
    this.log.debug('Resetting cache for existing accessory:', device.label);
    this.createSmartThingsAccessory(accessory, device);
  }

  private handleNewDevice(device: Device) {
    this.log.info('Adding new accessory:', device.label);
    const accessory = this.createPlatformAccessory(device);

    this.createSmartThingsAccessory(accessory, device);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  private createPlatformAccessory(device: Device): PlatformAccessory<UnknownContext> {
    if (device.label && device.deviceId) {
      const accessory = new this.api.platformAccessory(device.label, device.deviceId);
      accessory.context.device = device;
      return accessory;
    }

    throw new Error('Missing label and id.');
  }

  private createSmartThingsAccessory(accessory: PlatformAccessory<UnknownContext>, device: Device) {
    if (!this.client) {
      throw new Error('SmartThings client not initialized');
    }

    // Log OAuth2 status for debugging
    this.log.debug('=== OAUTH2 STATUS CHECK ===');
    if (this.oauthManager) {
      this.log.debug('OAuth manager is active');
      this.log.debug('Has valid tokens:', this.oauthManager.hasValidTokens());

      // Check token expiry
      if (this.oauthManager.hasValidTokens()) {
        this.log.debug('OAuth tokens are valid');
      } else {
        this.log.warn('OAuth tokens are invalid or expired');
      }
    } else {
      this.log.debug('Using legacy token authentication');
    }
    this.log.debug('=== OAUTH2 STATUS CHECK END ===');

    const deviceAdapter = new DeviceAdapter(device, this.log, this);
    new SmartThingsAirConditionerAccessory(this, accessory, deviceAdapter);
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Schedule the next token refresh based on actual expiry rather than a
   * fixed interval. Re-arms itself after each run. OAuthManager handles
   * deduplication, retries, and skips the API call if the margin hasn't
   * been crossed yet — so it's safe to call refreshNow() unconditionally.
   */
  private scheduleNextRefresh() {
    if (!this.oauthManager) {
      this.log.warn('No OAuth manager available for token refresh scheduler');
      return;
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    const expiry = this.oauthManager.getTokenExpiryInfo();
    // Fire ~5 minutes before the OAuthManager's own refresh margin (1h),
    // so we're well ahead of expiry. Clamp to [1 min, 30 min].
    const desiredLeadMs = 65 * 60 * 1000;
    const rawDelay = expiry.timeUntilExpiry - desiredLeadMs;
    const delay = Math.max(60_000, Math.min(REFRESH_FALLBACK_INTERVAL_MS, rawDelay));

    this.log.debug(`Next scheduled refresh in ${Math.round(delay / 60000)} min ` +
      `(token expires ${expiry.expiresAt.toISOString()})`);

    this.refreshTimer = setTimeout(() => this.runScheduledRefresh(), delay);
  }

  private async runScheduledRefresh() {
    if (!this.oauthManager) {
      return;
    }
    try {
      this.setAuthState('refreshing');
      await this.oauthManager.refreshNow();
      const accessToken = await this.oauthManager.getValidAccessToken();
      this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));
      this.setAuthState('ok');
      this.log.debug('Scheduled token refresh succeeded');
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        this.reportAuthRequired(error.message);
        // Do NOT call forceReAuthentication automatically — it requires user
        // interaction. The user must visit the OAuth URL or restart with
        // a fresh setup. We keep retrying on the schedule in case the user
        // resolves it externally.
      } else {
        // Transient — keep tokens, try again on the next tick.
        this.log.warn('Scheduled token refresh failed (transient); will retry on next cycle:', error);
      }
    } finally {
      this.scheduleNextRefresh();
    }
  }
}
