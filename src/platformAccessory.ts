import { CapabilityReference, Component, Device } from '@smartthings/core-sdk';
import { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import { DeviceAdapter } from './deviceAdapter';
import { SmartThingsPlatform } from './platform';
import { PlatformStatusInfo } from './platformStatusInfo';

const defaultUpdateInterval = 15;
const defaultMinTemperature = 16;
const defaultMaxTemperature = 30;

enum TargetHeaterCoolerState {
  AUTO = 0,
  HEAT = 1,
  COOL = 2
}

export class SmartThingsAirConditionerAccessory {
  private service: Service;
  private device: Device;

  private deviceStatus: PlatformStatusInfo;

  public static readonly requiredCapabilities = [
    'switch',
    'temperatureMeasurement',
    'thermostatCoolingSetpoint',
    'airConditionerMode',
  ];

  constructor(
    private readonly platform: SmartThingsPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceAdapter: DeviceAdapter,
  ) {
    this.device = accessory.context.device as Device;
    this.deviceStatus = {
      mode: 'auto',
      active: false,
      currentHumidity: 0,
      currentTemperature: this.platform.config.minTemperature ?? defaultMinTemperature,
      targetTemperature: this.platform.config.minTemperature ?? defaultMinTemperature,
    };

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, this.device.manufacturerName ?? 'unknown')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.name ?? 'unknown')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.presentationId ?? 'unknown');

    this.service = this.accessory.getService(this.platform.Service.HeaterCooler)
      || this.accessory.addService(this.platform.Service.HeaterCooler);
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.device.label ?? 'unkown');

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    const temperatureProperties = {
      maxValue: this.platform.config.maxTemperature ?? defaultMaxTemperature,
      minValue: this.platform.config.minTemperature ?? defaultMinTemperature,
      minStep: 1,
    };

    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps(temperatureProperties)
      .onGet(this.getCoolingTemperature.bind(this))
      .onSet(this.setCoolingTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CoolingThresholdTemperature)
      .setProps(temperatureProperties)
      .onGet(this.getCoolingTemperature.bind(this))
      .onSet(this.setCoolingTemperature.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .onGet(this.getHeaterCoolerState.bind(this))
      .onSet(this.setHeaterCoolerState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    if (this.hasCapability('relativeHumidityMeasurement')) {
      this.platform.log.debug('Registering current relative humidity characteristic for device', this.device.deviceId);
      this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
        .onGet(this.getCurrentHumidity.bind(this));
    } else {
      this.platform.log.info('Current relative humidity will not be available for device', this.device.deviceId);
    }

    const updateInterval = this.platform.config.updateInterval ?? defaultUpdateInterval;
    this.platform.log.info('Update status every', updateInterval, 'secs');

    this.updateStatus();
    setInterval(async () => {
      await this.updateStatus();
    }, updateInterval * 1000);
  }

  private hasCapability(id: string): boolean {
    return !!this.device.components
      ?.filter((component: Component) => component.id === 'main')
      ?.flatMap((component: Component) => component.capabilities)
      ?.find((capabilityReference: CapabilityReference) => capabilityReference.id === id);
  }

  private getHeaterCoolerState():CharacteristicValue {
    return this.fromSmartThingsMode(this.deviceStatus.mode);
  }

  private getCoolingTemperature(): CharacteristicValue {
    return this.deviceStatus.targetTemperature;
  }

  private getActive(): CharacteristicValue {
    return this.deviceStatus.active;
  }

  private getCurrentTemperature(): CharacteristicValue {
    return this.deviceStatus.currentTemperature;
  }

  private getCurrentHumidity(): CharacteristicValue {
    return this.deviceStatus.currentHumidity;
  }

  private async setActive(value: CharacteristicValue) {
    const isActive = value === 1;

    this.platform.log.info('=== SET ACTIVE COMMAND START ===');
    this.platform.log.info('setActive called with value:', value, 'isActive:', isActive);
    this.platform.log.info('Device ID:', this.device.deviceId);
    this.platform.log.info('Device label:', this.device.label);
    this.platform.log.info('Current device status before command:', JSON.stringify(this.deviceStatus, null, 2));

    try {
      this.platform.log.info('Executing command:', isActive ? 'on' : 'off', 'on capability: switch');
      await this.executeCommand(isActive ? 'on' : 'off', 'switch');

      this.platform.log.info('Command executed successfully, updating local device status');
      this.deviceStatus.active = isActive;

      // Force an immediate status update to verify the change
      this.platform.log.info('Forcing immediate status update to verify change...');
      await this.updateStatus();
      this.platform.log.info('Updated device status:', JSON.stringify(this.deviceStatus, null, 2));

      // Force update HomeKit characteristics to reflect the actual state
      this.platform.log.info('Updating HomeKit characteristics...');
      this.updateHomeKitCharacteristics();

      this.platform.log.info('=== SET ACTIVE COMMAND END ===');
    } catch(error) {
      this.platform.log.error('=== SET ACTIVE COMMAND ERROR ===');
      this.platform.log.error('Cannot set device active', error);
      this.platform.log.error('Error details:', JSON.stringify(error, null, 2));
      this.platform.log.error('Attempting to refresh device status...');
      await this.updateStatus();
      this.updateHomeKitCharacteristics();
      this.platform.log.error('=== SET ACTIVE COMMAND ERROR END ===');
    }
  }

  private updateHomeKitCharacteristics() {
    try {
      // Update Active characteristic
      this.service.updateCharacteristic(this.platform.Characteristic.Active, this.deviceStatus.active ? 1 : 0);

      // Update Target Heater Cooler State
      this.service.updateCharacteristic(
        this.platform.Characteristic.TargetHeaterCoolerState,
        this.fromSmartThingsMode(this.deviceStatus.mode),
      );

      // Update Cooling Threshold Temperature
      this.service.updateCharacteristic(
        this.platform.Characteristic.CoolingThresholdTemperature,
        this.deviceStatus.targetTemperature,
      );

      // Update Current Temperature
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        this.deviceStatus.currentTemperature,
      );

      // Update Current Relative Humidity if available
      if (this.hasCapability('relativeHumidityMeasurement')) {
        this.service.updateCharacteristic(
          this.platform.Characteristic.CurrentRelativeHumidity,
          this.deviceStatus.currentHumidity,
        );
      }

      this.platform.log.info('HomeKit characteristics updated successfully');
    } catch (error) {
      this.platform.log.error('Failed to update HomeKit characteristics:', error);
    }
  }

  private async setHeaterCoolerState(value: CharacteristicValue) {
    const mode = this.toSmartThingsMode(value);

    try {
      await this.executeCommand('setAirConditionerMode', 'airConditionerMode', [ mode ]);
      this.deviceStatus.mode = mode;

      // Update HomeKit characteristics
      this.updateHomeKitCharacteristics();
    } catch(error) {
      this.platform.log.error('Cannot set device mode', error);
      await this.updateStatus();
      this.updateHomeKitCharacteristics();
    }
  }

  private async setCoolingTemperature(value: CharacteristicValue) {
    const targetTemperature = value as number;

    try {
      await this.executeCommand('setCoolingSetpoint', 'thermostatCoolingSetpoint', [targetTemperature]);
      this.deviceStatus.targetTemperature = targetTemperature;

      // Update HomeKit characteristics
      this.updateHomeKitCharacteristics();
    } catch(error) {
      this.platform.log.error('Cannot set device temperature', error);
      await this.updateStatus();
      this.updateHomeKitCharacteristics();
    }
  }

  private toSmartThingsMode(value: CharacteristicValue): string {
    switch (value) {
      case TargetHeaterCoolerState.HEAT: return 'heat';
      case TargetHeaterCoolerState.COOL: return 'cool';
      case TargetHeaterCoolerState.AUTO: return 'auto';
    }

    this.platform.log.warn('Illegal heater-cooler state', value);
    return 'auto';
  }

  private fromSmartThingsMode(state: string): CharacteristicValue {
    switch (state) {
      case 'cool': return TargetHeaterCoolerState.COOL;
      case 'auto': return TargetHeaterCoolerState.AUTO;
      case 'heat': return TargetHeaterCoolerState.HEAT;
    }

    this.platform.log.warn('Received unknown heater-cooler state', state);
    return TargetHeaterCoolerState.AUTO;
  }

  private async updateStatus() {
    try {
      this.platform.log.debug('=== UPDATE STATUS START ===');
      this.platform.log.debug('Current device status before update:', JSON.stringify(this.deviceStatus, null, 2));

      const newStatus = await this.getStatus();
      this.platform.log.debug('New status from device:', JSON.stringify(newStatus, null, 2));

      // Check if status actually changed
      const statusChanged = JSON.stringify(this.deviceStatus) !== JSON.stringify(newStatus);
      this.platform.log.debug('Status changed:', statusChanged);

      this.deviceStatus = newStatus;
      this.platform.log.debug('Updated device status:', JSON.stringify(this.deviceStatus, null, 2));
      this.platform.log.debug('=== UPDATE STATUS END ===');
    } catch(error: unknown) {
      this.platform.log.error('=== UPDATE STATUS ERROR ===');
      this.platform.log.error('Error while fetching device status: ' + this.getErrorMessage(error));
      this.platform.log.error('Error details:', JSON.stringify(error, null, 2));
      this.platform.log.debug('Caught error', error);
      this.platform.log.error('=== UPDATE STATUS ERROR END ===');
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private async executeCommand(command: string, capability: string, commandArguments?: (string | number)[]) {
    await this.deviceAdapter.executeMainCommand(command, capability, commandArguments);
  }

  private getStatus(): Promise<PlatformStatusInfo> {
    return this.deviceAdapter.getStatus();
  }
}
