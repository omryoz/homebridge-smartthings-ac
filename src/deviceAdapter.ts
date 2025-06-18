import { ComponentStatus, Device, DeviceStatus, SmartThingsClient } from '@smartthings/core-sdk';
import { Logger } from 'homebridge';
import { PlatformStatusInfo } from './platformStatusInfo';

export class DeviceAdapter {
  constructor(
        private readonly device: Device,
        private readonly log: Logger,
        private readonly client: SmartThingsClient,
  ) {}

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

  private getDeviceStatus(): Promise<DeviceStatus> {
    if (!this.device.deviceId) {
      throw new Error('Device id must be set.');
    }

    this.log.debug('Get status for device', this.device.deviceId);
    return this.client.devices.getStatus(this.device.deviceId);
  }

  public async executeMainCommand(command: string, capability: string, commandArguments?: (string | number)[]) {
    if (!this.device.deviceId) {
      throw Error('Device ID must be set');
    }

    this.log.info('=== COMMAND EXECUTION START ===');
    this.log.info('Device ID:', this.device.deviceId);
    this.log.info('Device label:', this.device.label);
    this.log.info('Capability:', capability);
    this.log.info('Command:', command);
    this.log.info('Arguments:', commandArguments);

    // Log device capabilities for debugging
    this.log.debug('Device capabilities:', JSON.stringify(this.device.components, null, 2));

    try {
      // Get current device status before command
      this.log.info('Getting device status before command execution...');
      const statusBefore = await this.getDeviceStatus();
      this.log.info('Status before command:', JSON.stringify(statusBefore, null, 2));

      const commandPayload = {
        component: 'main',
        command: command,
        capability: capability,
        arguments: commandArguments,
      };

      this.log.info('Executing command with payload:', JSON.stringify(commandPayload, null, 2));

      const status = await this.client.devices.executeCommand(this.device.deviceId, commandPayload);

      this.log.info('=== COMMAND EXECUTION RESPONSE ===');
      this.log.info('Response status:', status.status);
      this.log.info('Full response:', JSON.stringify(status, null, 2));

      if (status.status !== 'success') {
        this.log.error('Command failed with status:', status.status);
        this.log.error('Error details:', JSON.stringify(status, null, 2));
        throw Error('Command failed with status ' + status.status);
      }

      this.log.info('Command executed successfully, waiting for device to respond...');

      // Wait a moment for the device to process the command
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get device status after command
      this.log.info('Getting device status after command execution...');
      const statusAfter = await this.getDeviceStatus();
      this.log.info('Status after command:', JSON.stringify(statusAfter, null, 2));

      // Compare statuses to see if anything changed
      this.compareStatuses(statusBefore, statusAfter);

      this.log.info('=== COMMAND EXECUTION END ===');
    } catch (error) {
      this.log.error('=== COMMAND EXECUTION ERROR ===');
      this.log.error('Exception during command execution:', error);
      this.log.error('Error type:', typeof error);
      this.log.error('Error message:', error instanceof Error ? error.message : String(error));
      this.log.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');

      // Check for OAuth2-specific errors
      if (error instanceof Error) {
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          this.log.error('OAuth2 AUTHENTICATION ERROR: Token may be expired or invalid');
          this.log.error('This could be the root cause of command failures');
        }
        if (error.message.includes('403') || error.message.includes('Forbidden')) {
          this.log.error('OAuth2 PERMISSION ERROR: Token may not have required scopes');
          this.log.error('Required scopes: r:devices:* w:devices:* x:devices:* r:locations:*');
        }
      }

      // Check for response errors
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any).response) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const response = (error as any).response;
        this.log.error('HTTP Response Status:', response.status);
        this.log.error('HTTP Response Data:', JSON.stringify(response.data, null, 2));

        if (response.status === 401) {
          this.log.error('OAuth2 AUTHENTICATION ERROR: Token expired or invalid');
        } else if (response.status === 403) {
          this.log.error('OAuth2 PERMISSION ERROR: Insufficient permissions');
        }
      }

      this.log.error(
        'Command details -',
        'Device:', this.device.deviceId,
        'Capability:', capability,
        'Command:', command,
        'Arguments:', commandArguments,
      );
      this.log.error('=== COMMAND EXECUTION ERROR END ===');
      throw error;
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