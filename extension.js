'use strict';

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import { LibreViewClient } from './libreviewClient.js';
import { DexcomClient } from './dexcomClient.js';
import { NightscoutClient } from './nightscoutClient.js';
import { DexcomShareUploader } from './dexcomShareUploader.js';

const Libre3ViewIndicator = GObject.registerClass(
class Libre3ViewIndicator extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Libre3View Indicator');
        this._settings = settings;
        this._destroyed = false;
        this._signalHandlers = [];

        this.path = null;
        this._lastLoggedValue = null;
        this._currentReading = null;
        this._cgmClient = null;
        this._dexcomUploader = null;
        this._dexcomUploader2 = null;

       
        this._maskSensitiveData = (data) => {
            if (typeof data === 'string') {
                return data;
            }
            if (typeof data !== 'object' || data === null) {
                return data;
            }
            const sensitiveKeys = ['password', 'email', 'username', 'token', 'apiSecret',
                                   'api-secret', 'firstName', 'lastName', 'accountId', 'patientId'];
            const masked = Array.isArray(data) ? [] : {};
            for (const key in data) {
                if (sensitiveKeys.includes(key.toLowerCase()) || sensitiveKeys.includes(key)) {
                    masked[key] = '***MASKED***';
                } else if (typeof data[key] === 'object' && data[key] !== null) {
                    masked[key] = this._maskSensitiveData(data[key]);
                } else {
                    masked[key] = data[key];
                }
            }
            return masked;
        };

        this._log = (message, data = null) => {
            if (this._settings.get_boolean('enable-debug-logs')) {
                if (data) {
                    const maskedData = this._maskSensitiveData(data);
                    console.log(`[Libre3View] ${message}`, maskedData);
                } else {
                    console.log(`[Libre3View] ${message}`);
                }
            }
        };

       
        this.box = new St.BoxLayout({
            style_class: 'panel-status-menu-box'
        });

        this.buttonText = new St.Label({
            text: '---',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'libre3view-label'
        });

        this.add_child(this.box);
        this.box.add_child(this.buttonText);

       
        this._cgmClient = this._createClient();

       
        this._initDexcomUploader();

       
        this._buildMenu();

       
        this._connectSignals();

       
        this._startMonitoring();
    }

    setPath(path) {
        this.path = path;
        this._initIcon();
        this._updateIconVisibility();
    }

    _createClient() {
        const dataSource = this._settings.get_string('data-source');
        const unit = this._settings.get_string('unit');

        this._log(`Creating client for data source: ${dataSource}`);

        let client = null;

        if (dataSource === 'libreview') {
            const email = this._settings.get_string('libreview-email');
            const password = this._settings.get_string('libreview-password');

            if (!email || !password) {
                this._log('LibreView credentials not configured');
                return null;
            }

           
            const region = this._settings.get_string('libreview-region') || null;
            if (region) {
                this._log(`Using manual LibreView region: ${region}`);
            }

            client = new LibreViewClient(email, password, unit, this._settings, region);
            const patientId = this._settings.get_string('libreview-patient-id');
            if (patientId) {
                client.setPatientId(patientId);
            }

        } else if (dataSource === 'nightscout') {
            const url = this._settings.get_string('nightscout-url');
            const apiSecret = this._settings.get_string('nightscout-api-secret');

            if (!url) {
                this._log('Nightscout URL not configured');
                return null;
            }

            client = new NightscoutClient(url, apiSecret, unit, this._settings);

        } else {
           
            const username = this._settings.get_string('username');
            const password = this._settings.get_string('password');
            const region = this._settings.get_string('region');

            if (!username || !password) {
                this._log('Dexcom credentials not configured');
                return null;
            }

            client = new DexcomClient(username, password, region, unit, this._settings);
        }

        return client;
    }

    _initDexcomUploader() {
       
        if (this._dexcomUploader) {
            this._dexcomUploader.destroy();
            this._dexcomUploader = null;
        }
        if (this._dexcomUploader2) {
            this._dexcomUploader2.destroy();
            this._dexcomUploader2 = null;
        }

       
       
        if (this._settings.get_boolean('enable-dexcom-upload')) {
            const username = this._settings.get_string('dexcom-upload-username');
            const password = this._settings.get_string('dexcom-upload-password');
            const region = this._settings.get_string('dexcom-upload-region');

            if (username && password) {
                this._dexcomUploader = new DexcomShareUploader(username, password, region, this._settings);
                this._log(`Dexcom Share Upload initialized (region: ${region})`);
            }
        }

       
       
        if (this._settings.get_boolean('enable-dexcom-upload-2')) {
            const username2 = this._settings.get_string('dexcom-upload-username-2');
            const password2 = this._settings.get_string('dexcom-upload-password-2');
            const region2 = this._settings.get_string('dexcom-upload-region-2');

            if (username2 && password2) {
                this._dexcomUploader2 = new DexcomShareUploader(username2, password2, region2, this._settings);
                this._log(`Dexcom Share Mirror initialized (region: ${region2})`);
            }
        }
    }

    _loadIcon() {
        if (!this.path) {
            throw new Error('Extension path not set');
        }

        const iconPath = `${this.path}/icons/libre3view.png`;
        const file = Gio.File.new_for_path(iconPath);

        if (file.query_exists(null)) {
            if (this.icon) {
                this.icon.gicon = Gio.icon_new_for_string(iconPath);
            } else {
                this.icon = new St.Icon({
                    style_class: 'libre3view-icon',
                    gicon: Gio.icon_new_for_string(iconPath),
                    icon_size: 16
                });
            }
        } else {
            throw new Error(`Icon file not found: ${iconPath}`);
        }
    }

    _initIcon() {
        try {
            this._loadIcon();
        } catch (error) {
            this._log('Error initializing icon:', error);
            this.icon = new St.Icon({
                icon_name: 'utilities-system-monitor-symbolic',
                style_class: 'system-status-icon',
                icon_size: 16
            });
        }
    }

    _connectSignals() {
        const updateDisplaySettings = () => {
            if (this._currentReading) {
                this._updateDisplay(this._currentReading);
            }
        };

       
        this._connectSetting('changed::show-icon', updateDisplaySettings);
        this._connectSetting('changed::show-trend-arrows', updateDisplaySettings);
        this._connectSetting('changed::show-delta', updateDisplaySettings);
        this._connectSetting('changed::show-elapsed-time', updateDisplaySettings);

       
        this._connectSetting('changed::libreview-email', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._connectSetting('changed::libreview-password', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._connectSetting('changed::libreview-region', () => {
            this._updateCredentials();
            this._updateReading();
        });

       
        this._connectSetting('changed::username', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._connectSetting('changed::password', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._connectSetting('changed::region', () => {
            this._updateCredentials();
            this._updateReading();
        });

       
        this._connectSetting('changed::nightscout-url', () => {
            this._updateCredentials();
            this._updateReading();
        });
        this._connectSetting('changed::nightscout-api-secret', () => {
            this._updateCredentials();
            this._updateReading();
        });
       
        this._connectSetting('changed::skip-tls-verification', () => {
            this._updateCredentials();
            this._updateReading();
        });

       
        this._connectSetting('changed::data-source', () => {
            this._updateCredentials();
            this._updateReading();
        });

        this._connectSetting('changed::unit', () => {
            this._updateUnit();
            this._updateReading();
        });

        this._connectSetting('changed::icon-position', () => {
            this._updateIconVisibility();
        });

       
        this._connectSetting('changed::enable-dexcom-upload', () => {
            this._initDexcomUploader();
        });
        this._connectSetting('changed::dexcom-upload-username', () => {
            this._initDexcomUploader();
        });
        this._connectSetting('changed::dexcom-upload-password', () => {
            this._initDexcomUploader();
        });
        this._connectSetting('changed::dexcom-upload-region', () => {
            this._initDexcomUploader();
        });

       
        this._connectSetting('changed::enable-dexcom-upload-2', () => {
            this._initDexcomUploader();
        });
        this._connectSetting('changed::dexcom-upload-username-2', () => {
            this._initDexcomUploader();
        });
        this._connectSetting('changed::dexcom-upload-password-2', () => {
            this._initDexcomUploader();
        });
        this._connectSetting('changed::dexcom-upload-region-2', () => {
            this._initDexcomUploader();
        });
    }

    _connectSetting(signal, callback) {
        const handlerId = this._settings.connect(signal, callback);
        this._signalHandlers.push(handlerId);
    }

    _updateCredentials() {
        const dataSource = this._settings.get_string('data-source');

        if (dataSource === 'libreview') {
            const email = this._settings.get_string('libreview-email');
            const password = this._settings.get_string('libreview-password');
            if (!email || !password) {
                this._log('LibreView credentials not set');
                this._updateDisplayError('Setup Required', 'Please enter your LibreView credentials');
                return;
            }
        } else if (dataSource === 'nightscout') {
            const url = this._settings.get_string('nightscout-url');
            if (!url) {
                this._log('Nightscout URL not set');
                this._updateDisplayError('Setup Required', 'Please enter your Nightscout URL');
                return;
            }
        } else {
            const username = this._settings.get_string('username');
            const password = this._settings.get_string('password');
            if (!username || !password) {
                this._log('Dexcom credentials not set');
                this._updateDisplayError('Auth Error', 'Please enter your Dexcom Share credentials');
                return;
            }
        }

       
        if (this._cgmClient && this._cgmClient.destroy) {
            this._cgmClient.destroy();
        }

        this._cgmClient = this._createClient();
    }

    _addToggleMenuItem(label, settingKey) {
        const toggleItem = new PopupMenu.PopupSwitchMenuItem(
            label,
            this._settings.get_boolean(settingKey)
        );
        toggleItem.connect('toggled', (item) => {
            this._settings.set_boolean(settingKey, item.state);
            this._updateReading();
        });
        this.menu.addMenuItem(toggleItem);
    }

    _updateUnit() {
       
        if (this._cgmClient && this._cgmClient.destroy) {
            this._cgmClient.destroy();
        }
        this._cgmClient = this._createClient();

        if (this._currentReading) {
            const unit = this._settings.get_string('unit');
            const rawValue = unit === 'mmol/L'
                ? parseFloat(this._currentReading.value) * 18.0
                : parseFloat(this._currentReading.value);

            const value = unit === 'mmol/L'
                ? (rawValue / 18.0).toFixed(1)
                : rawValue;

            const delta = unit === 'mmol/L'
                ? (parseFloat(this._currentReading.delta) * 18.0 / 18.0).toFixed(1)
                : this._currentReading.delta;

            const updatedReading = {
                ...this._currentReading,
                value: value,
                delta: delta,
                unit: unit
            };

            this._updateDisplay(updatedReading);
            this._updateMenuInfo(updatedReading);
        }
    }

    _startMonitoring() {
        this._updateReading();

        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

        const interval = this._settings.get_int('update-interval');
        this._timeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this._updateReading();
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _updateReading() {
        if (this._destroyed) {
            return;
        }

        if (!this._cgmClient) {
            const dataSource = this._settings.get_string('data-source');
            const messages = {
                'libreview': 'Please configure your LibreView settings',
                'nightscout': 'Please configure your Nightscout settings',
                'dexcom': 'Please configure your Dexcom Share credentials'
            };
            this._updateDisplayError('Setup Required', messages[dataSource] || 'Please configure settings');
            return;
        }

        try {
            const reading = await this._cgmClient.getLatestGlucose();

            if (this._destroyed) {
                return;
            }

            if (!reading) {
                this._updateDisplayError('No Data', 'No glucose data available');
                return;
            }

            this._updateDisplay(reading);
            this._updateMenuInfo(reading);

            const dataSource = this._settings.get_string('data-source');

           
           
            if (dataSource === 'libreview' && this._dexcomUploader && this._settings.get_boolean('enable-dexcom-upload')) {
                try {
                    await this._dexcomUploader.uploadGlucoseReading(reading);
                } catch (uploadError) {
                    this._log('Dexcom Share Upload error:', uploadError.message);
                }
            }

           
           
            if (dataSource === 'dexcom' && this._dexcomUploader2 && this._settings.get_boolean('enable-dexcom-upload-2')) {
                try {
                    await this._dexcomUploader2.uploadGlucoseReading(reading);
                } catch (uploadError) {
                    this._log('Dexcom Share Mirror error:', uploadError.message);
                }
            }

        } catch (error) {
            this._log('Error fetching CGM reading:', error);
            this._handleReadingError(error);
        }
    }

    _handleReadingError(error) {
        let errorMessage = 'Error';
        let detailedMessage = error.message;
        const dataSource = this._settings.get_string('data-source');

        if (error.message.includes('TLS_ERROR')) {
            errorMessage = 'TLS Error';
            detailedMessage = 'SSL certificate error. Check your connection.';
        } else if (error.message.includes('NETWORK_ERROR')) {
            errorMessage = 'Network Error';
            detailedMessage = 'Connection failed. Please check your internet connection.';
        } else if (error.message.includes('RATE_LIMITED')) {
            errorMessage = 'Rate Limited';
            detailedMessage = 'Too many requests. Please wait a few minutes.';
        } else if (error.message.includes('AUTH_ERROR')) {
            errorMessage = 'Auth Error';
            detailedMessage = 'Invalid credentials. Please check your login details.';
        } else if (error.message.includes('NO_DATA')) {
            errorMessage = 'No Data';
            detailedMessage = 'No glucose data available.';
        } else if (error.message.includes('SESSION_EXPIRED')) {
            errorMessage = 'Session Error';
            detailedMessage = 'Session expired. Re-authenticating...';
        }

        this._updateDisplayError(errorMessage, detailedMessage);
    }

    _updateDisplayError(errorMessage, detailedMessage) {
        if (this._destroyed || !this.box) {
            return;
        }

        this._currentReading = null;
        this.box.remove_all_children();
        this.box.style_class = '';
        this.box.set_style('spacing: 2px; padding: 0px 1px;');

        if (this._settings.get_boolean('show-icon') && this.icon) {
            this.box.add_child(this.icon);
        }

        const errorContainer = new St.Bin({
            style_class: 'libre3view-value-container',
            style: 'color: #ff0000; border-color: rgba(255, 0, 0, 0.6);',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        const errorLabel = new St.Label({
            text: errorMessage,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'libre3view-error'
        });

        errorContainer.set_child(errorLabel);
        this.box.add_child(errorContainer);

        if (this.glucoseInfo && this.glucoseInfo.label) {
            this.glucoseInfo.label.text = `Error: ${detailedMessage}`;
        }
    }

    _getBackgroundClass(value) {
        const isMmol = this._settings.get_string('unit') === 'mmol/L';
        const numericValue = parseFloat(value);

        const thresholdsMgdl = {
            urgentHigh: this._settings.get_int('urgent-high-threshold'),
            high: this._settings.get_int('high-threshold'),
            low: this._settings.get_int('low-threshold'),
            urgentLow: this._settings.get_int('urgent-low-threshold')
        };

        const thresholds = {};
        if (isMmol) {
            Object.keys(thresholdsMgdl).forEach(key => {
                thresholds[key] = parseFloat((thresholdsMgdl[key] / 18.0).toFixed(1));
            });
        } else {
            Object.assign(thresholds, thresholdsMgdl);
        }

        const colors = {
            urgentHigh: this._settings.get_string('urgent-high-color'),
            high: this._settings.get_string('high-color'),
            normal: this._settings.get_string('normal-color'),
            low: this._settings.get_string('low-color'),
            urgentLow: this._settings.get_string('urgent-low-color')
        };

        const hexToRgba = (hex, alpha) => {
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            return `rgba(${r}, ${g}, ${b}, ${alpha})`;
        };

        if (this._lastLoggedValue !== numericValue) {
            this._log('Color threshold check:', {
                unit: isMmol ? 'mmol/L' : 'mg/dL',
                value: numericValue,
                thresholds: thresholds
            });
            this._lastLoggedValue = numericValue;
        }

        let styleClass = 'libre3view-value-container';
        let color, borderColor;

        const epsilon = isMmol ? 0.05 : 1;

        if (numericValue >= (thresholds.urgentHigh - epsilon)) {
            color = colors.urgentHigh;
            borderColor = hexToRgba(colors.urgentHigh, 0.6);
        } else if (numericValue >= (thresholds.high - epsilon)) {
            color = colors.high;
            borderColor = hexToRgba(colors.high, 0.6);
        } else if (numericValue > (thresholds.low + epsilon)) {
            color = colors.normal;
            borderColor = hexToRgba(colors.normal, 0.6);
        } else if (numericValue > (thresholds.urgentLow + epsilon)) {
            color = colors.low;
            borderColor = hexToRgba(colors.low, 0.6);
        } else {
            color = colors.urgentLow;
            borderColor = hexToRgba(colors.urgentLow, 0.6);
        }

        const style = `color: ${color}; border-color: ${borderColor};`;
        return { styleClass, style };
    }

    _updateIconVisibility() {
        if (this._destroyed || !this.box) {
            return;
        }

        this.box.remove_all_children();
        this.box.style_class = '';
        this.box.set_style('spacing: 2px; padding: 0px 1px;');

        const showIcon = this._settings.get_boolean('show-icon');
        const iconPosition = this._settings.get_string('icon-position');

        if (showIcon && iconPosition.toLowerCase() === 'left') {
            this.icon && this.box.add_child(this.icon);
        }

        if (this._currentReading) {
            const { styleClass, style } = this._getBackgroundClass(this._currentReading.value);

            const valueContainer = new St.Bin({
                style_class: styleClass,
                style: style,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER
            });

            const valueLabel = new St.Label({
                text: `${this._currentReading.value}`,
                y_align: Clutter.ActorAlign.CENTER
            });

            valueContainer.set_child(valueLabel);
            this.box.add_child(valueContainer);

            this._addAdditionalElements(this._currentReading, style);
        } else {
            const label = new St.Label({
                text: 'No Data',
                style_class: 'libre3view-value'
            });
            this.box.add_child(label);
        }

        if (showIcon && iconPosition.toLowerCase() === 'right') {
            this.icon && this.box.add_child(this.icon);
        }
    }

    _addAdditionalElements(reading, style) {
        if (this._settings.get_boolean('show-trend-arrows')) {
            const trendLabel = new St.Label({
                text: this._getTrendArrow(reading.trend),
                style_class: 'libre3view-trend',
                style: style
            });
            this.box.add_child(trendLabel);
        }

        if (this._settings.get_boolean('show-delta')) {
            const deltaValue = parseFloat(reading.delta);
            const deltaLabel = new St.Label({
                text: `${deltaValue > 0 ? '+' : ''}${reading.delta}`,
                style_class: 'libre3view-delta',
                style: style
            });
            this.box.add_child(deltaLabel);
        }

        if (this._settings.get_boolean('show-elapsed-time')) {
            const elapsed = Math.floor((Date.now() - reading.timestamp) / 60000);
            const timeLabel = new St.Label({
                text: `${elapsed}m`,
                style_class: 'libre3view-time',
                style: style
            });
            this.box.add_child(timeLabel);
        }
    }

    _updateDisplay(reading) {
        if (this._destroyed || !this.box) {
            return;
        }

        this.box.remove_all_children();
        this.box.style_class = '';
        this.box.set_style('spacing: 2px; padding: 0px 1px;');

        if (this._settings.get_boolean('show-icon') && this.icon) {
            this.box.add_child(this.icon);
        }

        if (!reading) {
            const label = new St.Label({
                text: 'No Data',
                style_class: 'libre3view-value'
            });
            this.box.add_child(label);
            return;
        }

        this._currentReading = reading;

        const { styleClass, style } = this._getBackgroundClass(reading.value);

        const valueContainer = new St.Bin({
            style_class: styleClass,
            style: style,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        const valueLabel = new St.Label({
            text: `${reading.value}`,
            y_align: Clutter.ActorAlign.CENTER
        });

        valueContainer.set_child(valueLabel);
        this.box.add_child(valueContainer);

        if (this._settings.get_boolean('show-trend-arrows')) {
            const trendLabel = new St.Label({
                text: this._getTrendArrow(reading.trend),
                style_class: 'libre3view-trend',
                style: style
            });
            this.box.add_child(trendLabel);
        }

        if (this._settings.get_boolean('show-delta')) {
            const deltaValue = parseFloat(reading.delta);
            const deltaLabel = new St.Label({
                text: `${deltaValue > 0 ? '+' : ''}${reading.delta}`,
                style_class: 'libre3view-delta',
                style: style
            });
            this.box.add_child(deltaLabel);
        }

        if (this._settings.get_boolean('show-elapsed-time')) {
            const elapsed = Math.floor((Date.now() - reading.timestamp) / 60000);
            const timeLabel = new St.Label({
                text: `${elapsed}m`,
                style_class: 'libre3view-time',
                style: style
            });
            this.box.add_child(timeLabel);
        }
    }

    _buildMenu() {
        this.glucoseInfo = new PopupMenu.PopupMenuItem('Loading...', {
            reactive: false,
            style_class: 'libre3view-menu-item'
        });
        this.menu.addMenuItem(this.glucoseInfo);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const displayOptionsLabel = new PopupMenu.PopupMenuItem('Display Options:', {
            reactive: false,
            style_class: 'libre3view-menu-header'
        });
        this.menu.addMenuItem(displayOptionsLabel);

        this._addToggleMenuItem('Show Delta', 'show-delta');
        this._addToggleMenuItem('Show Trend Arrows', 'show-trend-arrows');
        this._addToggleMenuItem('Show Elapsed Time', 'show-elapsed-time');
        this._addToggleMenuItem('Show Icon', 'show-icon');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshButton = new PopupMenu.PopupMenuItem('Refresh Now', {
            style_class: 'libre3view-refresh-button'
        });
        refreshButton.connect('activate', () => {
            this.glucoseInfo.label.text = 'Refreshing...';
            this._updateReading();
        });
        this.menu.addMenuItem(refreshButton);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const settingsButton = new PopupMenu.PopupMenuItem('Open Settings', {
            style_class: 'libre3view-settings-button'
        });
        settingsButton.connect('activate', () => {
            if (this.extension) {
                this.extension.openPreferences();
            }
        });
        this.menu.addMenuItem(settingsButton);
    }

    _updateMenuInfo(reading) {
        if (this._destroyed || !this.glucoseInfo || !this.glucoseInfo.label) {
            return;
        }

        if (!reading) {
            this.glucoseInfo.label.text = 'No data available';
            return;
        }

        const unit = this._settings.get_string('unit');
        const time = new Date(reading.timestamp).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });

        const trendMap = {
            'NONE': 'Stable',
            'DOUBLE_UP': 'Rising Rapidly',
            'SINGLE_UP': 'Rising',
            'FORTY_FIVE_UP': 'Rising Slowly',
            'FLAT': 'Stable',
            'FORTY_FIVE_DOWN': 'Falling Slowly',
            'SINGLE_DOWN': 'Falling',
            'DOUBLE_DOWN': 'Falling Rapidly',
            'NOT_COMPUTABLE': 'Unable to Determine',
            'RATE_OUT_OF_RANGE': 'Out of Range'
        };

        const trendDescription = trendMap[reading.trend] || 'Unknown';
        const deltaValue = parseFloat(reading.delta);

        const info = [
            `Last Reading: ${reading.value} ${unit}`,
            `Time: ${time}`,
            `Trend: ${trendDescription}`,
            `Delta: ${deltaValue > 0 ? '+' : ''}${reading.delta} ${unit}`
        ].join('\n');

        this.glucoseInfo.label.text = info;
    }

    _getTrendArrow(trend) {
        const arrows = {
            'NONE': '→',
            'DOUBLE_UP': '⇈',
            'SINGLE_UP': '↑',
            'FORTY_FIVE_UP': '↗',
            'FLAT': '→',
            'FORTY_FIVE_DOWN': '↘',
            'SINGLE_DOWN': '↓',
            'DOUBLE_DOWN': '⇊',
            'NOT_COMPUTABLE': '-',
            'RATE_OUT_OF_RANGE': '?'
        };
        return arrows[trend] || '-';
    }

    destroy() {
        this._destroyed = true;

       
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = null;
        }

       
        if (this._signalHandlers) {
            this._signalHandlers.forEach(handlerId => {
                this._settings.disconnect(handlerId);
            });
            this._signalHandlers = [];
        }

       
        if (this._cgmClient && this._cgmClient.destroy) {
            this._cgmClient.destroy();
            this._cgmClient = null;
        }

       
        if (this._dexcomUploader && this._dexcomUploader.destroy) {
            this._dexcomUploader.destroy();
            this._dexcomUploader = null;
        }
        if (this._dexcomUploader2 && this._dexcomUploader2.destroy) {
            this._dexcomUploader2.destroy();
            this._dexcomUploader2 = null;
        }

        super.destroy();
    }
});

export default class Libre3ViewExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new Libre3ViewIndicator(this._settings);
        this._indicator.setPath(this.path);
        this._indicator.extension = this;
        Main.panel.addToStatusArea('libre3view-indicator', this._indicator);
    }

    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }

        if (this._settings) {
            this._settings = null;
        }
    }
}
