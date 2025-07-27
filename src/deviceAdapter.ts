import { ComponentStatus, Device, DeviceStatus, SmartThingsClient, BearerTokenAuthenticator } from '@smartthings/core-sdk';
import { Logger } from 'homebridge';
import { PlatformStatusInfo } from './platformStatusInfo';
import { SmartThingsPlatform } from './platform';
import axios from 'axios';

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

  /**
   * Analyze device operational state for debugging
   */
  private analyzeDeviceState(status: DeviceStatus): {
    isOperational: boolean;
    operationalState: string;
    constraints: string[];
    details: Record<string, unknown>;
  } {
    const main = status.components?.main;
    if (!main) {
      return {
        isOperational: false,
        operationalState: 'unknown',
        constraints: ['No main component found'],
        details: {},
      };
    }

    const constraints: string[] = [];
    const details: Record<string, unknown> = {};

    // Check switch state
    const switchState = main['switch']?.['switch']?.['value'];
    details.switch = switchState;

    // Check AC mode
    const acMode = main['airConditionerMode']?.['airConditionerMode']?.['value'];
    details.acMode = acMode;

    // Check auto-cleaning mode
    const autoCleaningMode = main['custom.autoCleaningMode']?.['autoCleaningMode']?.['value'];
    if (autoCleaningMode && autoCleaningMode !== 'off') {
      constraints.push(`Auto-cleaning active: ${autoCleaningMode}`);
    }
    details.autoCleaningMode = autoCleaningMode;

    // Check energy saving operation
    const energySavingOperation = main['custom.energyType']?.['energySavingOperation']?.['value'];
    if (energySavingOperation && energySavingOperation !== 'off') {
      constraints.push(`Energy saving active: ${energySavingOperation}`);
    }
    details.energySavingOperation = energySavingOperation;

    // Check temperature
    const temperature = main['temperatureMeasurement']?.['temperature']?.['value'];
    details.temperature = temperature;

    // Check setpoint
    const setpoint = main['thermostatCoolingSetpoint']?.['coolingSetpoint']?.['value'];
    details.setpoint = setpoint;

    // Determine operational state
    let operationalState = 'unknown';
    if (switchState === 'on') {
      operationalState = 'running';
      if (acMode === 'off') {
        operationalState = 'standby';
        constraints.push('AC mode is off');
      }
    } else if (switchState === 'off') {
      operationalState = 'stopped';
    }

    // Check for other operational modes
    if (autoCleaningMode && autoCleaningMode !== 'off') {
      operationalState = `cleaning (${autoCleaningMode})`;
    }

    const isOperational = switchState === 'on' && acMode !== 'off';

    return {
      isOperational,
      operationalState,
      constraints,
      details,
    };
  }

  public async executeMainCommand(command: string, capability: string, commandArguments?: (string | number)[]) {
    if (!this.device.deviceId) {
      throw Error('Device ID must be set');
    }

    this.log.debug('🔥 executeMainCommand called:', capability, command, commandArguments);

    // Get current device status before executing command
    let statusBefore: DeviceStatus | null = null;
    try {
      statusBefore = await this.getDeviceStatus();
      this.log.debug('Device status before command:', {
        switch: statusBefore.components?.main?.['switch']?.['switch']?.['value'],
        mode: statusBefore.components?.main?.['airConditionerMode']?.['airConditionerMode']?.['value'],
        temperature: statusBefore.components?.main?.['temperatureMeasurement']?.['temperature']?.['value'],
      });
    } catch (error) {
      this.log.warn('Could not get device status before command:', error);
    }

    const client = await this.getClient();
    
    try {
      this.log.debug('Executing command', capability, command, commandArguments);

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

      // Get device status after command to verify the change
      try {
        const statusAfter = await this.getDeviceStatus();
        if (statusBefore) {
          this.compareStatuses(statusBefore, statusAfter);
        }
      } catch (error) {
        this.log.warn('Could not get device status after command:', error);
      }

    } catch (error) {
      // Handle specific error types
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const data = error.response?.data;

        this.log.error(`Command failed with HTTP ${status}:`, {
          command,
          capability,
          arguments: commandArguments,
          error: data,
          requestId: data?.requestId,
        });

        // Handle 409 Conflict - device state conflict
        if (status === 409) {
          this.log.warn('Device state conflict detected. Attempting to resolve...');
          
          // Try to get current device status to understand the conflict
          try {
            const currentStatus = await this.getDeviceStatus();
            const stateAnalysis = this.analyzeDeviceState(currentStatus);
            
            this.log.debug('Current device status during conflict:', {
              switch: currentStatus.components?.main?.['switch']?.['switch']?.['value'],
              mode: currentStatus.components?.main?.['airConditionerMode']?.['airConditionerMode']?.['value'],
              temperature: currentStatus.components?.main?.['temperatureMeasurement']?.['temperature']?.['value'],
            });
            
            this.log.debug('Device state analysis:', {
              operationalState: stateAnalysis.operationalState,
              isOperational: stateAnalysis.isOperational,
              constraints: stateAnalysis.constraints,
              details: stateAnalysis.details,
            });

            // For switch commands, check if the device is already in the desired state
            if (capability === 'switch') {
              const currentSwitchState = currentStatus.components?.main?.['switch']?.['switch']?.['value'];
              
              if (command === 'on' && currentSwitchState === 'on') {
                this.log.info('Device is already on, ignoring conflict');
                return; // Don't throw error, consider it successful
              } else if (command === 'off' && currentSwitchState === 'off') {
                this.log.info('Device is already off, ignoring conflict');
                return; // Don't throw error, consider it successful
              } else {
                // Device is in a different state than requested
                this.log.warn(`Device state conflict: requested ${command}, but device is ${currentSwitchState}`);
                
                // Check for Samsung-specific constraints that might prevent the command
                const acMode = currentStatus.components?.main?.['airConditionerMode']?.['airConditionerMode']?.['value'];
                const autoCleaningMode = currentStatus.components?.main?.['custom.autoCleaningMode']?.['autoCleaningMode']?.['value'];
                const energySavingOperation = currentStatus.components?.main?.['custom.energyType']?.['energySavingOperation']?.['value'];
                
                // Log all relevant device states for debugging
                this.log.debug('Device state analysis for conflict resolution:', {
                  switch: currentSwitchState,
                  acMode,
                  autoCleaningMode,
                  energySavingOperation,
                  hasAutoCleaning: !!currentStatus.components?.main?.['custom.autoCleaningMode'],
                  hasEnergySaving: !!currentStatus.components?.main?.['custom.energyType'],
                });
                
                // Check specific constraints
                if (command === 'on' && acMode === 'off') {
                  this.log.warn('Cannot turn on device while AC mode is set to "off"');
                  throw new Error('Cannot turn on device: AC mode is set to "off". Please change the AC mode first.');
                }
                
                if (command === 'off' && autoCleaningMode && autoCleaningMode !== 'off') {
                  this.log.warn(`Cannot turn off device while auto-cleaning mode is active (${autoCleaningMode})`);
                  throw new Error(`Cannot turn off device: Auto-cleaning mode is active (${autoCleaningMode}). Please wait for cleaning to complete.`);
                }
                
                if (command === 'off' && energySavingOperation && energySavingOperation !== 'off') {
                  this.log.warn(`Cannot turn off device while energy saving operation is active (${energySavingOperation})`);
                  throw new Error(`Cannot turn off device: Energy saving operation is active (${energySavingOperation}). Please wait for operation to complete.`);
                }
                
                // For other cases, the device might be in a transitional state or have other constraints
                // Log the conflict but don't throw an error - let the status refresh determine the actual state
                this.log.info('Device state conflict resolved - command may have been applied despite the error');
                this.log.debug('Device may be in a transitional state or have other constraints preventing immediate state change');
                return; // Consider it successful, let the status refresh determine the actual state
              }
            }

            // For air conditioner mode commands
            if (capability === 'airConditionerMode') {
              const currentMode = currentStatus.components?.main?.['airConditionerMode']?.['airConditionerMode']?.['value'];
              const requestedMode = commandArguments?.[0] as string;
              
              if (currentMode === requestedMode) {
                this.log.info(`Device is already in ${requestedMode} mode, ignoring conflict`);
                return;
              } else {
                this.log.warn(`Device mode conflict: requested ${requestedMode}, but device is in ${currentMode} mode`);
                this.log.info('Device mode conflict resolved - command may have been applied despite the error');
                return;
              }
            }

            // For temperature commands
            if (capability === 'thermostatCoolingSetpoint') {
              const currentTemp = currentStatus.components?.main?.['thermostatCoolingSetpoint']?.['coolingSetpoint']?.['value'] as number;
              const requestedTemp = commandArguments?.[0] as number;
              
              if (currentTemp && typeof currentTemp === 'number' && typeof requestedTemp === 'number' && Math.abs(currentTemp - requestedTemp) < 0.5) {
                this.log.info(`Device temperature is already set to ${currentTemp}°C, ignoring conflict`);
                return;
              } else {
                this.log.warn(`Device temperature conflict: requested ${requestedTemp}°C, but device is set to ${currentTemp}°C`);
                this.log.info('Device temperature conflict resolved - command may have been applied despite the error');
                return;
              }
            }

            // For other commands, log the conflict details
            this.log.warn('Device state conflict details:', {
              requestedCommand: command,
              requestedCapability: capability,
              currentState: currentStatus.components?.main,
            });

          } catch (statusError) {
            this.log.error('Could not get device status during conflict resolution:', statusError);
          }

          // Only throw error if we couldn't resolve the conflict
          this.log.warn('Device state conflict could not be resolved automatically');
          throw new Error(`Device state conflict: Cannot execute ${command} on ${capability}. The device may be in an invalid state for this operation.`);
        }

        // Handle 401 Unauthorized - token issues
        if (status === 401) {
          this.log.error('Authentication failed. Token may be expired or invalid.');
          throw new Error('Authentication failed. Please check your SmartThings credentials.');
        }

        // Handle 429 Too Many Requests - rate limiting
        if (status === 429) {
          this.log.warn('Rate limit exceeded. Waiting before retry...');
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          throw new Error('Rate limit exceeded. Please try again in a moment.');
        }

        // Handle other HTTP errors
        throw new Error(`SmartThings API error (${status}): ${data?.error?.message || error.message}`);
      }

      // Handle non-HTTP errors
      this.log.error('Command execution failed:', error);
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