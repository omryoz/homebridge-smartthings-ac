import { API, Logger, PlatformAccessory, Service, Characteristic } from 'homebridge';

export class HomebridgeMock {
  public mockAPI: Partial<API>;
  public mockLogger: Partial<Logger>;
  public mockAccessory: Partial<PlatformAccessory>;
  public mockService: Partial<Service>;
  public mockCharacteristic: Partial<Characteristic>;

  constructor() {
    this.setupMocks();
  }

  private setupMocks() {
    // Mock Logger
    this.mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    // Mock Characteristic
    this.mockCharacteristic = {
      onGet: jest.fn().mockReturnThis(),
      onSet: jest.fn().mockReturnThis(),
      setProps: jest.fn().mockReturnThis(),
      updateValue: jest.fn(),
      getValue: jest.fn(),
      setValue: jest.fn(),
    };

    // Mock Service
    this.mockService = {
      getCharacteristic: jest.fn().mockReturnValue(this.mockCharacteristic),
      setCharacteristic: jest.fn().mockReturnThis(),
      updateCharacteristic: jest.fn(),
      addCharacteristic: jest.fn().mockReturnValue(this.mockCharacteristic),
    };

    // Mock PlatformAccessory
    this.mockAccessory = {
      getService: jest.fn().mockReturnValue(this.mockService),
      addService: jest.fn().mockReturnValue(this.mockService),
      context: {},
      displayName: 'Mock AC Device',
      UUID: 'mock-uuid',
    };

    // Mock API
    this.mockAPI = {
      hap: {
        Service: {
          HeaterCooler: 'HeaterCooler',
          AccessoryInformation: 'AccessoryInformation',
        },
        Characteristic: {
          Active: 'Active',
          CurrentTemperature: 'CurrentTemperature',
          CurrentRelativeHumidity: 'CurrentRelativeHumidity',
          HeatingThresholdTemperature: 'HeatingThresholdTemperature',
          CoolingThresholdTemperature: 'CoolingThresholdTemperature',
          TargetHeaterCoolerState: 'TargetHeaterCoolerState',
          Name: 'Name',
          Manufacturer: 'Manufacturer',
          Model: 'Model',
          SerialNumber: 'SerialNumber',
        },
      },
      on: jest.fn(),
      registerPlatformAccessories: jest.fn(),
      unregisterPlatformAccessories: jest.fn(),
      updatePlatformAccessories: jest.fn(),
    };
  }

  // Helper methods for testing
  getMockCharacteristicValue(characteristicName: string): any {
    const characteristic = this.mockService.getCharacteristic(characteristicName);
    return characteristic?.getValue?.() || null;
  }

  setMockCharacteristicValue(characteristicName: string, value: any): void {
    const characteristic = this.mockService.getCharacteristic(characteristicName);
    characteristic?.setValue?.(value);
  }

  // Mock characteristic event handlers
  mockCharacteristicHandler(characteristicName: string, handlerType: 'onGet' | 'onSet'): jest.Mock {
    const characteristic = this.mockService.getCharacteristic(characteristicName);
    const handler = jest.fn();
    
    if (handlerType === 'onGet') {
      characteristic?.onGet?.(handler);
    } else {
      characteristic?.onSet?.(handler);
    }
    
    return handler;
  }

  // Reset all mocks
  resetMocks(): void {
    jest.clearAllMocks();
    this.setupMocks();
  }

  // Verify characteristic interactions
  verifyCharacteristicSet(characteristicName: string, expectedValue: any): void {
    const characteristic = this.mockService.getCharacteristic(characteristicName);
    expect(characteristic?.setValue).toHaveBeenCalledWith(expectedValue);
  }

  verifyCharacteristicGet(characteristicName: string): void {
    const characteristic = this.mockService.getCharacteristic(characteristicName);
    expect(characteristic?.getValue).toHaveBeenCalled();
  }

  // Mock device status updates
  mockDeviceStatusUpdate(status: {
    active: boolean;
    currentTemperature: number;
    targetTemperature: number;
    mode: string;
    currentHumidity?: number;
  }): void {
    // Mock the status update by setting characteristic values
    this.setMockCharacteristicValue('Active', status.active ? 1 : 0);
    this.setMockCharacteristicValue('CurrentTemperature', status.currentTemperature);
    this.setMockCharacteristicValue('CoolingThresholdTemperature', status.targetTemperature);
    this.setMockCharacteristicValue('TargetHeaterCoolerState', this.getModeValue(status.mode));
    
    if (status.currentHumidity !== undefined) {
      this.setMockCharacteristicValue('CurrentRelativeHumidity', status.currentHumidity);
    }
  }

  private getModeValue(mode: string): number {
    switch (mode.toLowerCase()) {
      case 'auto': return 0;
      case 'heat': return 1;
      case 'cool': return 2;
      default: return 0;
    }
  }
} 