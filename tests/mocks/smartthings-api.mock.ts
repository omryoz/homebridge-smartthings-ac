import nock from 'nock';
import { MockSmartThingsResponse, MockDeviceStatus } from '../types/test-config';

export class SmartThingsAPIMock {
  private baseUrl = 'https://api.smartthings.com';
  public scope: nock.Scope;

  constructor() {
    this.scope = nock(this.baseUrl);
  }

  // Mock OAuth endpoints
  mockOAuthToken(accessToken: string = 'mock-access-token', refreshToken: string = 'mock-refresh-token') {
    return this.scope
      .post('/oauth/token')
      .reply(200, {
        access_token: accessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 3600
      });
  }

  mockOAuthRefresh(refreshToken: string, newAccessToken: string = 'new-mock-access-token') {
    return this.scope
      .post('/oauth/token')
      .reply(200, {
        access_token: newAccessToken,
        refresh_token: refreshToken,
        token_type: 'Bearer',
        expires_in: 3600
      });
  }

  // Mock device endpoints
  mockGetDevice(deviceId: string, deviceData: MockSmartThingsResponse) {
    return this.scope
      .get(`/v1/devices/${deviceId}`)
      .reply(200, deviceData);
  }

  mockGetDeviceStatus(deviceId: string, statusData: MockSmartThingsResponse) {
    return this.scope
      .get(`/v1/devices/${deviceId}/status`)
      .reply(200, statusData);
  }

  mockExecuteCommand(deviceId: string, capability: string, command: string, success: boolean = true) {
    const response = success ? { status: 'success' } : { status: 'failed' };
    return this.scope
      .post(`/v1/devices/${deviceId}/commands`)
      .reply(success ? 200 : 400, response);
  }

  // Mock error responses
  mockAuthenticationError() {
    return this.scope
      .post('/oauth/token')
      .reply(401, { error: 'invalid_client' });
  }

  mockDeviceNotFound(deviceId: string) {
    return this.scope
      .get(`/v1/devices/${deviceId}`)
      .reply(404, { error: 'Device not found' });
  }

  mockConflictError(deviceId: string) {
    return this.scope
      .post(`/v1/devices/${deviceId}/commands`)
      .reply(409, { error: 'Device already in requested state' });
  }

  mockServerError() {
    return this.scope
      .get('/v1/devices')
      .reply(500, { error: 'Internal server error' });
  }

  // Helper methods to create realistic device data
  createMockDeviceStatus(
    deviceId: string,
    status: MockDeviceStatus
  ): MockSmartThingsResponse {
    return {
      deviceId,
      components: {
        main: {
          switch: { switch: { value: status.active ? 'on' : 'off' } },
          temperatureMeasurement: { temperature: { value: status.currentTemperature } },
          thermostatCoolingSetpoint: { coolingSetpoint: { value: status.targetTemperature } },
          airConditionerMode: { airConditionerMode: { value: status.mode } },
          ...(status.currentHumidity !== undefined && {
            relativeHumidityMeasurement: { humidity: { value: status.currentHumidity } }
          })
        }
      }
    };
  }

  // Mock device list
  mockGetDevices(devices: Array<{ deviceId: string; name: string; capabilities: string[] }>) {
    const deviceList = devices.map(device => ({
      deviceId: device.deviceId,
      name: device.name,
      label: device.name,
      manufacturerName: 'Samsung',
      presentationId: device.deviceId,
      capabilities: device.capabilities.map(cap => ({ id: cap }))
    }));

    return this.scope
      .get('/v1/devices')
      .reply(200, { items: deviceList });
  }

  // Cleanup
  cleanup() {
    this.scope.persist(false);
  }
} 