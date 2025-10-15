'use strict';
const { ZwaveDevice } = require('homey-zwavedriver');

module.exports = class WallWandDevice extends ZwaveDevice {
  static DEVICE_TYPES = {
    DIMMER: 'dimmer',
    SWITCH: 'switch',
  };

  // Constants
  static Z_WAVE_MAX_DIM_VALUE = 99;
  static SYNC_DEBOUNCE_MS = 100;
  static HEALTH_CHECK_INTERVAL_MS = 300000; // 5 minutes

  async onInit() {
    super.onInit();
    this.log(`[WallWand Device onInit] ${this.getName()} created`);

    // Initialize state
    this._listeners = [];
    this._syncTimeout = null;

    // Note: Flow card listeners are registered in app.js, not here
    // This prevents conflicts when multiple devices are added
  }

  async onNodeInit({ node } = {}) {
    node = node || this.node;
    if (!node) {
      return this.error('[onNodeInit] node missing');
    }

    //this.enableDebug();
    this.printNode();

    // Restore endpoint types from storage or initialize
    this._endpointTypes = await this.getStoreValue('endpointTypes') || {};

    try {
      // Clean up any old listeners before registering new ones
      this._cleanupListeners();

      // Register listeners for endpoint-less reports (physical presses)
      this._registerRootDeviceListeners(node);

      await this._discoverAllEndpoints(node);
      await this._syncAllEndpointStates(node);
      await this._cleanupOrphanedEndpoints();

      await this._applyLabelsFromSettings(this.getSettings());

      // Save discovered endpoint types
      await this.setStoreValue('endpointTypes', this._endpointTypes);

      // Set up health monitoring
      this._startHealthCheck();

      this.log('onNodeInit finished successfully.');
    } catch (error) {
      this.error('[onNodeInit] Initialization failed:', error);
      throw error;
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys = [] }) {
    const hasLabelChanges = changedKeys.some(k => k.startsWith('label_ep'));

    if (hasLabelChanges) {
      try {
        await this._applyLabelsFromSettings(newSettings);
      } catch (error) {
        this.error('[onSettings] Failed to apply label changes:', error);
        throw error;
      }
    }

    return super.onSettings({ oldSettings, newSettings, changedKeys });
  }

  async onDeleted() {
    this._cleanupListeners();

    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
      this._healthCheckInterval = null;
    }

    if (this._syncTimeout) {
      clearTimeout(this._syncTimeout);
      this._syncTimeout = null;
    }

    await super.onDeleted();
  }

  /**
   * Clean up all registered event listeners to prevent memory leaks
   */
  _cleanupListeners() {
    if (this._listeners && this._listeners.length > 0) {
      this.log(`[CLEANUP] Removing ${this._listeners.length} event listeners`);
      this._listeners.forEach(({ cc, event, listener }) => {
        try {
          cc.removeListener(event, listener);
        } catch (error) {
          this.error('[CLEANUP] Failed to remove listener:', error);
        }
      });
      this._listeners = [];
    }
  }

  /**
   * Start periodic health check to detect state loss
   */
  _startHealthCheck() {
    if (this._healthCheckInterval) {
      clearInterval(this._healthCheckInterval);
    }

    this._healthCheckInterval = setInterval(() => {
      this._checkDeviceHealth();
    }, WallWandDevice.HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Check if device state is healthy and attempt recovery if needed
   */
  async _checkDeviceHealth() {
    const discoveredCount = Object.keys(this._endpointTypes || {}).length;
    const capabilityCount = this.getCapabilities().filter(c =>
      c.startsWith('onoff.ep') || c.startsWith('dim.ep')
    ).length;

    if (discoveredCount === 0 && capabilityCount > 0) {
      this.warning('[HEALTH] Endpoint types lost, attempting rediscovery');
      try {
        await this._discoverAllEndpoints(this.node);
        await this.setStoreValue('endpointTypes', this._endpointTypes);
      } catch (error) {
        this.error('[HEALTH] Rediscovery failed:', error);
      }
    }
  }

  /**
   * Get autocomplete list for endpoint selection in flows
   * @param {string} query - Search query from user
   * @param {boolean} dimmersOnly - If true, only return dimmer endpoints
   * @returns {Promise<Array<{name: string, id: number}>>}
   */
  async _getEndpointAutocompleteList(query, dimmersOnly = false) {
    const settings = this.getSettings();
    const items = [];
    for (const id in this._endpointTypes) {
      if (this._endpointTypes[id]) {
        const endpointNum = parseInt(id, 10);
        const isDimmer = this._endpointTypes[id] === WallWandDevice.DEVICE_TYPES.DIMMER;

        if (dimmersOnly && !isDimmer) {
          continue;
        }

        const customLabel = (settings[`label_ep${endpointNum}`] || '').trim();
        const capId = isDimmer ? `dim.ep${endpointNum}` : `onoff.ep${endpointNum}`;
        const defaultLabel = this._getDefaultLabel(endpointNum, isDimmer, capId);
        const name = customLabel || defaultLabel;

        items.push({
          name: name,
          id: endpointNum,
        });
      }
    }
    return items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()));
  }

  /**
   * Register listeners on root device for reports without endpoint ID
   * Uses debouncing to avoid unnecessary syncs when endpoint-specific reports arrive
   */
  _registerRootDeviceListeners(node) {
    if (node?.CommandClass?.COMMAND_CLASS_SWITCH_MULTILEVEL) {
      const multilevelListener = async () => {
        // Debounce: wait for endpoint-specific reports first
        if (this._syncTimeout) {
          clearTimeout(this._syncTimeout);
        }

        this._syncTimeout = setTimeout(async () => {
          this.log('[REPORT] Root multilevel detected, no endpoint report received, syncing all dimmers');
          await this._syncEndpointsByType(WallWandDevice.DEVICE_TYPES.DIMMER);
        }, WallWandDevice.SYNC_DEBOUNCE_MS);
      };

      node.CommandClass.COMMAND_CLASS_SWITCH_MULTILEVEL.on('report', multilevelListener);
      this._listeners.push({
        cc: node.CommandClass.COMMAND_CLASS_SWITCH_MULTILEVEL,
        event: 'report',
        listener: multilevelListener,
      });
    }

    if (node?.CommandClass?.COMMAND_CLASS_SWITCH_BINARY) {
      const binaryListener = async () => {
        if (this._syncTimeout) {
          clearTimeout(this._syncTimeout);
        }

        this._syncTimeout = setTimeout(async () => {
          this.log('[REPORT] Root binary detected, no endpoint report received, syncing all switches');
          await this._syncEndpointsByType(WallWandDevice.DEVICE_TYPES.SWITCH);
        }, WallWandDevice.SYNC_DEBOUNCE_MS);
      };

      node.CommandClass.COMMAND_CLASS_SWITCH_BINARY.on('report', binaryListener);
      this._listeners.push({
        cc: node.CommandClass.COMMAND_CLASS_SWITCH_BINARY,
        event: 'report',
        listener: binaryListener,
      });
    }

    this.log('[LISTENERS] Root device listeners registered with debouncing');
  }

  async _discoverAllEndpoints(node) {
    const endpoints = node.MultiChannelNodes || {};
    const endpointIds = Object.keys(endpoints);

    if (endpointIds.length === 0) {
      this.log('[DISCOVERY] No endpoints found, cleaning up all capabilities');
      await this._cleanupAllEndpoints();
      return;
    }

    this.log(`[DISCOVERY] Starting discovery for ${endpointIds.length} endpoint(s)`);

    for (const id of endpointIds) {
      const endpointNum = parseInt(id, 10);

      if (isNaN(endpointNum) || endpointNum < 1) {
        this.error(`[DISCOVERY] Invalid endpoint ID: ${id}`);
        continue;
      }

      await this._discoverOneEndpoint(endpointNum, endpoints[id]);
    }
  }

  async _discoverOneEndpoint(endpointNum, endpoint) {
    if (!endpoint || this._endpointTypes[endpointNum]) {
      return;
    }

    const commandClass = endpoint.CommandClass || {};
    const deviceType = this._detectEndpointType(endpoint, commandClass);

    if (!deviceType) {
      this.log(`[ENDPOINT ${endpointNum}] Type "${endpoint.deviceClassGeneric}" not supported, removing capabilities`);
      this._endpointTypes[endpointNum] = null;
      await this._removeEndpointCapabilities(endpointNum);
      return;
    }

    this.log(`[ENDPOINT ${endpointNum}] Discovered as ${deviceType}`);

    try {
      await this._registerEndpointCapabilities(endpointNum, deviceType);
      this._endpointTypes[endpointNum] = deviceType;

      // Persist immediately after discovery
      await this.setStoreValue('endpointTypes', this._endpointTypes);
    } catch (error) {
      // Handle timeout errors gracefully - they're common during initial registration
      if (error.message && error.message.includes('timeout')) {
        this.log(`[ENDPOINT ${endpointNum}] Timeout during registration (common during pairing), will sync state later`);
        // Still mark the endpoint type so it's not lost
        this._endpointTypes[endpointNum] = deviceType;
        await this.setStoreValue('endpointTypes', this._endpointTypes);
      } else {
        this.error(`[ENDPOINT ${endpointNum}] Failed to register:`, error.message || error);
      }
    }
  }

  _detectEndpointType(endpoint, commandClass) {
    const isDimmer =
      endpoint.deviceClassGeneric === 'GENERIC_TYPE_SWITCH_MULTILEVEL' &&
      commandClass.COMMAND_CLASS_SWITCH_MULTILEVEL;

    const isSwitch =
      endpoint.deviceClassGeneric === 'GENERIC_TYPE_SWITCH_BINARY' &&
      commandClass.COMMAND_CLASS_SWITCH_BINARY;

    if (isDimmer) return WallWandDevice.DEVICE_TYPES.DIMMER;
    if (isSwitch) return WallWandDevice.DEVICE_TYPES.SWITCH;
    return null;
  }

  async _registerEndpointCapabilities(endpointNum, deviceType) {
    const onoffCap = `onoff.ep${endpointNum}`;
    const dimCap = `dim.ep${endpointNum}`;

    if (deviceType === WallWandDevice.DEVICE_TYPES.DIMMER) {
      try {
        this.registerCapability(onoffCap, 'SWITCH_MULTILEVEL', { multiChannelNodeId: endpointNum });
      } catch (error) {
        // Timeout during initial GET is common during discovery - capability is still registered
        const errorMsg = error.message || error.toString();
        if (errorMsg.includes('timeout') || errorMsg.includes('capability get command failed')) {
          this.log(`[CAPABILITY] ${onoffCap} registered (initial GET timeout - will sync later)`);
        } else {
          this.error(`[CAPABILITY] ${onoffCap} registration failed:`, errorMsg);
          throw error; // Re-throw non-timeout errors
        }
      }

      try {
        this.registerCapability(dimCap, 'SWITCH_MULTILEVEL', { multiChannelNodeId: endpointNum });
      } catch (error) {
        const errorMsg = error.message || error.toString();
        if (errorMsg.includes('timeout') || errorMsg.includes('capability get command failed')) {
          this.log(`[CAPABILITY] ${dimCap} registered (initial GET timeout - will sync later)`);
        } else {
          this.error(`[CAPABILITY] ${dimCap} registration failed:`, errorMsg);
          throw error;
        }
      }
    } else if (deviceType === WallWandDevice.DEVICE_TYPES.SWITCH) {
      try {
        this.registerCapability(onoffCap, 'SWITCH_BINARY', { multiChannelNodeId: endpointNum });
      } catch (error) {
        const errorMsg = error.message || error.toString();
        if (errorMsg.includes('timeout') || errorMsg.includes('capability get command failed')) {
          this.log(`[CAPABILITY] ${onoffCap} registered (initial GET timeout - will sync later)`);
        } else {
          this.error(`[CAPABILITY] ${onoffCap} registration failed:`, errorMsg);
          throw error;
        }
      }
    }

    this.log(`[CAPABILITY] EP${endpointNum} capabilities registered as ${deviceType}`);
  }

  _isValidReport(report, requiredField) {
    return report && typeof report === 'object' && requiredField in report;
  }

  async _syncAllEndpointStates(node) {
    const endpoints = node.MultiChannelNodes || {};
    const discoveredIds = Object.keys(this._endpointTypes);

    this.log(`[SYNC] Syncing state for ${discoveredIds.length} endpoint(s)`);

    for (const id of discoveredIds) {
      const endpointNum = parseInt(id, 10);
      await this._syncOneEndpointState(endpointNum, endpoints[id]);
    }
  }

  async _syncEndpointsByType(deviceType) {
    const node = this.node;
    if (!node) {
      this.error('[SYNC] Node not available');
      return;
    }

    const endpoints = node.MultiChannelNodes || {};
    const endpointsToSync = Object.keys(this._endpointTypes)
      .filter(id => this._endpointTypes[id] === deviceType)
      .map(id => parseInt(id, 10));

    if (endpointsToSync.length === 0) {
      this.log(`[SYNC] No ${deviceType} endpoints to sync`);
      return;
    }

    this.log(`[SYNC] Syncing ${endpointsToSync.length} ${deviceType} endpoint(s): [${endpointsToSync.join(', ')}]`);

    for (const endpointNum of endpointsToSync) {
      await this._syncOneEndpointState(endpointNum, endpoints[endpointNum]);
    }
  }

  async _syncOneEndpointState(endpointNum, endpoint) {
    const deviceType = this._endpointTypes[endpointNum];

    if (!endpoint) {
      this.log(`[ENDPOINT ${endpointNum}] No longer available, removing capabilities`);
      await this._removeEndpointCapabilities(endpointNum);
      return;
    }

    if (deviceType === null || deviceType === undefined) {
      return;
    }

    const commandClass = endpoint.CommandClass || {};
    const onoffCap = `onoff.ep${endpointNum}`;
    const dimCap = `dim.ep${endpointNum}`;

    try {
      let syncSuccess = false;
      if (deviceType === WallWandDevice.DEVICE_TYPES.DIMMER) {
        syncSuccess = await this._syncDimmerState(endpointNum, commandClass, onoffCap, dimCap);
      } else if (deviceType === WallWandDevice.DEVICE_TYPES.SWITCH) {
        syncSuccess = await this._syncSwitchState(endpointNum, commandClass, onoffCap, dimCap);
      }

      if (!syncSuccess) {
        throw new Error('Invalid or missing report during sync');
      }
    } catch (error) {
      const errorMsg = error.message || error.toString();

      // Distinguish between timeout (common, usually recovers) and other errors
      if (errorMsg.includes('timeout')) {
        this.log(`[SYNC] EP${endpointNum} timeout - device may be busy or out of range, will retry on next update`);
        // Don't mark as unsupported for timeouts - they often resolve themselves
        return;
      }

      // For other errors, mark as unsupported
      this.error(`[SYNC] EP${endpointNum} failed with error:`, errorMsg);
      this.log(`[SYNC] Marking EP${endpointNum} as unsupported and removing capabilities`);
      this._endpointTypes[endpointNum] = null;
      await this._removeEndpointCapabilities(endpointNum);
      await this.setStoreValue('endpointTypes', this._endpointTypes);
    }
  }

  async _syncDimmerState(endpointNum, commandClass, onoffCap, dimCap) {
    await this._ensureCapability(onoffCap);
    await this._ensureCapability(dimCap);

    const cc = commandClass.COMMAND_CLASS_SWITCH_MULTILEVEL;
    if (!cc || typeof cc.SWITCH_MULTILEVEL_GET !== 'function') {
      this.error(`[SYNC] EP${endpointNum} SWITCH_MULTILEVEL not available`);
      return false;
    }

    const report = await cc.SWITCH_MULTILEVEL_GET();

    if (this._isValidReport(report, 'Current Value')) {
      const dimValue = report['Current Value'];
      this.log(`[SYNC] EP${endpointNum} dimmer: ${dimValue}/${WallWandDevice.Z_WAVE_MAX_DIM_VALUE}`);
      this._setOnOff(onoffCap, dimValue > 0, endpointNum);
      this._setDim(dimCap, dimValue / WallWandDevice.Z_WAVE_MAX_DIM_VALUE, endpointNum);
      return true;
    }

    return false;
  }

  async _syncSwitchState(endpointNum, commandClass, onoffCap, dimCap) {
    await this._removeIfPresent(dimCap);
    await this._ensureCapability(onoffCap);

    const cc = commandClass.COMMAND_CLASS_SWITCH_BINARY;
    if (!cc || typeof cc.SWITCH_BINARY_GET !== 'function') {
      this.error(`[SYNC] EP${endpointNum} SWITCH_BINARY not available`);
      return false;
    }

    const report = await cc.SWITCH_BINARY_GET();
    if (this._isValidReport(report, 'Value')) {
      const isOn = report.Value === 'on/enable' || report.Value === 1;
      this.log(`[SYNC] EP${endpointNum} switch: ${isOn}`);
      this._setOnOff(onoffCap, isOn, endpointNum);
      return true;
    }

    return false;
  }

  async _cleanupOrphanedEndpoints() {
    this.log('[CLEANUP] Checking for orphaned endpoint capabilities');
    const manifestCapabilities = this.driver.manifest.capabilities || [];

    let maxManifestEndpoint = 0;
    for (const capId of manifestCapabilities) {
      const match = capId.match(/\.ep(\d+)$/);
      if (match && match[1]) {
        const endpointNum = parseInt(match[1], 10);
        if (endpointNum > maxManifestEndpoint) {
          maxManifestEndpoint = endpointNum;
        }
      }
    }

    if (maxManifestEndpoint === 0) {
      this.log('[CLEANUP] No endpoint capabilities in manifest');
      return;
    }

    for (let i = 1; i <= maxManifestEndpoint; i++) {
      if (!this._endpointTypes.hasOwnProperty(i) || this._endpointTypes[i] === null) {
        if (this.hasCapability(`onoff.ep${i}`) || this.hasCapability(`dim.ep${i}`)) {
          this.log(`[CLEANUP] EP${i} is orphaned or unsupported, removing capabilities`);
          await this._removeEndpointCapabilities(i);
        }
      }
    }
  }

  async _applyLabelsFromSettings(settings = {}) {
    const supportedEndpoints = Object.keys(this._endpointTypes)
      .filter(id => this._endpointTypes[id]);

    for (const id of supportedEndpoints) {
      const endpointNum = parseInt(id, 10);
      await this._applyLabelToEndpoint(endpointNum, settings);
    }
  }

  async _applyLabelToEndpoint(endpointNum, settings) {
    // Sanitize user input
    const rawLabel = settings[`label_ep${endpointNum}`] || '';
    const customLabel = rawLabel
      .trim()
      .substring(0, 50) // Limit length
      .replace(/[<>]/g, ''); // Remove potential HTML

    const onoffCap = `onoff.ep${endpointNum}`;
    const dimCap = `dim.ep${endpointNum}`;
    const isDimmer = this.hasCapability(dimCap);
    const capId = isDimmer ? dimCap : onoffCap;

    const defaultLabel = this._getDefaultLabel(endpointNum, isDimmer, capId);
    const finalLabel = customLabel || defaultLabel;

    try {
      if (this.hasCapability(onoffCap)) {
        await this._setTitle(onoffCap, finalLabel);
      }
      if (isDimmer && this.hasCapability(dimCap)) {
        await this._setTitle(dimCap, finalLabel);
      }
    } catch (error) {
      this.error(`[LABEL] Failed to set label for EP${endpointNum}:`, error);
    }
  }

  _getDefaultLabel(endpointNum, isDimmer, capabilityId) {
    const manifestDefault =
      this.driver?.manifest?.capabilitiesOptions?.[capabilityId]?.title?.en;

    if (manifestDefault) {
      return manifestDefault;
    }

    const typeLabel = isDimmer ? 'Dimmer' : 'Switch';
    return `${typeLabel} ${endpointNum}`;
  }

  async _cleanupAllEndpoints() {
    this._endpointTypes = {};
    await this.setStoreValue('endpointTypes', {});

    const manifestCapabilities = this.driver.manifest.capabilities || [];
    const endpointCapabilities = manifestCapabilities.filter(id => id.match(/\.ep\d+$/));
    const cleanupPromises = endpointCapabilities.map(capId =>
      this._removeIfPresent(capId)
    );
    await Promise.all(cleanupPromises);
    await this.setSettings(this._blankLabels());
  }

  async _removeEndpointCapabilities(endpointNum) {
    await this._removeIfPresent(`dim.ep${endpointNum}`);
    await this._removeIfPresent(`onoff.ep${endpointNum}`);
  }

  _blankLabels() {
    const labels = {};
    const manifestSettings = this.driver.manifest.settings || [];
    for (const setting of manifestSettings) {
      if (setting.id.startsWith('label_ep')) {
        labels[setting.id] = '';
      }
    }
    return labels;
  }

  async _ensureCapability(cap) {
    if (!this.hasCapability(cap)) {
      await this.addCapability(cap).catch(err => {
        this.error(`[CAPABILITY] Failed to add ${cap}:`, err);
      });
    }
  }

  async _removeIfPresent(cap) {
    if (this.hasCapability(cap)) {
      await this.removeCapability(cap).catch(err => {
        this.error(`[CAPABILITY] Failed to remove ${cap}:`, err);
      });
    }
  }

  async _setTitle(cap, title) {
    return this.setCapabilityOptions(cap, { title }).catch(err => {
      this.error(`[CAPABILITY] Failed to set title for ${cap}:`, err);
    });
  }

  _getEndpointLabel(endpointNum) {
    const settings = this.getSettings();
    const customLabel = (settings[`label_ep${endpointNum}`] || '').trim();
    const isDimmer = this._endpointTypes[endpointNum] === WallWandDevice.DEVICE_TYPES.DIMMER;
    const capId = isDimmer ? `dim.ep${endpointNum}` : `onoff.ep${endpointNum}`;
    const defaultLabel = this._getDefaultLabel(endpointNum, isDimmer, capId);
    return customLabel || defaultLabel;
  }

  async _triggerEndpoint(triggerId, endpointNum, tokens = {}) {
    try {
      const trigger = this.homey.flow.getDeviceTriggerCard(triggerId);
      if (!trigger) return;

      await trigger.trigger(this, {
        endpoint_id: endpointNum,
        endpoint_label: this._getEndpointLabel(endpointNum),
        ...tokens
      }, {
        endpoint: {
          id: endpointNum,
          name: this._getEndpointLabel(endpointNum)
        }
      });

      this.log(`[FLOW] Triggered '${triggerId}' for EP${endpointNum}`);
    } catch (error) {
      this.error(`[FLOW] Failed to trigger '${triggerId}' for EP${endpointNum}:`, error);
    }
  }

  async _triggerEndpointTurnedOn(endpointNum) {
    await this._triggerEndpoint('endpoint_turned_on', endpointNum);
  }

  async _triggerEndpointTurnedOff(endpointNum) {
    await this._triggerEndpoint('endpoint_turned_off', endpointNum);
  }

  async _triggerEndpointDimChanged(endpointNum, dimValue) {
    await this._triggerEndpoint('endpoint_dim_changed', endpointNum, { dim_value: dimValue });
  }

  async _triggerEndpointStateChanged(endpointNum, state) {
    await this._triggerEndpoint('endpoint_state_changed', endpointNum, { state });
  }

  _setOnOff(cap, value, endpointNum) {
    if (!cap || typeof cap !== 'string') {
      this.error('[ONOFF] Invalid capability ID');
      return;
    }

    if (!this.hasCapability(cap)) return;

    const oldValue = this.getCapabilityValue(cap);
    const newValue = !!value;

    this.setCapabilityValue(cap, newValue).catch(err => {
      this.error(`[ONOFF] Failed to set ${cap} to ${newValue}:`, err);
    });

    if (oldValue === newValue) return;

    if (newValue) {
      this._triggerEndpointTurnedOn(endpointNum);
    } else {
      this._triggerEndpointTurnedOff(endpointNum);
    }

    this._triggerEndpointStateChanged(endpointNum, newValue);
  }

  _setDim(cap, value01, endpointNum) {
    if (!cap || typeof cap !== 'string') {
      this.error('[DIM] Invalid capability ID');
      return;
    }

    if (!Number.isFinite(endpointNum) || endpointNum < 1) {
      this.error(`[DIM] Invalid endpoint number: ${endpointNum}`);
      return;
    }

    const normalizedValue = Math.max(0, Math.min(1, Number(value01) || 0));

    if (!this.hasCapability(cap)) return;

    const oldValue = this.getCapabilityValue(cap);

    this.setCapabilityValue(cap, normalizedValue).catch(err => {
      this.error(`[DIM] Failed to set ${cap} to ${normalizedValue}:`, err);
    });

    if (oldValue === normalizedValue) return;

    this._triggerEndpointDimChanged(endpointNum, normalizedValue);
  }

  // ============================================================
  // Flow Condition Handlers
  // ============================================================

  async _handleEndpointIsOn(args) {
    if (!args.endpoint?.id) {
      this.error('[FLOW] Invalid endpoint in condition');
      return false;
    }

    const endpointNum = args.endpoint.id;
    if (!this._endpointTypes[endpointNum]) {
      this.error(`[FLOW] Endpoint ${endpointNum} not found or unsupported`);
      return false;
    }

    const cap = `onoff.ep${endpointNum}`;
    if (!this.hasCapability(cap)) return false;
    return !!this.getCapabilityValue(cap);
  }

  async _handleEndpointDimCompare(args) {
    if (!args.endpoint?.id) {
      this.error('[FLOW] Invalid endpoint in condition');
      return false;
    }

    const endpointNum = args.endpoint.id;
    if (!this._endpointTypes[endpointNum]) {
      this.error(`[FLOW] Endpoint ${endpointNum} not found or unsupported`);
      return false;
    }

    const cap = `dim.ep${endpointNum}`;
    if (!this.hasCapability(cap)) return false;

    const current = this.getCapabilityValue(cap) || 0;
    const target = Number(args.level) || 0;

    switch (args.comparison) {
      case 'greater_than': return current > target;
      case 'less_than': return current < target;
      case 'equal_to': return Math.abs(current - target) < 0.01;
      default: return false;
    }
  }
};
