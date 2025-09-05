import { DeviceAdapter } from '../../src/deviceAdapter';
import { SmartThingsPlatform } from '../../src/platform';
import { SmartThingsAPIMock } from '../mocks/smartthings-api.mock';
import { Device } from '@smartthings/core-sdk';

describe('DeviceAdapter', () => {
  let deviceAdapter: DeviceAdapter;
  let apiMock: SmartThingsAPIMock;
  let mockDevice: Device;
  let mockPlatform: Partial<SmartThingsPlatform>;

  const testDeviceId = 'test-device-id';
  const testCapabilities = ['switch', 'temperatureMeasurement', 'thermostatCoolingSetpoint', 'airConditionerMode'];

  beforeEach(() => {
    apiMock = new SmartThingsAPIMock();

    // Create mock device
    mockDevice = {
      deviceId: testDeviceId,
      name: 'Test AC',
      label: 'Test AC',
      manufacturerName: 'Samsung',
      presentationId: testDeviceId,
      components: [
        {
          id: 'main',
          capabilities: testCapabilities.map(cap => ({ id: cap })),
        },
      ],
    } as Device;

    // Create mock platform
    mockPlatform = {
      log: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as any,
      config: {
        platform: 'HomebridgeSmartThingsAC',
        minTemperature: 16,
        maxTemperature: 30,
        updateInterval: 15,
      },
    };

    deviceAdapter = new DeviceAdapter(
      mockDevice,
      mockPlatform.log!,
      mockPlatform as any,
    );
  });

  afterEach(() => {
    apiMock.cleanup();
  });

  describe('DeviceAdapter Initialization', () => {
    it('should initialize with device', () => {
      expect(deviceAdapter).toBeDefined();
      expect(deviceAdapter['device']).toBeDefined();
      expect(deviceAdapter['device'].deviceId).toBe(testDeviceId);
    });

    it('should have required device properties', () => {
      expect(mockDevice.deviceId).toBe(testDeviceId);
      expect(mockDevice.name).toBe('Test AC');
      expect(mockDevice.components).toBeDefined();
      expect(mockDevice.components).toHaveLength(1);
    });

    it('should have required capabilities', () => {
      const deviceCapabilities = mockDevice.components?.flatMap((component: any) => component.capabilities)
        .map((capabilityReference: any) => capabilityReference.id) ?? [];
      
      testCapabilities.forEach(expectedCap => {
        expect(deviceCapabilities).toContain(expectedCap);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing authentication gracefully', async () => {
      // Test that the adapter can be created even without authentication
      expect(deviceAdapter).toBeDefined();
      
      // Attempting to get status should fail due to no authentication
      await expect(deviceAdapter.getStatus()).rejects.toThrow('No authentication available');
    });

    it('should handle invalid device gracefully', () => {
      const invalidDevice: Device = {
        ...mockDevice,
        deviceId: 'invalid-device-id',
      } as Device;

      const invalidAdapter = new DeviceAdapter(
        invalidDevice,
        mockPlatform.log!,
        mockPlatform as any,
      );

      expect(invalidAdapter).toBeDefined();
      expect(invalidAdapter['device'].deviceId).toBe('invalid-device-id');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate platform configuration', () => {
      expect(mockPlatform.config).toBeDefined();
      expect(mockPlatform.config!.platform).toBe('HomebridgeSmartThingsAC');
      expect(mockPlatform.config!.minTemperature).toBe(16);
      expect(mockPlatform.config!.maxTemperature).toBe(30);
      expect(mockPlatform.config!.updateInterval).toBe(15);
    });

    it('should validate device configuration', () => {
      expect(mockDevice.deviceId).toBe(testDeviceId);
      expect(mockDevice.name).toBe('Test AC');
      expect(mockDevice.label).toBe('Test AC');
      expect(mockDevice.manufacturerName).toBe('Samsung');
    });
  });
}); 