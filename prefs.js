import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class Libre3ViewPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

       
        const accountPage = new Adw.PreferencesPage({
            title: 'Account',
            icon_name: 'system-users-symbolic',
        });

        const thresholdPage = new Adw.PreferencesPage({
            title: 'Thresholds',
            icon_name: 'preferences-system-symbolic',
        });

        const displayPage = new Adw.PreferencesPage({
            title: 'Display',
            icon_name: 'preferences-desktop-display-symbolic',
        });

        const advancedPage = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'applications-engineering-symbolic',
        });

        window.add(accountPage);
        window.add(thresholdPage);
        window.add(displayPage);
        window.add(advancedPage);

       
        this._addAccountGroup(accountPage, settings);
        this._addThresholdGroup(thresholdPage, settings);
        this._addColorGroup(thresholdPage, settings);
        this._addDisplayOptionsGroup(displayPage, settings);
        this._addAdvancedOptionsGroup(advancedPage, settings);
    }

    _addAccountGroup(page, settings) {
       
        const sourceGroup = new Adw.PreferencesGroup({
            title: 'Data Source',
            description: 'Select your CGM data source',
        });

        const sourceRow = new Adw.ActionRow({ title: 'Data Source' });
        const sourceCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        sourceCombo.append('libreview', 'LibreView');
        sourceCombo.append('dexcom', 'Dexcom Share');
        sourceCombo.append('nightscout', 'Nightscout');

        sourceCombo.set_active_id(settings.get_string('data-source'));
        sourceCombo.connect('changed', () => {
            settings.set_string('data-source', sourceCombo.get_active_id());
            this._updateSourceVisibility(settings);
        });

        sourceRow.add_suffix(sourceCombo);
        sourceGroup.add(sourceRow);
        page.add(sourceGroup);

       
        this._libreviewGroup = new Adw.PreferencesGroup({
            title: 'LibreView Account',
            description: 'Enter your LibreView credentials',
        });

        const libreEmailRow = new Adw.EntryRow({
            title: 'Email',
        });
        libreEmailRow.connect('changed', () => {
            settings.set_string('libreview-email', libreEmailRow.get_text());
        });
        libreEmailRow.set_text(settings.get_string('libreview-email'));
        this._libreviewGroup.add(libreEmailRow);

        const librePasswordRow = new Adw.PasswordEntryRow({
            title: 'Password',
        });
        librePasswordRow.connect('changed', () => {
            settings.set_string('libreview-password', librePasswordRow.get_text());
        });
        librePasswordRow.set_text(settings.get_string('libreview-password'));
        this._libreviewGroup.add(librePasswordRow);

       
        const libreRegionRow = new Adw.ActionRow({
            title: 'Region',
            subtitle: 'Leave empty for automatic detection',
        });
        const libreRegionCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        libreRegionCombo.append('', 'Auto-detect');
        libreRegionCombo.append('AE', 'AE - United Arab Emirates');
        libreRegionCombo.append('AP', 'AP - Asia Pacific');
        libreRegionCombo.append('AU', 'AU - Australia');
        libreRegionCombo.append('CA', 'CA - Canada');
        libreRegionCombo.append('DE', 'DE - Germany');
        libreRegionCombo.append('EU', 'EU - Europe');
        libreRegionCombo.append('EU2', 'EU2 - Europe 2');
        libreRegionCombo.append('FR', 'FR - France');
        libreRegionCombo.append('JP', 'JP - Japan');
        libreRegionCombo.append('US', 'US - United States');

        const currentLibreRegion = settings.get_string('libreview-region');
        libreRegionCombo.set_active_id(currentLibreRegion || '');
        libreRegionCombo.connect('changed', () => {
            const selectedRegion = libreRegionCombo.get_active_id() || '';
            settings.set_string('libreview-region', selectedRegion);
        });

        libreRegionRow.add_suffix(libreRegionCombo);
        this._libreviewGroup.add(libreRegionRow);

        page.add(this._libreviewGroup);

       
        this._dexcomGroup = new Adw.PreferencesGroup({
            title: 'Dexcom Share Account',
            description: 'Enter your Dexcom Share credentials',
        });

        const usernameRow = new Adw.EntryRow({
            title: 'Username',
        });
        usernameRow.connect('changed', () => {
            settings.set_string('username', usernameRow.get_text());
        });
        usernameRow.set_text(settings.get_string('username'));
        this._dexcomGroup.add(usernameRow);

        const passwordRow = new Adw.PasswordEntryRow({
            title: 'Password',
        });
        passwordRow.connect('changed', () => {
            settings.set_string('password', passwordRow.get_text());
        });
        passwordRow.set_text(settings.get_string('password'));
        this._dexcomGroup.add(passwordRow);

        const regionRow = new Adw.ActionRow({ title: 'Region' });
        const regionCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        regionCombo.append('US', 'United States');
        regionCombo.append('Non-US', 'Outside US');

        regionCombo.set_active_id(settings.get_string('region'));
        regionCombo.connect('changed', () => {
            settings.set_string('region', regionCombo.get_active_id());
        });

        regionRow.add_suffix(regionCombo);
        this._dexcomGroup.add(regionRow);

        page.add(this._dexcomGroup);

       
        this._nightscoutGroup = new Adw.PreferencesGroup({
            title: 'Nightscout Settings',
            description: 'Enter your Nightscout server details',
        });

        const urlRow = new Adw.EntryRow({
            title: 'Nightscout URL',
        });
        urlRow.connect('changed', () => {
            settings.set_string('nightscout-url', urlRow.get_text());
        });
        urlRow.set_text(settings.get_string('nightscout-url'));
        this._nightscoutGroup.add(urlRow);

        const apiSecretRow = new Adw.PasswordEntryRow({
            title: 'API Secret',
        });
        apiSecretRow.connect('changed', () => {
            settings.set_string('nightscout-api-secret', apiSecretRow.get_text());
        });
        apiSecretRow.set_text(settings.get_string('nightscout-api-secret'));
        this._nightscoutGroup.add(apiSecretRow);

       
        const tlsRow = new Adw.ActionRow({
            title: 'Skip TLS Verification',
            subtitle: 'Disable certificate validation for self-signed certificates (WARNING: Less secure)',
        });
        const tlsSwitch = new Gtk.Switch({
            active: settings.get_boolean('skip-tls-verification'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('skip-tls-verification', tlsSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        tlsRow.add_suffix(tlsSwitch);
        this._nightscoutGroup.add(tlsRow);

        page.add(this._nightscoutGroup);

       
        this._dexcomUploadGroup = new Adw.PreferencesGroup({
            title: 'Dexcom Share Upload',
            description: 'Upload LibreView readings to Dexcom Share',
        });

        const enableUploadRow = new Adw.ActionRow({
            title: 'Enable Upload',
            subtitle: 'Send glucose readings to Dexcom Share',
        });
        const enableUploadSwitch = new Gtk.Switch({
            active: settings.get_boolean('enable-dexcom-upload'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('enable-dexcom-upload', enableUploadSwitch, 'active', Gio.SettingsBindFlags.DEFAULT);
        enableUploadRow.add_suffix(enableUploadSwitch);
        this._dexcomUploadGroup.add(enableUploadRow);

        const uploadUsernameRow = new Adw.EntryRow({
            title: 'Dexcom Username',
        });
        uploadUsernameRow.connect('changed', () => {
            settings.set_string('dexcom-upload-username', uploadUsernameRow.get_text());
        });
        uploadUsernameRow.set_text(settings.get_string('dexcom-upload-username'));
        this._dexcomUploadGroup.add(uploadUsernameRow);

        const uploadPasswordRow = new Adw.PasswordEntryRow({
            title: 'Dexcom Password',
        });
        uploadPasswordRow.connect('changed', () => {
            settings.set_string('dexcom-upload-password', uploadPasswordRow.get_text());
        });
        uploadPasswordRow.set_text(settings.get_string('dexcom-upload-password'));
        this._dexcomUploadGroup.add(uploadPasswordRow);

        const uploadRegionRow = new Adw.ActionRow({ title: 'Region' });
        const uploadRegionCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        uploadRegionCombo.append('US', 'United States');
        uploadRegionCombo.append('Non-US', 'Outside US');

        uploadRegionCombo.set_active_id(settings.get_string('dexcom-upload-region'));
        uploadRegionCombo.connect('changed', () => {
            settings.set_string('dexcom-upload-region', uploadRegionCombo.get_active_id());
        });

        uploadRegionRow.add_suffix(uploadRegionCombo);
        this._dexcomUploadGroup.add(uploadRegionRow);

        page.add(this._dexcomUploadGroup);

       
        this._dexcomUploadGroup2 = new Adw.PreferencesGroup({
            title: 'Dexcom Share Mirror',
            description: 'Mirror Dexcom readings to a second Dexcom Share account (different region)',
        });

        const enableUploadRow2 = new Adw.ActionRow({
            title: 'Enable Mirror',
            subtitle: 'Mirror readings to second Dexcom Share account',
        });
        const enableUploadSwitch2 = new Gtk.Switch({
            active: settings.get_boolean('enable-dexcom-upload-2'),
            valign: Gtk.Align.CENTER,
        });
        settings.bind('enable-dexcom-upload-2', enableUploadSwitch2, 'active', Gio.SettingsBindFlags.DEFAULT);
        enableUploadRow2.add_suffix(enableUploadSwitch2);
        this._dexcomUploadGroup2.add(enableUploadRow2);

        const uploadUsernameRow2 = new Adw.EntryRow({
            title: 'Dexcom Username',
        });
        uploadUsernameRow2.connect('changed', () => {
            settings.set_string('dexcom-upload-username-2', uploadUsernameRow2.get_text());
        });
        uploadUsernameRow2.set_text(settings.get_string('dexcom-upload-username-2'));
        this._dexcomUploadGroup2.add(uploadUsernameRow2);

        const uploadPasswordRow2 = new Adw.PasswordEntryRow({
            title: 'Dexcom Password',
        });
        uploadPasswordRow2.connect('changed', () => {
            settings.set_string('dexcom-upload-password-2', uploadPasswordRow2.get_text());
        });
        uploadPasswordRow2.set_text(settings.get_string('dexcom-upload-password-2'));
        this._dexcomUploadGroup2.add(uploadPasswordRow2);

        const uploadRegionRow2 = new Adw.ActionRow({ title: 'Region' });
        const uploadRegionCombo2 = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        uploadRegionCombo2.append('US', 'United States');
        uploadRegionCombo2.append('Non-US', 'Outside US');

        uploadRegionCombo2.set_active_id(settings.get_string('dexcom-upload-region-2'));
        uploadRegionCombo2.connect('changed', () => {
            settings.set_string('dexcom-upload-region-2', uploadRegionCombo2.get_active_id());
        });

        uploadRegionRow2.add_suffix(uploadRegionCombo2);
        this._dexcomUploadGroup2.add(uploadRegionRow2);

        page.add(this._dexcomUploadGroup2);

       
        const commonGroup = new Adw.PreferencesGroup({
            title: 'Common Settings',
            description: 'General glucose monitoring settings',
        });

        const unitRow = new Adw.ActionRow({ title: 'Glucose Unit' });
        const unitCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        unitCombo.append('mg/dL', 'mg/dL');
        unitCombo.append('mmol/L', 'mmol/L');

        unitCombo.set_active_id(settings.get_string('unit'));
        unitCombo.connect('changed', () => {
            settings.set_string('unit', unitCombo.get_active_id());
        });

        unitRow.add_suffix(unitCombo);
        commonGroup.add(unitRow);

        this._addSpinButton(commonGroup, settings, 'update-interval',
            'Update Interval (seconds)', 60, 600, 30);

        page.add(commonGroup);

       
        this._accountPage = page;
        this._settings = settings;
        this._updateSourceVisibility(settings);
    }

    _updateSourceVisibility(settings) {
        const source = settings.get_string('data-source');

        if (this._libreviewGroup) {
            this._libreviewGroup.visible = (source === 'libreview');
        }
        if (this._dexcomGroup) {
            this._dexcomGroup.visible = (source === 'dexcom');
        }
        if (this._nightscoutGroup) {
            this._nightscoutGroup.visible = (source === 'nightscout');
        }
        if (this._dexcomUploadGroup) {
           
            this._dexcomUploadGroup.visible = (source === 'libreview');
        }
        if (this._dexcomUploadGroup2) {
           
            this._dexcomUploadGroup2.visible = (source === 'dexcom');
        }
    }

    _addThresholdGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Glucose Thresholds',
            description: `Set glucose threshold values (${settings.get_string('unit')})`,
        });

        const convertValue = (value, toMmol = false) => {
            if (toMmol) {
                return Math.round((value / 18.0) * 10) / 10;
            }
            return Math.round(value * 18.0);
        };

        const currentUnit = settings.get_string('unit');
        const isMmol = currentUnit === 'mmol/L';

        const ranges = isMmol ? {
            urgentHigh: { min: 10.0, max: 22.2, increment: 0.1 },
            high: { min: 7.8, max: 16.7, increment: 0.1 },
            low: { min: 3.3, max: 6.7, increment: 0.1 },
            urgentLow: { min: 2.2, max: 4.4, increment: 0.1 }
        } : {
            urgentHigh: { min: 180, max: 400, increment: 1 },
            high: { min: 140, max: 300, increment: 1 },
            low: { min: 60, max: 120, increment: 1 },
            urgentLow: { min: 40, max: 80, increment: 1 }
        };

        this._addSpinButton(group, settings, 'urgent-high-threshold',
            'Urgent High Threshold',
            ranges.urgentHigh.min,
            ranges.urgentHigh.max,
            ranges.urgentHigh.increment,
            isMmol);

        this._addSpinButton(group, settings, 'high-threshold',
            'High Threshold',
            ranges.high.min,
            ranges.high.max,
            ranges.high.increment,
            isMmol);

        this._addSpinButton(group, settings, 'low-threshold',
            'Low Threshold',
            ranges.low.min,
            ranges.low.max,
            ranges.low.increment,
            isMmol);

        this._addSpinButton(group, settings, 'urgent-low-threshold',
            'Urgent Low Threshold',
            ranges.urgentLow.min,
            ranges.urgentLow.max,
            ranges.urgentLow.increment,
            isMmol);

        settings.connect('changed::unit', () => {
            const newUnit = settings.get_string('unit');
            const switchingToMmol = newUnit === 'mmol/L';

            group.description = `Set glucose threshold values (${newUnit})`;

            ['urgent-high-threshold', 'high-threshold', 'low-threshold', 'urgent-low-threshold'].forEach(key => {
                const currentValue = settings.get_int(key);
                const convertedValue = convertValue(currentValue, switchingToMmol);
                settings.set_int(key, convertedValue);
            });

            page.remove(group);
            this._addThresholdGroup(page, settings);
        });

        page.add(group);
    }

    _addColorGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Threshold Colors',
            description: 'Customize colors for different glucose ranges',
        });

        this._addColorButton(group, settings, 'urgent-high-color', 'Urgent High Color');
        this._addColorButton(group, settings, 'high-color', 'High Color');
        this._addColorButton(group, settings, 'normal-color', 'Normal Color');
        this._addColorButton(group, settings, 'low-color', 'Low Color');
        this._addColorButton(group, settings, 'urgent-low-color', 'Urgent Low Color');

        page.add(group);
    }

    _addDisplayOptionsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Display Options',
            description: 'Configure what information to show in the panel',
        });

        this._addSwitch(group, settings, 'show-delta', 'Show Delta');
        this._addSwitch(group, settings, 'show-trend-arrows', 'Show Trend Arrows');
        this._addSwitch(group, settings, 'show-elapsed-time', 'Show Elapsed Time');
        this._addSwitch(group, settings, 'show-icon', 'Show Icon');

        const iconPosRow = new Adw.ActionRow({ title: 'Icon Position' });
        const iconPosCombo = new Gtk.ComboBoxText({
            valign: Gtk.Align.CENTER,
        });

        iconPosCombo.append('left', 'Left');
        iconPosCombo.append('right', 'Right');

        iconPosCombo.set_active_id(settings.get_string('icon-position'));
        iconPosCombo.connect('changed', () => {
            settings.set_string('icon-position', iconPosCombo.get_active_id());
        });

        iconPosRow.add_suffix(iconPosCombo);
        group.add(iconPosRow);

        page.add(group);
    }

    _addSpinButton(group, settings, key, title, min, max, increment, isMmol = false) {
        const row = new Adw.ActionRow({ title });
        const spinButton = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({
                lower: min,
                upper: max,
                step_increment: increment,
                page_increment: increment * 10,
                page_size: 0
            }),
            valign: Gtk.Align.CENTER,
            digits: isMmol ? 1 : 0,
            numeric: true
        });

        const storedValue = settings.get_int(key);
        if (isMmol) {
            spinButton.set_value(storedValue / 18.0);
        } else {
            spinButton.set_value(storedValue);
        }

        spinButton.connect('value-changed', () => {
            let value = spinButton.get_value();
            if (isMmol) {
                value = Math.round(value * 18.0);
            }
            settings.set_int(key, value);

            this._validateThresholds(settings, key, value);
        });

        row.add_suffix(spinButton);
        group.add(row);
    }

    _validateThresholds(settings, key, value) {
        const urgentHigh = settings.get_int('urgent-high-threshold');
        const high = settings.get_int('high-threshold');
        const low = settings.get_int('low-threshold');
        const urgentLow = settings.get_int('urgent-low-threshold');

        switch (key) {
            case 'urgent-high-threshold':
                if (value <= high) {
                    settings.set_int(key, high + 1);
                }
                break;
            case 'high-threshold':
                if (value >= urgentHigh) {
                    settings.set_int(key, urgentHigh - 1);
                } else if (value <= low) {
                    settings.set_int(key, low + 1);
                }
                break;
            case 'low-threshold':
                if (value >= high) {
                    settings.set_int(key, high - 1);
                } else if (value <= urgentLow) {
                    settings.set_int(key, urgentLow + 1);
                }
                break;
            case 'urgent-low-threshold':
                if (value >= low) {
                    settings.set_int(key, low - 1);
                }
                break;
        }
    }

    _addColorButton(group, settings, key, title) {
        const row = new Adw.ActionRow({ title });
        const button = new Gtk.ColorButton({
            valign: Gtk.Align.CENTER,
        });

        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string(key));
        button.set_rgba(rgba);

        button.connect('color-set', () => {
            const color = button.get_rgba().to_string();
            settings.set_string(key, color);
        });

        row.add_suffix(button);
        group.add(row);
    }

    _addSwitch(group, settings, key, title) {
        const row = new Adw.ActionRow({ title });
        const toggle = new Gtk.Switch({
            active: settings.get_boolean(key),
            valign: Gtk.Align.CENTER,
        });

        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);
        group.add(row);
    }

    _addAdvancedOptionsGroup(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Developer Options',
            description: 'Advanced settings for troubleshooting',
        });

        this._addSwitch(group, settings, 'enable-debug-logs', 'Enable Debug Logs');

        page.add(group);
    }
}
