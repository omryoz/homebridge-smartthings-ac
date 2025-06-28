# Homebridge SmartThings AC

A Homebridge plugin to control your Samsung SmartThings Air Conditioner.

<img src="assets/homekit_ac.png" width="300">

## ⚠️ Important: Token Expiration Notice

**SmartThings Personal Access Tokens expire after 24 hours.** This plugin now supports OAuth authentication which automatically handles token refresh, eliminating the need for manual token renewal.

## Installation

```
npm install -g homebridge-smartthings-ac
```

## Compatibility

This plugin is compatible with Homebridge 1.3.0 and newer, including Homebridge 1.10.0.

### Important Note for Homebridge 1.10+

If you're using Homebridge 1.10 or newer, please use version 1.0.11 or newer of this plugin. 
Earlier versions may throw errors related to missing modules.

## Credits

This plugin was originally created by [0x4a616e](https://github.com/0x4a616e).

Homebridge 1.10 compatibility update and OAuth implementation by [Omry Oz](https://github.com/omryoz).

## Support This Plugin

If you find this plugin helpful, consider supporting its development:

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://coff.ee/omryoz)

[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.me/omryoz)

<!-- You can customize the donation links above with your actual donation links -->

## Setup

### Option 1: OAuth Authentication (Recommended)

OAuth authentication automatically handles token refresh and provides a more secure, long-term solution.

#### 1. Create a SmartThings SmartApp

1. Install the SmartThings CLI:
   ```bash
   npm install -g @smartthings/cli
   ```

2. Create a new SmartApp:
   ```bash
   smartthings apps:create
   ```

3. Follow the interactive prompts:
   - **Display Name**: `Homebridge SmartThings AC`
   - **Description**: `Homebridge plugin for SmartThings Air Conditioner control`
   - **Target URL**: Leave blank (just press Enter)
   - **Permissions**: Select these device permissions:
     - `r:devices:*` (Read/See all devices)
     - `w:devices:*` (Write/Control all devices)
   - **Redirect URIs**: `http://localhost:3000/oauth/callback`

4. **Save your credentials!** The CLI will output something like:
   ```
   ✅  App created successfully
   App ID: 12345678-1234-1234-1234-123456789012
   Client ID: abcdef12-3456-7890-abcd-ef1234567890
   Client Secret: xyz789-def0-1234-5678-9abcdef01234
   ```

**Note**: If you encounter authentication issues with the CLI, you can also create a SmartApp directly through the SmartThings Developer Console at https://developer.smartthings.com/

#### 2. Configure the Plugin

Use your `clientId` and `clientSecret` in your Homebridge config.json:

```json
{
  "platforms": [
    {
      "platform": "SmartThingsAirConditioner",
      "name": "SmartThings Air Conditioner",
      "clientId": "YOUR-CLIENT-ID",
      "clientSecret": "YOUR-CLIENT-SECRET",
      "redirectUri": "http://localhost:3000/oauth/callback",
      "updateInterval": 15,
      "minTemperature": 16,
      "maxTemperature": 30
    }
  ]
}
```

#### 3. Complete OAuth Authorization

1. Restart Homebridge
2. Check the logs for the authorization URL (it will look like: `https://auth-global.api.smartthings.com/oauth/authorize?...`)
3. Visit the URL in your browser
4. Log in to SmartThings and authorize the app
5. You'll be redirected back to `http://localhost:3000/oauth/callback` and the plugin will automatically save the tokens
6. The plugin will now work with automatic token refresh

### Option 2: Personal Access Token (Legacy)

**Note: This method requires manual token renewal every 24 hours.**

1. Create a [SmartThings Personal Access Token](https://account.smartthings.com/tokens) with the following scopes:
   - List all devices
   - See all devices
   - Control all devices

2. Configure the plugin:

```json
{
  "platforms": [
    {
      "platform": "SmartThingsAirConditioner",
      "name": "SmartThings Air Conditioner",
      "token": "YOUR-SMARTTHINGS-TOKEN",
      "updateInterval": 15,
      "minTemperature": 16,
      "maxTemperature": 30
    }
  ]
}
```

### Configuration options

- `clientId` & `clientSecret`: OAuth credentials (recommended)
- `token`: Personal Access Token (legacy, expires every 24 hours)
- `redirectUri`: OAuth callback URL (default: http://localhost:3000/oauth/callback)
- `updateInterval`: Status update interval in seconds (default: 15)
- `minTemperature`: Minimum temperature allowed (default: 16)
- `maxTemperature`: Maximum temperature allowed (default: 30)

## Troubleshooting

If you encounter issues:

1. **401 Unauthorized Error (OAuth)**: The plugin will automatically attempt to refresh the token. If it fails, restart Homebridge to trigger a new authorization flow.
2. **401 Unauthorized Error (Legacy Token)**: Your token has expired. Generate a new token and update your config.
3. Make sure your SmartThings token has the correct permissions
4. Verify your AC device has the required capabilities (switch, temperatureMeasurement, thermostatCoolingSetpoint, airConditionerMode)
5. Check the Homebridge logs for detailed error messages

### OAuth Troubleshooting

- **Authorization fails**: Make sure your redirect URI matches exactly what you configured in the SmartApp
- **Token refresh fails**: Restart Homebridge to trigger a new authorization flow
- **Port conflicts**: If port 3000 is in use, the plugin will show an error. Ensure the port is available.

#### Token Expiration and Reauthorization Issues

If you're experiencing frequent token expiration or reauthorization requests, check the following:

1. **Check Token Storage Location**:
   ```bash
   # Common token storage locations
   ls -la ~/.homebridge/smartthings-oauth-tokens.json
   ls -la /home/homebridge/.homebridge/smartthings-oauth-tokens.json
   ls -la /var/lib/homebridge/smartthings-oauth-tokens.json
   ```

2. **Verify Token File Permissions**:
   ```bash
   # Ensure Homebridge can read/write the token file
   sudo chown homebridge:homebridge ~/.homebridge/smartthings-oauth-tokens.json
   sudo chmod 600 ~/.homebridge/smartthings-oauth-tokens.json
   ```

3. **Check Token Expiry in Logs**:
   Look for these log messages:
   ```
   📊 Token status: expires at [timestamp], [X] minutes remaining
   🔄 Token expires soon, refreshing...
   ✅ Token refreshed successfully
   ```

4. **Common Causes of Token Issues**:
   - **Homebridge restarts**: Tokens are automatically refreshed on restart
   - **System time changes**: Ensure your system clock is accurate
   - **Network connectivity**: Temporary network issues can cause refresh failures
   - **SmartThings API changes**: Samsung may update their OAuth endpoints

5. **Force Reauthorization**:
   If tokens are consistently failing, you can force a new authorization:
   ```bash
   # Remove existing tokens
   rm ~/.homebridge/smartthings-oauth-tokens.json
   
   # Restart Homebridge
   sudo hb-service restart
   ```

6. **Debug Token Flow**:
   Enable debug logging in your Homebridge config:
   ```json
   {
     "bridge": {
       "name": "Homebridge",
       "username": "CC:22:3D:E3:CE:30",
       "port": 51826,
       "pin": "031-45-154"
     },
     "accessories": [],
     "platforms": [
       {
         "platform": "SmartThingsAirConditioner",
         "name": "SmartThings Air Conditioner",
         "clientId": "YOUR-CLIENT-ID",
         "clientSecret": "YOUR-CLIENT-SECRET",
         "debug": true
       }
     ]
   }
   ```

7. **Check SmartThings App Configuration**:
   - Verify your SmartApp is still active in the SmartThings Developer Console
   - Ensure the redirect URI matches exactly: `http://localhost:3000/oauth/callback`
   - Check that the required permissions are still granted

8. **Token Refresh Scheduler**:
   The plugin automatically refreshes tokens every 30 minutes. If you see frequent reauthorization requests, check:
   - System resources (CPU, memory)
   - Network connectivity to SmartThings API
   - Homebridge log for scheduler errors

#### Advanced Troubleshooting

If you continue to experience issues, you can:

1. **Check SmartThings API Status**: Visit https://status.smartthings.com/
2. **Verify OAuth Scope**: Ensure your SmartApp has the correct permissions
3. **Test API Connectivity**:
   ```bash
   curl -H "Authorization: Bearer YOUR-ACCESS-TOKEN" \
        https://api.smartthings.com/v1/devices
   ```
4. **Monitor Network Traffic**: Use tools like Wireshark to check for network issues

### Legacy Token Renewal Process

When you see "401 Authorization Required" errors:

1. Go to https://account.smartthings.com/tokens
2. Generate a new Personal Access Token with the required scopes
3. Update the `token` field in your Homebridge config.json
4. Restart Homebridge: `sudo hb-service restart`

### Installation Errors

If you encounter installation errors with Homebridge 1.10+, try installing with:

```
sudo npm install -g homebridge-smartthings-ac --unsafe-perm
```

Or if you're using hb-service:

```
sudo hb-service add homebridge-smartthings-ac --unsafe-perm
```

## Development

### Install Development Dependencies

Using a terminal, navigate to the project folder and run this command to install the development dependencies:

```
npm install
```

### Build Plugin

TypeScript needs to be compiled into JavaScript before it can run. The following command will compile the contents of your [`src`](./src) directory and put the resulting code into the `dist` folder.

```
npm run build
```

### Link To Homebridge

Run this command so your global install of Homebridge can discover the plugin in your development environment:

```
npm link
```

You can now start Homebridge, use the `-D` flag so you can see debug log messages in your plugin:

```
homebridge -D
```

### Watch For Changes and Build Automatically

If you want to have your code compile automatically as you make changes, and restart Homebridge automatically between changes you can run:

```
npm run watch
```

This will launch an instance of Homebridge in debug mode which will restart every time you make a change to the source code.

## License

Apache-2.0
