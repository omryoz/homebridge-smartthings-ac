import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, UnknownContext } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SmartThingsAirConditionerAccessory } from './platformAccessory';
import { BearerTokenAuthenticator, Device, Component, CapabilityReference, SmartThingsClient } from '@smartthings/core-sdk';
import { DeviceAdapter } from './deviceAdapter';
import { OAuthManager, OAuthConfig } from './oauthManager';
import { OAuthSetup } from './oauthSetup';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

export class SmartThingsPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  private readonly accessories: PlatformAccessory[] = [];
  private client: SmartThingsClient | null = null;
  private oauthManager: OAuthManager | null = null;
  private oauthSetup: OAuthSetup | null = null;

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
      const storagePath = path.join(homeDir, '.homebridge', 'smartthings-oauth-tokens.json');

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

      if (!this.oauthManager.hasValidTokens()) {
        this.log.info('No valid OAuth tokens found. Starting authorization flow...');
        await this.startOAuthFlow();
      }

      // Create SmartThings client with OAuth token
      const accessToken = await this.oauthManager.getValidAccessToken();
      this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));

      // Start token refresh scheduler
      this.startTokenRefreshScheduler();

      this.log.info('OAuth authentication initialized successfully');
    } catch (error) {
      this.log.error('Failed to initialize OAuth:', error);
    }
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

  private async initializeLegacyToken() {
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
    this.log.warn('Force re-authentication required...');

    if (this.oauthManager) {
      try {
        // Clear expired tokens
        await this.oauthManager.clearTokens();
        this.log.info('Cleared expired tokens');

        // Start new OAuth flow
        await this.startOAuthFlow();
        this.log.info('Re-authentication completed successfully');
      } catch (error) {
        this.log.error('Failed to re-authenticate:', error);
        throw error;
      }
    } else {
      this.log.error('No OAuth manager available for re-authentication');
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

      // If using OAuth and token refresh failed, try to re-authenticate
      if (this.oauthManager && (error as { response?: { status: number } }).response?.status === 401) {
        this.log.info('Token expired, attempting to refresh...');
        try {
          const accessToken = await this.oauthManager.getValidAccessToken();
          this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));

          // Retry loading devices
          const devices = await this.client.devices.list();
          this.handleDevices(devices);
        } catch (refreshError) {
          this.log.error('Failed to refresh token:', refreshError);

          // If refresh token is also expired, we need to re-authenticate
          if ((refreshError as { response?: { status: number } }).response?.status === 401) {
            this.log.warn('Refresh token expired, starting new OAuth flow...');
            try {
              await this.forceReAuthentication();

              // Retry loading devices with new token
              const devices = await this.client!.devices.list();
              this.handleDevices(devices);
            } catch (oauthError) {
              this.log.error('Failed to re-authenticate:', oauthError);
            }
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

  private startTokenRefreshScheduler() {
    if (!this.oauthManager) {
      this.log.warn('No OAuth manager available for token refresh scheduler');
      return;
    }

    this.log.info('🔄 Starting token refresh scheduler...');

    // Refresh token every 30 minutes (1800000 ms) to ensure it never expires
    const refreshInterval = 30 * 60 * 1000; // 30 minutes

    setInterval(async () => {
      try {
        this.log.debug('🔄 Scheduled token refresh...');

        if (this.oauthManager && this.oauthManager.hasValidTokens()) {
          // Log current token status
          const expiryInfo = this.oauthManager.getTokenExpiryInfo();
          this.log.debug(`📊 Token status: expires at ${expiryInfo.expiresAt.toISOString()}, ${Math.round(expiryInfo.timeUntilExpiry / 60000)} minutes remaining`);

          // Get a fresh token (this will refresh if needed)
          const accessToken = await this.oauthManager.getValidAccessToken();

          // Update the client with the new token
          this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));

          // Log new token status
          const newExpiryInfo = this.oauthManager.getTokenExpiryInfo();
          this.log.debug(`✅ Token refreshed successfully - new expiry: ${newExpiryInfo.expiresAt.toISOString()}`);
        } else {
          this.log.warn('⚠️ No valid tokens found during scheduled refresh');
        }
      } catch (error) {
        this.log.error('❌ Scheduled token refresh failed:', error);

        // If refresh fails, try to re-authenticate
        if ((error as { response?: { status: number } }).response?.status === 401) {
          this.log.warn('🔄 Refresh token expired, attempting re-authentication...');
          try {
            await this.forceReAuthentication();
            this.log.info('✅ Re-authentication successful');
          } catch (reauthError) {
            this.log.error('❌ Re-authentication failed:', reauthError);
          }
        }
      }
    }, refreshInterval);

    this.log.info(`🔄 Token refresh scheduler started - refreshing every ${refreshInterval / 60000} minutes`);
  }
}
