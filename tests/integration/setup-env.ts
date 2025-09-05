#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

interface EnvironmentConfig {
  SMARTTHINGS_CLIENT_ID: string;
  SMARTTHINGS_CLIENT_SECRET: string;
  SMARTTHINGS_REDIRECT_URI: string;
  SMARTTHINGS_DEVICE_ID: string;
  HOMEBRIDGE_PATH: string;
  TEST_MIN_TEMP: string;
  TEST_MAX_TEMP: string;
}

class EnvironmentSetup {
  private rl: readline.Interface;
  private envPath: string;
  private config: Partial<EnvironmentConfig> = {};

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.envPath = path.join(process.cwd(), '.env');
  }

  async run(): Promise<void> {
    console.log('🔧 Setting up SmartThings Integration Test Environment');
    console.log('==================================================');

    // Load existing .env file if it exists
    await this.loadExistingEnv();

    console.log('');
    console.log('🔐 SmartThings OAuth Configuration');
    console.log('----------------------------------');

    // OAuth Configuration
    this.config.SMARTTHINGS_CLIENT_ID = await this.promptWithDefault(
      'Enter your SmartThings OAuth Client ID',
      '',
      'SMARTTHINGS_CLIENT_ID',
    );

    this.config.SMARTTHINGS_CLIENT_SECRET = await this.promptWithDefault(
      'Enter your SmartThings OAuth Client Secret',
      '',
      'SMARTTHINGS_CLIENT_SECRET',
    );

    this.config.SMARTTHINGS_REDIRECT_URI = await this.promptWithDefault(
      'Enter OAuth Redirect URI',
      'https://localhost:3000/oauth/callback',
      'SMARTTHINGS_REDIRECT_URI',
    );

    console.log('');
    console.log('📱 Device Configuration');
    console.log('----------------------');

    // Device Configuration
    this.config.SMARTTHINGS_DEVICE_ID = await this.promptWithDefault(
      'Enter your AC device ID from SmartThings',
      '',
      'SMARTTHINGS_DEVICE_ID',
    );

    console.log('');
    console.log('🔧 Optional Configuration');
    console.log('------------------------');

    // Optional Configuration
    this.config.HOMEBRIDGE_PATH = await this.promptWithDefault(
      'Enter Homebridge installation path',
      '/usr/local/lib/node_modules/homebridge',
      'HOMEBRIDGE_PATH',
    );

    this.config.TEST_MIN_TEMP = await this.promptWithDefault(
      'Enter minimum temperature for testing',
      '16',
      'TEST_MIN_TEMP',
    );

    this.config.TEST_MAX_TEMP = await this.promptWithDefault(
      'Enter maximum temperature for testing',
      '30',
      'TEST_MAX_TEMP',
    );

    // Save configuration
    await this.saveConfiguration();

    // Display summary
    this.displaySummary();

    this.rl.close();
  }

  private async loadExistingEnv(): Promise<void> {
    if (fs.existsSync(this.envPath)) {
      console.log('📁 Found existing .env file');
      const envContent = fs.readFileSync(this.envPath, 'utf8');
      const lines = envContent.split('\n');
      
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (key && value) {
          (this.config as any)[key.trim()] = value.trim();
        }
      }
    } else {
      console.log('📁 Creating new .env file');
    }
  }

  private async promptWithDefault(
    prompt: string,
    defaultValue: string,
    envVar: keyof EnvironmentConfig,
  ): Promise<string> {
    const currentValue = this.config[envVar];
    
    if (currentValue) {
      console.log(`✅ ${envVar} already set`);
      return currentValue;
    }

    return new Promise((resolve) => {
      this.rl.question(`${prompt} [${defaultValue}]: `, (input) => {
        const value = input.trim() || defaultValue;
        this.config[envVar] = value as any;
        resolve(value);
      });
    });
  }

  private async saveConfiguration(): Promise<void> {
    const envContent = Object.entries(this.config)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    fs.writeFileSync(this.envPath, envContent);
    console.log('💾 Configuration saved to .env file');
  }

  private displaySummary(): void {
    console.log('');
    console.log('📋 Environment Summary');
    console.log('=====================');

    Object.entries(this.config).forEach(([key, value]) => {
      const displayValue = value || 'Not set';
      console.log(`${key}: ${displayValue}`);
    });

    console.log('');
    console.log('🚀 Next Steps');
    console.log('=============');
    console.log('1. Make sure your SmartThings device is online and accessible');
    console.log('2. Run: npm run test:integration');
    console.log('3. Or run specific test: npm test -- ac-control.integration.test.ts');
    console.log('');
    console.log('⚠️  Important Notes:');
    console.log('- Tests will actually control your AC device');
    console.log('- Device will be turned off after tests complete');
    console.log('- Ensure your AC is in a safe state before running tests');
    console.log('- Tests may take several minutes to complete');
  }
}

// Run the setup if this file is executed directly
if (require.main === module) {
  const setup = new EnvironmentSetup();
  setup.run().catch(console.error);
}

export { EnvironmentSetup, EnvironmentConfig }; 