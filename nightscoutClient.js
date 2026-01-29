'use strict';

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import Gio from 'gi://Gio';

export class NightscoutClient {
    constructor(url, apiSecret, unit = 'mg/dL', settings = null) {
        this._settings = settings;

       
        this._maskSensitiveData = (data) => {
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    return JSON.stringify(this._maskSensitiveData(parsed));
                } catch {
                    return data;
                }
            }
            if (typeof data !== 'object' || data === null) {
                return data;
            }
            const sensitiveKeys = ['api-secret', 'apiSecret', 'token', 'password'];
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
            if (this._settings && this._settings.get_boolean('enable-debug-logs')) {
                if (data) {
                    const maskedData = this._maskSensitiveData(data);
                    console.log(`[NightscoutClient] ${message}`, maskedData);
                } else {
                    console.log(`[NightscoutClient] ${message}`);
                }
            }
        };

       
        this._baseUrl = url ? url.replace(/\/$/, '') : '';
        this._apiSecret = apiSecret || '';
        this._unit = unit;

       
        this._session = new Soup.Session();
        this._session.timeout = 30;

       
       
       
        if (this._settings && this._settings.get_boolean('skip-tls-verification')) {
            this._session.ssl_strict = false;
            this._log('WARNING: TLS certificate verification disabled (less secure)');
        }

       
        this._previousReading = null;
        this._previousDelta = null;

        this._log('NightscoutClient initialized:', {
            baseUrl: this._baseUrl,
            unit: this._unit,
            hasApiSecret: !!this._apiSecret
        });
    }

    async _makeRequest(url, method = 'GET') {
        try {
            const message = new Soup.Message({
                method,
                uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
            });

            const headers = message.get_request_headers();
            headers.append('Content-Type', 'application/json');
            headers.append('Accept', 'application/json');

           
            if (this._apiSecret) {
                headers.append('api-secret', this._apiSecret);
            }

            this._log(`Making request to: ${url}`);

            const response = await this._session.send_and_read_async(message,
                GLib.PRIORITY_DEFAULT, null);

            const statusCode = message.status_code;
            const responseText = new TextDecoder().decode(response.get_data());

            this._log(`Response status: ${statusCode}`);

            if (statusCode === 200) {
                try {
                    return JSON.parse(responseText);
                } catch {
                    return responseText;
                }
            }

           
            if (statusCode === 401) {
                throw new Error('UNAUTHORIZED: Invalid API secret. Please check your Nightscout API secret.');
            }

            if (statusCode === 429) {
                throw new Error('RATE_LIMITED: Too many requests. Please wait a few minutes before trying again.');
            }

            if (statusCode === 404) {
                throw new Error('NOT_FOUND: Nightscout URL not found. Please check your Nightscout URL.');
            }

            throw new Error(`Request failed with status ${statusCode}: ${responseText}`);

        } catch (error) {
            this._log('Request failed:', error);

           
            const errorString = error.toString();
            if (errorString.includes('Gio.TlsError') ||
                errorString.includes('TLS') ||
                errorString.includes('certificate')) {
                throw new Error('TLS_ERROR: Invalid or self-signed SSL certificate. If using a local Nightscout instance, enable "Ignore TLS Errors" in settings.');
            }

           
            if (errorString.includes('Gio.IOErrorEnum') ||
                errorString.includes('No route to host') ||
                errorString.includes('timed out') ||
                errorString.includes('Could not connect')) {
                throw new Error('NETWORK_ERROR: Connection failed. Please check your internet connection and Nightscout URL.');
            }

            throw error;
        }
    }

    async getLatestGlucose() {
        try {
            if (!this._baseUrl) {
                throw new Error('Nightscout URL is not configured');
            }

           
            const url = `${this._baseUrl}/api/v1/entries/current.json`;
            this._log('[DEBUG] Fetching from Nightscout:', url);

            const entries = await this._makeRequest(url, 'GET');
            this._log('[DEBUG] Raw Nightscout response:', JSON.stringify(entries));

           
            let entry;
            if (Array.isArray(entries)) {
                if (entries.length === 0) {
                    throw new Error('No readings available');
                }
                entry = entries[0];
            } else if (entries && entries.sgv !== undefined) {
                entry = entries;
            } else {
                throw new Error('Invalid response format from Nightscout');
            }

            this._log('[DEBUG] Processing entry:', JSON.stringify(entry));
            const reading = this._formatReading(entry);
            return reading;

        } catch (error) {
            this._log('[DEBUG] Error in getLatestGlucose:', error.message);
            throw error;
        }
    }

    _formatReading(entry) {
       
        let timestamp;
        if (entry.mills) {
            timestamp = entry.mills;
        } else if (entry.date) {
            timestamp = entry.date;
        } else if (entry.dateString) {
            timestamp = new Date(entry.dateString).getTime();
        } else {
            timestamp = Date.now();
        }

       
        let value = entry.sgv;
        if (this._unit === 'mmol/L') {
            value = (entry.sgv / 18.0).toFixed(1);
        }

       
        let delta = 0;
        const trend = this._mapDirection(entry.direction);

        if (this._previousReading) {
            const prevTimestamp = this._previousReading.mills || this._previousReading.date;
            const timeDiff = timestamp - prevTimestamp;

           
            if (timeDiff <= 900000) {
                const prevValue = this._previousReading.sgv;
                delta = entry.sgv - prevValue;

                if (this._unit === 'mmol/L') {
                    delta = (delta / 18.0);
                }
            }
        }

       
        if (delta === 0 && this._previousDelta) {
            if (Math.abs(this._previousDelta) <= 2.0) {
                delta = this._previousDelta;
                this._log('[DEBUG] Preserving previous delta:', delta);
            }
        }

       
        if (delta === 0) {
            const trendDeltas = {
                'DOUBLE_UP': this._unit === 'mmol/L' ? 0.17 : 3.0,
                'SINGLE_UP': this._unit === 'mmol/L' ? 0.11 : 2.0,
                'FORTY_FIVE_UP': this._unit === 'mmol/L' ? 0.06 : 1.0,
                'FLAT': 0.0,
                'FORTY_FIVE_DOWN': this._unit === 'mmol/L' ? -0.06 : -1.0,
                'SINGLE_DOWN': this._unit === 'mmol/L' ? -0.11 : -2.0,
                'DOUBLE_DOWN': this._unit === 'mmol/L' ? -0.17 : -3.0
            };
            delta = trendDeltas[trend] || 0;
        }

       
        const finalTrend = this._correctTrend(trend, delta);

       
        this._previousReading = {...entry, mills: timestamp};
        this._previousDelta = delta;

        const formattedReading = {
            value: value,
            unit: this._unit,
            trend: finalTrend,
            timestamp: new Date(timestamp),
            delta: Number(delta).toFixed(1)
        };

        this._log('[DEBUG] Formatted reading:', formattedReading);
        return formattedReading;
    }

    _mapDirection(direction) {
        if (!direction) return 'FLAT';

       
        const directionMap = {
           
            'DoubleUp': 'DOUBLE_UP',
            'SingleUp': 'SINGLE_UP',
            'FortyFiveUp': 'FORTY_FIVE_UP',
            'Flat': 'FLAT',
            'FortyFiveDown': 'FORTY_FIVE_DOWN',
            'SingleDown': 'SINGLE_DOWN',
            'DoubleDown': 'DOUBLE_DOWN',
            'NOT COMPUTABLE': 'NOT_COMPUTABLE',
            'RATE OUT OF RANGE': 'RATE_OUT_OF_RANGE',
            'None': 'FLAT',

           
            'DOUBLE_UP': 'DOUBLE_UP',
            'SINGLE_UP': 'SINGLE_UP',
            'FORTY_FIVE_UP': 'FORTY_FIVE_UP',
            'FLAT': 'FLAT',
            'FORTY_FIVE_DOWN': 'FORTY_FIVE_DOWN',
            'SINGLE_DOWN': 'SINGLE_DOWN',
            'DOUBLE_DOWN': 'DOUBLE_DOWN',

           
            'DoubleUp': 'DOUBLE_UP',
            'SingleUp': 'SINGLE_UP',
            'FortyFiveUp': 'FORTY_FIVE_UP',
            'FortyFiveDown': 'FORTY_FIVE_DOWN',
            'SingleDown': 'SINGLE_DOWN',
            'DoubleDown': 'DOUBLE_DOWN'
        };

        return directionMap[direction] || 'FLAT';
    }

    _correctTrend(trend, delta) {
        let correctedTrend = trend;

        if (delta < -3.0 && (trend === 'FLAT' || trend === 'FORTY_FIVE_UP' || trend === 'SINGLE_UP')) {
            correctedTrend = 'SINGLE_DOWN';
            this._log('[DEBUG] Trend corrected: Large negative delta -> SINGLE_DOWN');
        } else if (delta < -1.0 && trend === 'FLAT') {
            correctedTrend = 'FORTY_FIVE_DOWN';
            this._log('[DEBUG] Trend corrected: Small negative delta -> FORTY_FIVE_DOWN');
        } else if (delta > 1.0 && delta < 3.0 && trend === 'FLAT') {
            correctedTrend = 'FORTY_FIVE_UP';
            this._log('[DEBUG] Trend corrected: Small positive delta -> FORTY_FIVE_UP');
        } else if (delta > 3.0 && (trend === 'FLAT' || trend === 'FORTY_FIVE_DOWN' || trend === 'SINGLE_DOWN')) {
            correctedTrend = 'SINGLE_UP';
            this._log('[DEBUG] Trend corrected: Large positive delta -> SINGLE_UP');
        }

        return correctedTrend;
    }
}
