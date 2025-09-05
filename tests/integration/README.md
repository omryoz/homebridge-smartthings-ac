# SmartThings AC Integration Tests

This directory contains **real integration tests** that communicate with actual SmartThings devices to test AC control functionality.

## ⚠️ Important Safety Notice

**These tests will actually control your AC device!** 

- Tests will turn your AC on/off
- Tests will change temperature settings
- Tests will change AC modes
- **Ensure your AC is in a safe state before running tests**
- Tests will attempt to restore the initial state after completion

## 🚀 Quick Start

### 1. Setup Environment

Run the TypeScript setup script to configure your environment:

```bash
# Run the setup script
npm run setup:integration

# Or run directly with ts-node
npx ts-node tests/integration/setup-env.ts
```

This will prompt you for:
- SmartThings OAuth credentials
- Your AC device ID
- Test configuration parameters

### 2. Get Your SmartThings Credentials

#### Option A: OAuth (Recommended)

1. Go to [SmartThings Developer Console](https://smartthings.developer.samsung.com/)
2. Create a new SmartApp
3. Note your **Client ID** and **Client Secret**
4. Set the **Redirect URI** to `https://localhost:3000/oauth/callback`

#### Option B: Personal Access Token (Legacy)

1. Go to [SmartThings Developer Console](https://smartthings.developer.samsung.com/)
2. Generate a Personal Access Token
3. **Note**: This token expires every 24 hours

### 3. Find Your AC Device ID

1. Use the SmartThings API to list your devices:
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.smartthings.com/v1/devices"
```

2. Look for your AC device and note the `deviceId`

### 4. Run Integration Tests

```bash
# Run all integration tests
npm run test:integration

# Run specific test file
npm test -- ac-control.integration.test.ts

# Run with verbose output
npm test -- ac-control.integration.test.ts --verbose
```

## 📋 Required Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SMARTTHINGS_CLIENT_ID` | OAuth Client ID | Yes |
| `SMARTTHINGS_CLIENT_SECRET` | OAuth Client Secret | Yes |
| `SMARTTHINGS_DEVICE_ID` | Your AC device ID | Yes |
| `SMARTTHINGS_REDIRECT_URI` | OAuth callback URL | No (defaults to localhost) |
| `HOMEBRIDGE_PATH` | Homebridge installation path | No |
| `TEST_MIN_TEMP` | Minimum test temperature | No (defaults to 16°C) |
| `TEST_MAX_TEMP` | Maximum test temperature | No (defaults to 30°C) |

## 🧪 Test Scenarios

### Device Discovery and Status
- ✅ Connect to SmartThings API
- ✅ Find test AC device
- ✅ Verify required capabilities
- ✅ Retrieve current device status

### AC Control Operations
- ✅ Turn AC on/off
- ✅ Set temperature
- ✅ Change AC modes (auto, cool, heat)
- ✅ Handle rapid command sequences

### Error Handling and Edge Cases
- ✅ Handle invalid device IDs
- ✅ Handle network timeouts
- ✅ Maintain state consistency after errors

### Performance and Reliability
- ✅ Handle multiple status requests efficiently
- ✅ Maintain connection stability over time

## 🔧 Test Configuration

### Device Requirements

Your AC device must support these capabilities:
- `switch` - for on/off control
- `temperatureMeasurement` - for current temperature
- `thermostatCoolingSetpoint` - for temperature control
- `airConditionerMode` - for mode control
- `relativeHumidityMeasurement` - optional, for humidity

### Test Parameters

```typescript
const testConfig = {
  testParams: {
    minTemperature: 16,    // Minimum test temperature
    maxTemperature: 30,    // Maximum test temperature
    updateInterval: 15,    // Status update interval (seconds)
  }
};
```

## 📊 Test Results

Tests will output detailed logs including:
- Device status before and after each operation
- Command execution results
- Error messages and handling
- Performance metrics

Example output:
```
🔧 SmartThings AC Integration Tests
================================

✅ Connected to SmartThings API
✅ Found test AC device: Living Room AC
✅ Device has required capabilities

🧪 Testing AC Control Operations
===============================

📱 Initial device status: { active: false, mode: 'auto', currentTemperature: 24, targetTemperature: 22 }

🔄 Turning AC on...
✅ Command executed successfully
📱 Device status after ON: { active: true, mode: 'auto', currentTemperature: 24, targetTemperature: 22 }

🔄 Setting temperature to 20°C...
✅ Command executed successfully
📱 Device status after temperature change: { active: true, mode: 'auto', currentTemperature: 24, targetTemperature: 20 }

🔄 Turning AC off...
✅ Command executed successfully
📱 Device status after OFF: { active: false, mode: 'auto', currentTemperature: 24, targetTemperature: 20 }

🧹 Restoring initial device state...
✅ Initial state restored successfully

✅ All tests passed!
```

## 🛠️ Troubleshooting

### Common Issues

1. **Authentication Errors**
   ```
   Error: Missing required environment variables: SMARTTHINGS_CLIENT_ID, SMARTTHINGS_CLIENT_SECRET
   ```
   - Ensure all environment variables are set
   - Check your OAuth credentials are correct

2. **Device Not Found**
   ```
   Error: Device test-device-id not found in SmartThings account
   ```
   - Verify your device ID is correct
   - Ensure the device is online and accessible

3. **Network Timeouts**
   ```
   Error: Request timeout after 10000ms
   ```
   - Check your internet connection
   - Verify SmartThings API is accessible

4. **Capability Errors**
   ```
   Error: Device missing required capability: switch
   ```
   - Ensure your AC device supports all required capabilities
   - Check device compatibility in SmartThings

### Debug Mode

Run tests with debug logging:
```bash
DEBUG=* npm test -- ac-control.integration.test.ts
```

### Manual Device Testing

Test your device manually before running integration tests:
```bash
# Test device discovery
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.smartthings.com/v1/devices/YOUR_DEVICE_ID"

# Test device status
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://api.smartthings.com/v1/devices/YOUR_DEVICE_ID/status"
```

## 🔒 Security Notes

- Never commit your `.env` file to version control
- Use OAuth instead of Personal Access Tokens for better security
- Rotate your credentials regularly
- Monitor your SmartThings API usage

## 📈 Performance Benchmarks

Expected performance metrics:
- Device status retrieval: < 2 seconds
- Command execution: < 3 seconds
- State synchronization: < 5 seconds
- Connection stability: 100% uptime during tests

## 🤝 Contributing

When adding new integration tests:
1. Follow the existing test structure
2. Include proper cleanup in `afterEach`/`afterAll`
3. Add comprehensive error handling
4. Document any new environment variables
5. Test with multiple device types if possible 