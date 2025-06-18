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

    this.log.debug('Executing command', capability, command, 'with arguments:', commandArguments);
    this.log.debug('Device ID:', this.device.deviceId);
    this.log.debug('Device label:', this.device.label);

    try {
      const status = await this.client.devices.executeCommand(this.device.deviceId, {
        component: 'main',
        command: command,
        capability: capability,
        arguments: commandArguments,
      });

      this.log.debug('Command executed with status', status.status);
      this.log.debug('Full response:', JSON.stringify(status, null, 2));

      if (status.status !== 'success') {
        this.log.error('Command failed with status:', status.status);
        throw Error('Command failed with status ' + status.status);
      }

      this.log.info('Command executed successfully:', command, 'on capability:', capability);
    } catch (error) {
      this.log.error('Exception during command execution:', error);
      this.log.error(
        'Command details -',
        'Device:', this.device.deviceId,
        'Capability:', capability,
        'Command:', command,
        'Arguments:', commandArguments,
      );
      throw error;
    }
  }
}