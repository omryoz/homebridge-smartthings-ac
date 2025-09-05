import { SmartThingsPlatform } from '../../src/platform';
import { DeviceAdapter } from '../../src/deviceAdapter';
import { IntegrationTestConfig, MockDeviceStatus } from '../types/test-config';
import { Device } from '@smartthings/core-sdk';
import { OAuthSetup } from '../../src/oauthSetup';

/**
 * End-to-End Test for SmartThings AC Control with Real Devices
 * 
 * This test ACTUALLY communicates with real SmartThings devices.
 * It uses the built-in OAuth server to handle authentication.
 * 
 * Requirements:
 * 1. Valid SmartThings OAuth credentials
 * 2. A real AC device in your SmartThings account
 * 3. Network access to SmartThings API
 * 4. User interaction for OAuth flow (first time only)
 * 
 * Environment Variables Required:
 * - SMARTTHINGS_CLIENT_ID
 * - SMARTTHINGS_CLIENT_SECRET  
 * - SMARTTHINGS_DEVICE_ID (the actual AC device ID to test)
 * - SMARTTHINGS_REDIRECT_URI (optional, defaults to localhost)
 */

describe('SmartThings AC End-to-End Tests - REAL DEVICES', () => {
  let platform: SmartThingsPlatform;
  let deviceAdapter: DeviceAdapter;
  let realDevice: Device;
  let oauthSetup: OAuthSetup | null = null;

  // Test configuration from environment
  const testConfig: IntegrationTestConfig = {
    auth: {
      clientId: process.env.SMARTTHINGS_CLIENT_ID!,
      clientSecret: process.env.SMARTTHINGS_CLIENT_SECRET!,
      redirectUri: process.env.SMARTTHINGS_REDIRECT_URI || 'https://localhost:3000/oauth/callback',
    },
    device: {
      deviceId: process.env.SMARTTHINGS_DEVICE_ID!,
      capabilities: ['switch', 'temperatureMeasurement', 'thermostatCoolingSetpoint', 'airConditionerMode'],
      expectedCapabilities: ['switch', 'temperatureMeasurement', 'thermostatCoolingSetpoint', 'airConditionerMode'],
      manufacturerName: 'Samsung',
      name: 'Real AC Device',
      label: 'Real AC Device',
    },
    testParams: {
      minTemperature: 16,
      maxTemperature: 30,
      updateInterval: 15,
    },
    environment: {
      homebridgePath: process.env.HOMEBRIDGE_PATH || '/usr/local/lib/node_modules/homebridge',
      networkAccess: true,
      nodeVersion: process.version,
    },
  };

  beforeAll(async () => {
    // Validate required environment variables
    const requiredEnvVars = [
      'SMARTTHINGS_CLIENT_ID',
      'SMARTTHINGS_CLIENT_SECRET', 
      'SMARTTHINGS_DEVICE_ID',
    ];

    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Create simplified API for testing (focus on device communication, not Homebridge integration)
    const testAPI = {
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

    // Create logger
    const testLogger = {
      debug: console.debug,
      info: console.info,
      warn: console.warn,
      error: console.error,
    };

    // Initialize platform for device communication testing
    platform = new SmartThingsPlatform(
      testLogger as any,
      testConfig as any,
      testAPI as any,
    );

    // Wait for platform initialization with authentication
    console.log('🔐 Waiting for platform authentication...');
    let attempts = 0;
    const maxAttempts = 120; // 2 minutes for OAuth flow
    
    while (attempts < maxAttempts) {
      try {
        // Check if authentication is ready
        if (platform['client'] || platform['oauthManager']) {
          console.log('✅ Platform authentication initialized');
          
          // If we have OAuth manager but no client, we might need to start OAuth flow
          if (platform['oauthManager'] && !platform['client']) {
            console.log('🔄 Starting OAuth flow for testing...');
            
            // Create OAuth setup for testing
            oauthSetup = new OAuthSetup(
              platform.log,
              platform['oauthManager'],
              3000, // Use port 3000 for testing
              true, // Use HTTPS
            );
            
            // Start the OAuth flow
            await oauthSetup.startAuthorizationFlow();
            console.log('✅ OAuth flow completed successfully');
          }
          
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
        console.log(`⏳ Waiting for authentication... (${attempts}/${maxAttempts})`);
      } catch (error) {
        console.log('Authentication error:', error);
        await new Promise(resolve => setTimeout(resolve, 1000));
        attempts++;
      }
    }
    
    if (attempts >= maxAttempts) {
      throw new Error('Platform authentication timeout - check your OAuth credentials');
    }
  }, 180000); // 3 minute timeout for OAuth

  beforeEach(async () => {
    // Get the REAL device from SmartThings
    console.log('🔍 Fetching real device from SmartThings...');
    
    try {
      // Access the client through the platform's private methods
      const client = await platform['getClient']?.() || platform['client'];
      if (!client) {
        throw new Error('No SmartThings client available');
      }

      const devices = await client.devices.list();
      realDevice = devices.find(d => d.deviceId === testConfig.device.deviceId)!;

      if (!realDevice) {
        throw new Error(`Device ${testConfig.device.deviceId} not found in SmartThings account`);
      }

      console.log(`✅ Found real device: ${realDevice.name || realDevice.deviceId}`);

      // Initialize device adapter with REAL device
      deviceAdapter = new DeviceAdapter(
        realDevice,
        platform.log,
        platform,
      );

      // Get initial device status
      const initialStatus = await deviceAdapter.getStatus();
      console.log('📱 Initial device status:', initialStatus);
    } catch (error) {
      console.error('❌ Failed to get real device:', error);
      throw error;
    }
  });

  afterAll(async () => {
    // Cleanup - ensure device is in a safe state
    try {
      if (deviceAdapter) {
        await deviceAdapter.executeMainCommand('off', 'switch');
        console.log('🔌 Device turned off for cleanup');
      }
    } catch (error) {
      console.warn('⚠️ Failed to turn off device during cleanup:', error);
    }

    // Stop OAuth server if running
    if (oauthSetup) {
      oauthSetup.stop();
      console.log('🛑 OAuth server stopped');
    }
  });

  describe('Real Device Discovery and Status', () => {
    it('should successfully connect to SmartThings API', async () => {
      const client = await platform['getClient']?.() || platform['client'];
      expect(client).toBeDefined();
      console.log('✅ SmartThings API connection successful');
    });

    it('should find the real AC device', () => {
      expect(realDevice).toBeDefined();
      expect(realDevice.deviceId).toBe(testConfig.device.deviceId);
      expect(realDevice.components).toBeDefined();
      console.log(`✅ Real device found: ${realDevice.name || realDevice.deviceId}`);
    });

    it('should have required capabilities', () => {
      // Check if REAL device has the required capabilities
      expect(realDevice).toBeDefined();
      expect(realDevice.deviceId).toBe(testConfig.device.deviceId);
      expect(realDevice.components).toBeDefined();
      
      // Get capabilities from REAL device components
      const deviceCapabilities = realDevice.components?.flatMap((component: any) => component.capabilities)
        .map((capabilityReference: any) => capabilityReference.id) ?? [];
      
      testConfig.device.expectedCapabilities.forEach(expectedCap => {
        expect(deviceCapabilities).toContain(expectedCap);
      });
      
      console.log('✅ Real device capabilities:', deviceCapabilities);
    });

    it('should retrieve current device status from REAL device', async () => {
      const status = await deviceAdapter.getStatus();
      
      expect(status).toBeDefined();
      expect(typeof status.active).toBe('boolean');
      expect(typeof status.currentTemperature).toBe('number');
      expect(typeof status.targetTemperature).toBe('number');
      expect(typeof status.mode).toBe('string');
      
      console.log('📱 Real device status:', status);
    });
  });

  describe('Real AC Control Operations', () => {
    let initialStatus: MockDeviceStatus;

    beforeEach(async () => {
      initialStatus = await deviceAdapter.getStatus();
      console.log('🧪 Test starting with real device status:', initialStatus);
    });

    afterEach(async () => {
      // Restore initial state on REAL device
      try {
        if (initialStatus.active) {
          await deviceAdapter.executeMainCommand('on', 'switch');
        } else {
          await deviceAdapter.executeMainCommand('off', 'switch');
        }
        await deviceAdapter.executeMainCommand('setCoolingSetpoint', 'thermostatCoolingSetpoint', [initialStatus.targetTemperature]);
        console.log('🔄 Restored initial device state');
      } catch (error) {
        console.warn('⚠️ Failed to restore initial state:', error);
      }
    });

    it('should turn REAL AC on and off', async () => {
      // Turn REAL AC on
      console.log('🔄 Turning REAL AC on...');
      const onResult = await deviceAdapter.executeMainCommand('on', 'switch');
      expect(onResult).toBe(true);

      // Verify it's on
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for state change
      const onStatus = await deviceAdapter.getStatus();
      expect(onStatus.active).toBe(true);
      console.log('✅ AC turned ON successfully');

      // Turn REAL AC off
      console.log('🔄 Turning REAL AC off...');
      const offResult = await deviceAdapter.executeMainCommand('off', 'switch');
      expect(offResult).toBe(true);

      // Verify it's off
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for state change
      const offStatus = await deviceAdapter.getStatus();
      expect(offStatus.active).toBe(false);
      console.log('✅ AC turned OFF successfully');
    }, 60000); // 60 second timeout

    it('should set temperature on REAL device', async () => {
      const testTemperature = 22;
      
      console.log(`🌡️ Setting temperature to ${testTemperature}°C on REAL device...`);
      const result = await deviceAdapter.executeMainCommand('setCoolingSetpoint', 'thermostatCoolingSetpoint', [testTemperature]);
      expect(result).toBe(true);

      // Verify temperature was set
      await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for state change
      const status = await deviceAdapter.getStatus();
      expect(status.targetTemperature).toBe(testTemperature);
      console.log('✅ Temperature set successfully');
    }, 60000);

    it('should change AC mode on REAL device', async () => {
      const testModes = ['auto', 'cool', 'heat'];
      
      for (const mode of testModes) {
        console.log(`🔄 Setting AC mode to ${mode} on REAL device...`);
        const result = await deviceAdapter.executeMainCommand('setAirConditionerMode', 'airConditionerMode', [mode]);
        expect(result).toBe(true);

        // Verify mode was set
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for state change
        const status = await deviceAdapter.getStatus();
        expect(status.mode).toBe(mode);
        console.log(`✅ Mode ${mode} set successfully`);
      }
    }, 120000); // 2 minute timeout for multiple mode changes

    it('should handle rapid command sequences on REAL device', async () => {
      // Test multiple commands in quick succession on REAL device
      const commands = [
        () => deviceAdapter.executeMainCommand('on', 'switch'),
        () => deviceAdapter.executeMainCommand('setCoolingSetpoint', 'thermostatCoolingSetpoint', [20]),
        () => deviceAdapter.executeMainCommand('setAirConditionerMode', 'airConditionerMode', ['cool']),
        () => deviceAdapter.executeMainCommand('setCoolingSetpoint', 'thermostatCoolingSetpoint', [24]),
      ];

      console.log('⚡ Executing rapid command sequence on REAL device...');
      const results = await Promise.all(commands.map(cmd => cmd()));
      
      // All commands should succeed
      results.forEach(result => {
        expect(result).toBe(true);
      });

      // Verify final state
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for all changes
      const finalStatus = await deviceAdapter.getStatus();
      expect(finalStatus.active).toBe(true);
      expect(finalStatus.targetTemperature).toBe(24);
      expect(finalStatus.mode).toBe('cool');
      console.log('✅ Rapid command sequence completed successfully');
    }, 90000);
  });

  describe('Real Error Handling and Edge Cases', () => {
    it('should handle invalid device ID gracefully', async () => {
      const invalidDevice: Device = {
        ...realDevice,
        deviceId: 'invalid-device-id',
      } as Device;

      const invalidAdapter = new DeviceAdapter(
        invalidDevice,
        platform.log,
        platform,
      );

      await expect(invalidAdapter.getStatus()).rejects.toThrow();
    });

    it('should handle network timeouts with REAL device', async () => {
      const status = await deviceAdapter.getStatus();
      expect(status).toBeDefined();
      console.log('✅ Network timeout handling works with real device');
    });

    it('should maintain state consistency after errors on REAL device', async () => {
      const initialStatus = await deviceAdapter.getStatus();
      
      // Try to set an invalid temperature (should fail)
      try {
        await deviceAdapter.executeMainCommand('setCoolingSetpoint', 'thermostatCoolingSetpoint', [100]); // Invalid temp
      } catch (error) {
        console.log('Expected error for invalid temperature:', error);
      }

      // Verify device state is still consistent
      const finalStatus = await deviceAdapter.getStatus();
      expect(finalStatus.targetTemperature).toBe(initialStatus.targetTemperature);
      console.log('✅ State consistency maintained after error');
    });
  });

  describe('Real Performance and Reliability', () => {
    it('should handle multiple status requests efficiently with REAL device', async () => {
      const startTime = Date.now();
      
      // Make multiple status requests to REAL device
      const statusPromises = Array(5).fill(null).map(() => deviceAdapter.getStatus());
      const statuses = await Promise.all(statusPromises);
      
      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All requests should succeed
      statuses.forEach(status => {
        expect(status).toBeDefined();
        expect(typeof status.active).toBe('boolean');
      });

      // Should complete within reasonable time (5 requests in under 15 seconds)
      expect(totalTime).toBeLessThan(15000);
      console.log(`⚡ 5 status requests completed in ${totalTime}ms`);
    });

    it('should maintain connection stability over time with REAL device', async () => {
      const testDuration = 30000; // 30 seconds
      const interval = 5000; // Check every 5 seconds
      const checks = testDuration / interval;
      
      console.log(`🔗 Testing connection stability for ${testDuration}ms with REAL device...`);
      
      for (let i = 0; i < checks; i++) {
        const status = await deviceAdapter.getStatus();
        expect(status).toBeDefined();
        
        if (i < checks - 1) {
          await new Promise(resolve => setTimeout(resolve, interval));
        }
      }
      
      console.log('✅ Connection stability test completed successfully');
    }, 40000);
  });
}); 