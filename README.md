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

3. Follow the prompts:
   - **Display Name**: `Homebridge SmartThings AC`
   - **Description**: `Homebridge plugin for SmartThings Air Conditioner control`
   - **Target URL**: Leave blank for now
   - **Permissions**: Select all device permissions (x:devices:*, r:devices:*, l:devices)
   - **Redirect URIs**: `http://localhost:3000/oauth/callback`

4. Note your `client_id` and `client_secret` from the output.

#### 2. Configure the Plugin

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
2. Check the logs for the authorization URL
3. Visit the URL in your browser
4. Log in to SmartThings and authorize the app
5. You'll be redirected back and the plugin will automatically save the tokens

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
