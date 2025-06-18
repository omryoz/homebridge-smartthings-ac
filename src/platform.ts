import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic, UnknownContext } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { SmartThingsAirConditionerAccessory } from './platformAccessory';
import { BearerTokenAuthenticator, Device, Component, CapabilityReference, SmartThingsClient } from '@smartthings/core-sdk';
import { DeviceAdapter } from './deviceAdapter';
import { OAuthManager, OAuthConfig } from './oauthManager';
import { OAuthSetup } from './oauthSetup';
import * as path from 'path';
import * as os from 'os';

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
    this.initializeAuthentication();
  }

  private async initializeAuthentication() {
    // Check if OAuth is configured
    if (this.config.clientId && this.config.clientSecret) {
      await this.initializeOAuth();
    } else if (this.config.token) {
      await this.initializeLegacyToken();
    } else {
      this.log.error('No authentication method configured. Please set up either OAuth (clientId/clientSecret) or a Personal Access Token (token).');
      return;
    }

    // Load devices after authentication is set up
    this.api.on('didFinishLaunching', () => {
      this.loadDevices();
    });
  }

  private async initializeOAuth() {
    try {
      const storagePath = path.join(os.homedir(), '.homebridge', 'smartthings-oauth-tokens.json');

      const oauthConfig: OAuthConfig = {
        clientId: this.config.clientId as string,
        clientSecret: this.config.clientSecret as string,
        redirectUri: this.config.redirectUri || 'http://localhost:3000/oauth/callback',
        scope: 'r:devices:* w:devices:*',
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

      this.log.info('OAuth authentication initialized successfully');
    } catch (error) {
      this.log.error('Failed to initialize OAuth:', error);
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

    this.oauthSetup = new OAuthSetup(this.log, this.oauthManager);

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

  private async loadDevices() {
    if (!this.client) {
      this.log.error('SmartThings client not initialized');
      return;
    }

    try {
      const devices = await this.client.devices.list();
      this.handleDevices(devices);
    } catch (error: any) {
      this.log.error('Cannot load devices:', error);

      // If using OAuth and token refresh failed, try to re-authenticate
      if (this.oauthManager && error.response?.status === 401) {
        this.log.info('Token expired, attempting to refresh...');
        try {
          const accessToken = await this.oauthManager.getValidAccessToken();
          this.client = new SmartThingsClient(new BearerTokenAuthenticator(accessToken));

          // Retry loading devices
          const devices = await this.client.devices.list();
          this.handleDevices(devices);
        } catch (refreshError) {
          this.log.error('Failed to refresh token:', refreshError);
        }
      }
    }
  }

  private handleDevices(devices: Device[]) {
    for (const device of devices) {
      if (device.components) {
        const capabilities = this.getCapabilities(device);
        const missingCapabilities = this.getMissingCapabilities(capabilities);

        if (device.deviceId && missingCapabilities.length === 0) {
          this.log.info('Registering device', device.deviceId);
          this.handleSupportedDevice(device);
        } else {
          this.log.info('Skipping device', device.deviceId, device.label, 'Missing capabilities', missingCapabilities);
        }
      }
    }
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

    const deviceAdapter = new DeviceAdapter(device, this.log, this.client);
    new SmartThingsAirConditionerAccessory(this, accessory, deviceAdapter);
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }
}
