export interface IntegrationTestConfig {
  // Authentication
  auth: {
    clientId: string;
    clientSecret: string;
    redirectUri?: string;
  } | {
    token: string;
  };
  
  // Device under test
  device: {
    deviceId: string;
    capabilities: string[];
    expectedCapabilities: string[];
    manufacturerName?: string;
    name?: string;
    label?: string;
  };
  
  // Test parameters
  testParams: {
    minTemperature: number;
    maxTemperature: number;
    updateInterval: number;
  };
  
  // Test environment
  environment: {
    homebridgePath: string;
    networkAccess: boolean;
    nodeVersion: string;
  };
}

export interface MockDeviceStatus {
  mode: string;
  active: boolean;
  currentTemperature: number;
  targetTemperature: number;
  currentHumidity?: number;
}

export interface MockSmartThingsResponse {
  deviceId: string;
  components: {
    main: {
      switch: { switch: { value: string } };
      temperatureMeasurement: { temperature: { value: number } };
      thermostatCoolingSetpoint: { coolingSetpoint: { value: number } };
      airConditionerMode: { airConditionerMode: { value: string } };
      relativeHumidityMeasurement?: { humidity: { value: number } };
    };
  };
}

export interface TestScenario {
  name: string;
  description: string;
  setup: () => Promise<void>;
  execute: () => Promise<void>;
  verify: () => Promise<void>;
  cleanup: () => Promise<void>;
} 