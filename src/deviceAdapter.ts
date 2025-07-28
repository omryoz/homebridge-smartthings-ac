import { ComponentStatus, Device, DeviceStatus, SmartThingsClient, BearerTokenAuthenticator } from '@smartthings/core-sdk';
import { Logger } from 'homebridge';
import { PlatformStatusInfo } from './platformStatusInfo';
import { SmartThingsPlatform } from './platform';

// SmartThings API best practices constants
const SMARTTHINGS_API_CONSTANTS = {
  // Command execution timeouts
  COMMAND_TIMEOUT: 10000, // 10 seconds
  STATUS_REFRESH_INTERVAL: 5000, // 5 seconds
  
  // Retry configuration
  MAX_RETRIES: 3,
  RETRY_DELAY: 1000, // 1 second
  
  // Rate limiting
  MIN_COMMAND_INTERVAL: 1000, // 1 second between commands
  
  // State synchronization
  STATE_SYNC_DELAY: 500, // 500ms delay after commands to sync state
  COMMAND_DEDUPLICATION_WINDOW: 2000, // 2 seconds to deduplicate similar commands
};

export class DeviceAdapter {
  private lastCommandTime: number = 0;
  private isExecutingCommand: boolean = false;
  private lastCommand: { command: string; capability: string; timestamp: number } | null = null;
  private lastStatusUpdate: number = 0;
  private cachedStatus: PlatformStatusInfo | null = null;

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
    const now = Date.now();
    
    // Use cached status if it's recent enough
    if (this.cachedStatus && (now - this.lastStatusUpdate) < SMARTTHINGS_API_CONSTANTS.STATUS_REFRESH_INTERVAL) {
      this.log.debug('Using cached device status');
      return this.cachedStatus;
    }

