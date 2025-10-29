# TouchWand WallWand Z-Wave Panel

This repository contains the source code for an unofficial Homey Pro App that adds proper support for TouchWand WallWand Z-Wave panels.

## Why This App Is Needed

TouchWand WallWand panels are multi-channel Z-Wave devices that can control up to 6 independent endpoints (lights, blinds, etc.). However, **without this app, they don't work properly with Homey Pro**.

### The Problem

When you pair a WallWand panel with Homey using the generic Z-Wave driver, you'll encounter these issues:

1. **Hidden Endpoints**: The panel appears as a single device with only one switch and one dimmer, even though it physically controls multiple lights and blinds. The other endpoints are completely invisible to Homey.

2. **Broken State Synchronization**: When you press the physical buttons on the wall panel, the lights and blinds respond correctly, but Homey's interface doesn't update. The app shows the wrong state (e.g., showing "On" when the light is actually off).

3. **Broken Automations**: Because Homey doesn't know the real state of your devices, automations that depend on endpoint states won't trigger properly. For example, a flow that should dim lights when a switch turns on won't work if you use the physical panel.

4. **No Individual Control**: You can't create separate scenes or automations for each light or blind because they're all hidden behind a single, non-functional interface.

### The Solution

This app provides a dedicated driver that:

- **Automatically discovers all endpoints** on your WallWand panel during pairing
- **Creates individual controls** for each light and blind in Homey's interface
- **Properly synchronizes state** when you use the physical wall panel buttons
- **Enables full automation** with reliable triggers and conditions for each endpoint
- **Allows custom labeling** so you can name each switch/dimmer meaningfully (e.g., "Kitchen Lights," "Bedroom Blinds")

With this app installed, your WallWand panel becomes a first-class Homey device with full bi-directional control and accurate state reporting.

## Features

- **Automatic endpoint discovery:** Automatically discovers and registers all available dimmer and switch endpoints on your WallWand device.
- **Real-time status updates:** The app listens for reports from the panel to ensure that the state of all endpoints is accurately reflected in Homey, even when controlled by physical button presses.
- **Customizable endpoint labels:** Easily rename each switch or dimmer through the device settings for a more personalized experience.
- **Dynamic capability management:** Capabilities are dynamically added and removed based on the discovered endpoints, providing a clean and intuitive user interface.
- **Flow card support:** Create powerful automations with triggers (endpoint turned on/off, dimmer changed), conditions (check endpoint state), and actions (control any endpoint).

## Supported Devices

- TouchWand WallWand (all variants with Z-Wave support)

## Prerequisites

Before you begin, ensure you have the following:

- A Homey Pro or Homey Bridge
- A TouchWand WallWand Z-Wave panel
- Node.js and npm installed on your computer (for development/installation from source)
- The [Homey CLI](https://www.google.com/search?q=homey+cli) tools installed (for development/installation from source)

## Installation

### From Homey App Store (Recommended)

1. Open the Homey app
2. Go to **More** → **Apps**
3. Search for "TouchWand"
4. Click **Install**

### From Source (Developers)

1. **Download the app:** Clone or download this repository to your local machine.
2. **Install dependencies:** Open a terminal window, navigate to the project's root directory, and run `npm install` to install the required dependencies.
3. **Install the app on Homey:** Run `homey app install` to install the app on your Homey device.

## Usage

Once the app is installed, you can add your WallWand device to Homey:

1. Open the Homey app and navigate to the **Devices** tab.
2. Click the **+** button in the top right corner.
3. Select the **TouchWand** app.
4. Follow the on-screen instructions to put your device into inclusion mode.

After the device is successfully added, the app will automatically discover its endpoints and create the corresponding controls within the Homey app. You can then:

- Control each light and blind individually from the Homey app
- Use them in Flows with full trigger/condition/action support
- Customize the labels for each endpoint in the device settings
- Create complex automations knowing that physical button presses will be properly synchronized

## Troubleshooting

- **Device not found:** If your device is not found during the inclusion process, try moving it closer to your Homey device and ensure it is in inclusion mode.
- **Endpoints not discovered:** If some or all of the endpoints are not discovered, try removing and re-including the device. Make sure the WallWand panel is powered and functioning correctly.
- **Incorrect status updates:** If you experience issues with incorrect status updates, please check the Z-Wave network for any communication errors. Try running a Z-Wave network heal from the Homey app.

If you continue to experience issues, please [open an issue](https://github.com/shpala/TouchWand/issues) on our GitHub repository.

## Contributing

Contributions are welcome! If you would like to contribute to this project, please fork the repository and submit a pull request.

## Disclaimer

This is an unofficial app and is not affiliated with TouchWand in any way. Use at your own risk.

## Technical Background

The short version: TouchWand WallWand panels use Z-Wave's Multi-Channel command class (0x60) to manage multiple endpoints, but they report incorrectly from their root device. This driver properly interrogates the device, discovers all endpoints, and creates endpoint-specific listeners to ensure accurate state synchronization.
