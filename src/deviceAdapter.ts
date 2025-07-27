import { ComponentStatus, Device, DeviceStatus, SmartThingsClient, BearerTokenAuthenticator } from '@smartthings/core-sdk';
import { Logger } from 'homebridge';
import { PlatformStatusInfo } from './platformStatusInfo';
import { SmartThingsPlatform } from './platform';

export class DeviceAdapter {
  constructor(
        private readonly device: Device,
        private readonly log: Logger,
        private readonly platform: SmartThingsPlatform,
  ) {}

  private async getClient(): Promise<SmartThingsClient> {
    // If using OAuth, get a fresh token
    if (this.platform['oauthManager']) {
      try {
        const accessToken = await this.platform['oauthManager'].getValidAccessToken();
        return new SmartThingsClient(new BearerTokenAuthenticator(accessToken));
      } catch (error) {
        this.log.error('Failed to get valid access token:', error);

        // If refresh token is expired, we need to re-authenticate
        if ((error as { response?: { status: number } }).response?.status === 401) {
          this.log.warn('Refresh token expired, starting new OAuth flow...');
          try {
            // Use the centralized re-authentication method
            await this.platform['forceReAuthentication']();
            const accessToken = await this.platform['oauthManager'].getValidAccessToken();
            return new SmartThingsClient(new BearerTokenAuthenticator(accessToken));
          } catch (oauthError) {
            this.log.error('Failed to re-authenticate:', oauthError);
            throw error; // Re-throw original error
          }
        }
        throw error;
      }
    }

    // If using legacy token, use the existing client
    if (this.platform['client']) {
      return this.platform['client'];
    }

    throw new Error('No authentication available');
  }

  async getStatus(): Promise<PlatformStatusInfo> {
    const mainComponent = await this.getMainComponent();

    return {
      mode: mainComponent?.['airConditionerMode']?.['airConditionerMode']?.['value'] as string,
      targetTemperature: mainComponent?.['thermostatCoolingSetpoint']?.['coolingSetpoint']?.['value'] as number,
      currentTemperature: mainComponent?.['temperatureMeasurement']?.['temperature']?.['value'] as number,
      currentHumidity: mainComponent?.['relativeHumidityMeasurement']?.['humidity']?.['value'] as number,
      active: mainComponent?.['switch']?.['switch']?.['value'] === 'on',
    };
  }

  private async getMainComponent(): Promise<ComponentStatus> {
    const status = await this.getDeviceStatus();

    if (!status.components) {
      throw Error('Cannot get device status');
    }
    return status.components['main'];
  }

  private async getDeviceStatus(): Promise<DeviceStatus> {
    if (!this.device.deviceId) {
      throw new Error('Device id must be set.');
    }

    this.log.debug('Get status for device', this.device.deviceId);
    const client = await this.getClient();
    return client.devices.getStatus(this.device.deviceId);
  }

  public async executeMainCommand(command: string, capability: string, commandArguments?: (string | number)[]) {
    if (!this.device.deviceId) {
      throw Error('Device ID must be set');
    }

    this.log.debug('🔥 executeMainCommand called:', capability, command, commandArguments);

    this.log.debug('Executing command', capability, command);

    const client = await this.getClient();
    const status = await client.devices.executeCommand(this.device.deviceId, {
      component: 'main',
      command: command,
      capability: capability,
      arguments: commandArguments,
    });

    this.log.debug('Command executed with status', status.status);
    if (status.status !== 'success') {
      throw Error('Command failed with status ' + status.status);
    }
  }

  private compareStatuses(statusBefore: DeviceStatus, statusAfter: DeviceStatus) {
    this.log.info('=== STATUS COMPARISON ===');

    const beforeMain = statusBefore.components?.main;
    const afterMain = statusAfter.components?.main;

    if (!beforeMain || !afterMain) {
      this.log.warn('Cannot compare statuses - missing main component');
      return;
    }

    // Compare switch status
    const beforeSwitch = beforeMain['switch']?.['switch']?.['value'];
    const afterSwitch = afterMain['switch']?.['switch']?.['value'];
    this.log.info(`Switch status: ${beforeSwitch} -> ${afterSwitch} ${beforeSwitch === afterSwitch ? '(NO CHANGE)' : '(CHANGED)'}`);

    // Compare air conditioner mode
    const beforeMode = beforeMain['airConditionerMode']?.['airConditionerMode']?.['value'];
    const afterMode = afterMain['airConditionerMode']?.['airConditionerMode']?.['value'];
    this.log.info(`AC mode: ${beforeMode} -> ${afterMode} ${beforeMode === afterMode ? '(NO CHANGE)' : '(CHANGED)'}`);

    // Compare temperature setpoint
    const beforeTemp = beforeMain['thermostatCoolingSetpoint']?.['coolingSetpoint']?.['value'];
    const afterTemp = afterMain['thermostatCoolingSetpoint']?.['coolingSetpoint']?.['value'];
    this.log.info(`Temperature setpoint: ${beforeTemp} -> ${afterTemp} ${beforeTemp === afterTemp ? '(NO CHANGE)' : '(CHANGED)'}`);

    this.log.info('=== STATUS COMPARISON END ===');
  }
}