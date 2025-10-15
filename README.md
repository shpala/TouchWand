# TouchWand WallWand Z-Wave Panel

This repository contains the source code for an unofficial Homey Pro App that adds support for TouchWand WallWand Z-Wave panels. This app allows you to integrate your WallWand devices with your Homey smart home ecosystem, enabling you to control your lights and other connected devices through Homey's interface and flows.

## Features

* **Automatic endpoint discovery:** Automatically discovers and registers all available dimmer and switch endpoints on your WallWand device.
* **Real-time status updates:** The app listens for reports from the root device to ensure that the state of all endpoints is accurately reflected in Homey, even when controlled by physical button presses.
* **Customizable endpoint labels:** Easily rename each switch or dimmer through the device settings for a more personalized experience.
* **Dynamic capability management:** Capabilities are dynamically added and removed based on the discovered endpoints, providing a clean and intuitive user interface.

## Supported Devices

* TouchWand WallWand

## Prerequisites

Before you begin, ensure you have the following:

* A Homey Pro or Homey Bridge
* A TouchWand WallWand Z-Wave panel
* Node.js and npm installed on your computer
* The [Homey CLI](https://www.google.com/search?q=homey+cli) tools installed

## Installation

1. **Download the app:** Clone or download this repository to your local machine.
2. **Install dependencies:** Open a terminal window, navigate to the project's root directory, and run `npm install` to install the required dependencies.
3. **Install the app on Homey:** Run `homey app install` to install the app on your Homey device.

## Usage

Once the app is installed, you can add your WallWand device to Homey by following these steps:

1. Open the Homey app and navigate to the **Devices** tab.
2. Click the **+** button in the top right corner.
3. Select the **TouchWand WallWand** app.
4. Follow the on-screen instructions to put your device into inclusion mode.

After the device is successfully added, the app will automatically discover its endpoints and create the corresponding controls within the Homey app. You can then use these controls to manage your lights and incorporate them into your smart home flows.

## Troubleshooting

* **Device not found:** If your device is not found during the inclusion process, try moving it closer to your Homey device and ensure it is in inclusion mode.
* **Endpoints not discovered:** If some or all of the endpoints are not discovered, try re-including the device.
* **Incorrect status updates:** If you experience issues with incorrect status updates, please check the Z-Wave network for any communication errors.

If you continue to experience issues, please [open an issue](https://github.com/shpala/WallWand/issues) on our GitHub repository.

## Contributing

Contributions are welcome! If you would like to contribute to this project, please fork the repository and submit a pull request.

## Disclaimer

This is an unofficial app and is not affiliated with TouchWand in any way. Use at your own risk.

## License

This project is licensed under the MIT License. See the [LICENSE](https://github.com/shpala/WallWand/blob/main/LICENSE) file for details.
