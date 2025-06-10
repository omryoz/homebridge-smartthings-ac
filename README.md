# Homebridge SmartThings AC

A Homebridge plugin to control your Samsung SmartThings Air Conditioner.

<img src="assets/homekit_ac.png" width="300">

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

Homebridge 1.10 compatibility update by [Omry Oz](https://github.com/omryoz).

## Support This Plugin

If you find this plugin helpful, consider supporting its development:

[![Buy Me A Coffee](https://www.buymeacoffee.com/assets/img/custom_images/orange_img.png)](https://coff.ee/omryoz)

[![PayPal](https://img.shields.io/badge/PayPal-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://www.paypal.com/paypalme/OmryOz)

<!-- You can customize the donation links above with your actual donation links -->

## Setup

1. Create a [SmartThings Personal Access Token](https://account.smartthings.com/tokens) with the following scopes:
   - List all devices
   - See all devices
   - Control all devices

   If everything is set up correctly, the scope of your token should look something like this:
   ```
   MyToken — x:devices:*, l:devices, r:devices:*
   ```

2. Configure the plugin in your Homebridge config.json:

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

- `token`: Your SmartThings Personal Access Token (required)
- `updateInterval`: Status update interval in seconds (default: 15)
- `minTemperature`: Minimum temperature allowed (default: 16)
- `maxTemperature`: Maximum temperature allowed (default: 30)

## Troubleshooting

If you encounter issues:

1. Make sure your SmartThings token has the correct permissions
2. Verify your AC device has the required capabilities (switch, temperatureMeasurement, thermostatCoolingSetpoint, airConditionerMode)
3. Check the Homebridge logs for detailed error messages

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