    try {
      const mainComponent = await this.getMainComponent();
      
      this.cachedStatus = {
        mode: mainComponent?.['airConditionerMode']?.['airConditionerMode']?.['value'] as string,
        targetTemperature: mainComponent?.['thermostatCoolingSetpoint']?.['coolingSetpoint']?.['value'] as number,
        currentTemperature: mainComponent?.['temperatureMeasurement']?.['temperature']?.['value'] as number,
        currentHumidity: mainComponent?.['relativeHumidityMeasurement']?.['humidity']?.['value'] as number,
        active: mainComponent?.['switch']?.['switch']?.['value'] === 'on',
      };
      
      this.lastStatusUpdate = now;
      this.log.debug('Device status updated:', this.cachedStatus);
      
      return this.cachedStatus;
    } catch (error) {
      this.log.error('Failed to get device status:', error);
      
      // Return cached status if available, otherwise throw
      if (this.cachedStatus) {
        this.log.warn('Using cached status due to error');
        return this.cachedStatus;
      }
      throw error;
    }
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
   * Execute device command with SmartThings API best practices
   * Follows SmartThings API documentation for proper command execution
   */
  public async executeMainCommand(command: string, capability: string, commandArguments?: (string | number)[]) {
    if (!this.device.deviceId) {
      throw Error('Device ID must be set');
    }

    this.log.debug('🔥 executeMainCommand called:', capability, command, commandArguments);

    // Prevent concurrent command execution
    if (this.isExecutingCommand) {
      this.log.warn('Command already in progress, skipping');
      return;
    }

    // Command deduplication - skip if same command was sent recently
    const now = Date.now();
    if (this.lastCommand && 
        this.lastCommand.command === command && 
        this.lastCommand.capability === capability &&
        (now - this.lastCommand.timestamp) < SMARTTHINGS_API_CONSTANTS.COMMAND_DEDUPLICATION_WINDOW) {
      this.log.debug(`Duplicate command detected: ${command} on ${capability}, skipping`);
      return;
    }

    this.isExecutingCommand = true;

    try {
      // Rate limiting - ensure minimum interval between commands
      const timeSinceLastCommand = now - this.lastCommandTime;
      if (timeSinceLastCommand < SMARTTHINGS_API_CONSTANTS.MIN_COMMAND_INTERVAL) {
        const delay = SMARTTHINGS_API_CONSTANTS.MIN_COMMAND_INTERVAL - timeSinceLastCommand;
        this.log.debug(`Rate limiting: waiting ${delay}ms before command`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // For switch commands, check current state to avoid 409 conflicts
      if (capability === 'switch' && (command === 'on' || command === 'off')) {
        await this.handleSwitchCommand(command);
        return;
      }

      // Execute command with retry logic
      await this.executeCommandWithRetry(command, capability, commandArguments);
      
      // Force fresh status update after command
      this.forceStatusRefresh();
      
    } finally {
      this.isExecutingCommand = false;
      this.lastCommandTime = Date.now();
      this.lastCommand = { command, capability, timestamp: now };
    }
  }

  /**
   * Force a fresh status update by invalidating cache
   */
  private forceStatusRefresh() {
    this.log.debug('Forcing fresh status update');
    this.cachedStatus = null;
    this.lastStatusUpdate = 0;
  }

  /**
   * Handle switch commands with state validation
   * Follows SmartThings API best practices for switch control
   */
  private async handleSwitchCommand(command: string): Promise<void> {
    try {
      // Get current device status before sending command
      const currentStatus = await this.getStatus();
      const isCurrentlyOn = currentStatus.active;
      const wantsToTurnOn = command === 'on';
      
      // If device is already in desired state, skip command to avoid 409
      if (isCurrentlyOn === wantsToTurnOn) {
        this.log.debug(`Device is already ${isCurrentlyOn ? 'on' : 'off'}, skipping ${command} command`);
        return;
      }
    } catch (statusError) {
      this.log.debug('Could not check current status, proceeding with command:', statusError);
      // Continue with the command even if we can't check status
    }

    // Execute the command
    await this.executeCommandWithRetry(command, 'switch');
    
    // Force fresh status update after command
    this.forceStatusRefresh();
    
    // Add delay after command to allow device state to sync
    setTimeout(() => {
      this.forceStatusRefresh(); // Invalidate cache to force fresh status
    }, SMARTTHINGS_API_CONSTANTS.STATE_SYNC_DELAY);
  }

  /**
   * Execute command with retry logic and proper error handling
   * Follows SmartThings API best practices for command execution
   */
  private async executeCommandWithRetry(command: string, capability: string, commandArguments?: (string | number)[]): Promise<boolean> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= SMARTTHINGS_API_CONSTANTS.MAX_RETRIES; attempt++) {
      try {
        this.log.debug(`Executing command (attempt ${attempt}/${SMARTTHINGS_API_CONSTANTS.MAX_RETRIES}):`, capability, command);

        const client = await this.getClient();
        
        const deviceId = this.device.deviceId;
        if (!deviceId) {
          throw new Error('Device ID is not set');
        }
        
        const status = await client.devices.executeCommand(deviceId, {
          component: 'main',
          command: command,
          capability: capability,
          arguments: commandArguments,
        });

        this.log.debug('Command executed with status', status.status);
        if (status.status !== 'success') {
          throw Error('Command failed with status ' + status.status);
        }
        
        this.log.debug('Command executed successfully');
        return true; // Command was actually executed
        
      } catch (error) {
        lastError = error as Error;
        
        // Handle 409 Conflict - device state conflict
        if (error && typeof error === 'object' && 'response' in error) {
          const axiosError = error as { response?: { status: number; data?: unknown } };
          if (axiosError.response?.status === 409) {
            this.log.warn('Device state conflict detected for', command, 'command on', capability, '. Command may have been applied despite the error.');
            
            // Log additional conflict details if available
            if (axiosError.response.data) {
              this.log.debug('Conflict details:', JSON.stringify(axiosError.response.data));
            }
            
            // Log the specific command that caused the conflict
            this.log.debug('Command that caused conflict:', `deviceId=${this.device.deviceId}, command=${command}, capability=${capability}, status=409`);
            
            // Return false to indicate command was not actually executed
            return false;
          }
        }
        
        // For other errors, retry with exponential backoff
        if (attempt < SMARTTHINGS_API_CONSTANTS.MAX_RETRIES) {
          const delay = SMARTTHINGS_API_CONSTANTS.RETRY_DELAY * Math.pow(2, attempt - 1);
          this.log.warn(`Command failed (attempt ${attempt}/${SMARTTHINGS_API_CONSTANTS.MAX_RETRIES}), retrying in ${delay}ms:`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // All retries failed
    this.log.error(`Command failed after ${SMARTTHINGS_API_CONSTANTS.MAX_RETRIES} attempts:`, lastError);
    throw lastError || new Error('Command execution failed');
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