'use strict';

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

const DEFAULT_API_URL = 'https://api.libreview.io';

// LibreView API Headers
const API_HEADERS = {
    'product': 'llu.android',
    'version': '4.16.0',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    'Content-Type': 'application/json',
    'Accept': 'application/json'
};

// Trend arrow mapping for LibreView
const TREND_MAP = {
    1: 'DOUBLE_DOWN',
    2: 'SINGLE_DOWN',
    3: 'FORTY_FIVE_DOWN',
    4: 'FLAT',
    5: 'FORTY_FIVE_UP',
    6: 'SINGLE_UP',
    7: 'DOUBLE_UP'
};

export class LibreViewClient {
    constructor(email, password, unit = 'mg/dL', settings = null, region = null) {
        this._email = email;
        this._password = password;
        this._unit = unit;
        this._settings = settings;

        this._token = null;
       
       
        this._region = region ? region.toLowerCase() : null;
        this._manualRegion = !!region;
        this._hashedAccountId = null;
        this._patientId = null;
        this._previousReading = null;
        this._previousDelta = null;

        this._session = new Soup.Session();
        this._session.timeout = 30;

       
        this._maskSensitiveData = (data) => {
            if (typeof data === 'string') {
                try {
                    const parsed = JSON.parse(data);
                    return JSON.stringify(this._maskSensitiveData(parsed));
                } catch {
                   
                    return data.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '***-****-****-****-************');
                }
            }
            if (typeof data !== 'object' || data === null) {
                return data;
            }
            const sensitiveKeys = ['password', 'email', 'token', 'firstName', 'lastName',
                                   'accountId', 'patientId', 'id', 'sn', 'deviceId',
                                   'account-id', 'hashedAccountId'];
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
                    console.log(`[LibreViewClient] ${message}`, maskedData);
                } else {
                    console.log(`[LibreViewClient] ${message}`);
                }
            }
        };

        this._log('LibreViewClient initialized:', {
            email: email ? `${email.substring(0, 3)}***` : 'not set',
            unit: this._unit,
            region: this._region || 'auto-detect',
            manualRegion: this._manualRegion
        });
    }

    _getBaseUrl() {
        if (this._region) {
            return `https://api-${this._region}.libreview.io`;
        }
        return DEFAULT_API_URL;
    }

    async _makeRequest(url, method = 'GET', body = null, includeAuth = false) {
        return new Promise((resolve, reject) => {
            try {
                const message = Soup.Message.new(method, url);

               
                const headers = message.get_request_headers();
                Object.entries(API_HEADERS).forEach(([key, value]) => {
                    headers.append(key, value);
                });

               
                if (includeAuth && this._token) {
                    headers.append('Authorization', `Bearer ${this._token}`);
                    if (this._hashedAccountId) {
                        headers.append('account-id', this._hashedAccountId);
                    }
                }

               
                if (body && method !== 'GET') {
                    const jsonStr = JSON.stringify(body);
                    const bytes = new TextEncoder().encode(jsonStr);
                    message.set_request_body_from_bytes('application/json', new GLib.Bytes(bytes));
                    this._log(`Request body: ${JSON.stringify(this._maskSensitiveData(body))}`);
                }

                this._log(`Making ${method} request to: ${url}`);

                this._session.send_and_read_async(
                    message,
                    GLib.PRIORITY_DEFAULT,
                    null,
                    (session, result) => {
                        try {
                            const bytes = session.send_and_read_finish(result);
                            const statusCode = message.status_code;
                            const responseText = new TextDecoder().decode(bytes.get_data());

                            this._log(`Response status: ${statusCode}`);

                            if (statusCode === 200) {
                                try {
                                    resolve(JSON.parse(responseText));
                                } catch {
                                    resolve(responseText);
                                }
                            } else if (statusCode === 401) {
                                reject(new Error('AUTH_ERROR: Invalid credentials or session expired'));
                            } else if (statusCode === 429) {
                                reject(new Error('RATE_LIMITED: Too many requests. Please wait before retrying.'));
                            } else if (statusCode === 404) {
                                reject(new Error('NOT_FOUND: API endpoint not found'));
                            } else {
                                reject(new Error(`Request failed with status ${statusCode}: ${responseText}`));
                            }
                        } catch (error) {
                            this._log('Request error:', error.message);
                            reject(this._handleNetworkError(error));
                        }
                    }
                );
            } catch (error) {
                this._log('Request setup error:', error.message);
                reject(this._handleNetworkError(error));
            }
        });
    }

    _handleNetworkError(error) {
        const errorString = error.toString();

        if (errorString.includes('Gio.TlsError') ||
            errorString.includes('TLS') ||
            errorString.includes('certificate')) {
            return new Error('TLS_ERROR: SSL certificate error. Check your network connection.');
        }

        if (errorString.includes('Gio.IOErrorEnum') ||
            errorString.includes('No route to host') ||
            errorString.includes('timed out') ||
            errorString.includes('Could not connect')) {
            return new Error('NETWORK_ERROR: Connection failed. Please check your internet connection.');
        }

        return error;
    }

    async authenticate() {
        try {
            if (!this._email || !this._password) {
                throw new Error('AUTH_ERROR: Email and password are required');
            }

            this._log('Starting authentication...');

            const url = `${this._getBaseUrl()}/llu/auth/login`;
            const payload = {
                email: this._email,
                password: this._password
            };

            const response = await this._makeRequest(url, 'POST', payload, false);

           
            if (response.data && response.data.redirect && !this._manualRegion) {
                this._region = response.data.region;
                this._log(`Redirecting to region: ${this._region}`);
                return this.authenticate();
            } else if (response.data && response.data.redirect && this._manualRegion) {
                this._log(`Server suggested redirect to ${response.data.region}, but using manual region: ${this._region}`);
            }

           
            if (response.data && response.data.authTicket) {
                this._token = response.data.authTicket.token;

               
                const accountId = response.data.user.id;
                const checksum = GLib.Checksum.new(GLib.ChecksumType.SHA256);
                const bytes = new TextEncoder().encode(accountId);
                checksum.update(bytes);
                this._hashedAccountId = checksum.get_string();

                this._log('Authentication successful');
                return true;
            }

            throw new Error('AUTH_ERROR: Authentication failed - no auth ticket received');

        } catch (error) {
            this._log('Authentication failed:', error.message);
            this._token = null;
            this._hashedAccountId = null;
            throw error;
        }
    }

    async getConnections() {
        if (!this._token) {
            await this.authenticate();
        }

        const url = `${this._getBaseUrl()}/llu/connections`;
        this._log('Fetching connections...');

        const response = await this._makeRequest(url, 'GET', null, true);

       
        this._log('Connections response:', JSON.stringify(this._maskSensitiveData(response), null, 2));

        if (!response.data || !Array.isArray(response.data)) {
            this._log('Response data is not an array:', typeof response.data);
            throw new Error('NO_DATA: No connections found');
        }

        this._log(`Found ${response.data.length} connection(s)`);

        if (response.data.length === 0) {
            this._log('Empty connections array - LibreLinkUp sharing may not be configured');
        }

        return response.data;
    }

    async getUserInfo() {
        if (!this._token) {
            await this.authenticate();
        }

        const url = `${this._getBaseUrl()}/user`;
        this._log('Fetching user info...');

        try {
            const response = await this._makeRequest(url, 'GET', null, true);
            this._log('User info response:', JSON.stringify(this._maskSensitiveData(response), null, 2));
            return response;
        } catch (error) {
            this._log('User info fetch failed:', error.message);
            return null;
        }
    }

    async getLatestGlucose(retryCount = 0) {
        const MAX_RETRIES = 1;

        try {
            if (!this._token) {
                this._log('No token, authenticating...');
                await this.authenticate();
            }

            const connections = await this.getConnections();

            if (connections.length === 0) {
               
                const userInfo = await this.getUserInfo();

               
                let errorMsg = 'NO_DATA: No patient connections found.\n';
                errorMsg += 'LibreLinkUp requires sharing to be enabled:\n';
                errorMsg += '1. Open LibreLink app on your phone\n';
                errorMsg += '2. Go to Menu > Share/Connected Apps\n';
                errorMsg += '3. Enable LibreLinkUp and share with a follower\n';
                errorMsg += '4. Use the FOLLOWER account credentials in this extension';

                if (userInfo) {
                    this._log('Account type info:', this._maskSensitiveData(userInfo));
                }

                throw new Error(errorMsg);
            }

           
            let connection = connections[0];
            if (this._patientId) {
                const found = connections.find(c => c.patientId === this._patientId);
                if (found) {
                    connection = found;
                }
            }

            const measurement = connection.glucoseMeasurement;
            if (!measurement) {
                throw new Error('NO_DATA: No glucose measurement available');
            }

            this._log('Raw measurement:', JSON.stringify(this._maskSensitiveData(measurement)));

            return this._formatReading(measurement);

        } catch (error) {
            this._log('Error fetching glucose:', error.message);

           
            if (error.message.includes('AUTH_ERROR') || error.message.includes('401')) {
                if (retryCount < MAX_RETRIES) {
                    this._log('Re-authenticating...');
                    this._token = null;
                    this._hashedAccountId = null;
                    return this.getLatestGlucose(retryCount + 1);
                }
            }

            throw error;
        }
    }

    _formatReading(measurement) {
       
        let timestamp;
        if (measurement.Timestamp) {
            timestamp = this._parseLibreTimestamp(measurement.Timestamp);
        } else if (measurement.FactoryTimestamp) {
            timestamp = this._parseLibreTimestamp(measurement.FactoryTimestamp);
        } else {
            timestamp = Date.now();
        }

       
        let rawValue = measurement.ValueInMgPerDl || measurement.Value;
        let value = rawValue;

        if (this._unit === 'mmol/L') {
            value = (rawValue / 18.0).toFixed(1);
        }

       
        const trendArrow = measurement.TrendArrow || 4;
        const trend = TREND_MAP[trendArrow] || 'FLAT';

       
        let delta = this._calculateDelta(rawValue, timestamp, trend);

       
        this._previousReading = {
            value: rawValue,
            timestamp: timestamp
        };
        this._previousDelta = delta;

       
        if (this._unit === 'mmol/L') {
            delta = (delta / 18.0).toFixed(1);
        } else {
            delta = delta.toFixed(0);
        }

        const formattedReading = {
            value: value,
            unit: this._unit,
            trend: trend,
            timestamp: new Date(timestamp),
            delta: delta,
            isHigh: measurement.isHigh || false,
            isLow: measurement.isLow || false,
            measurementColor: measurement.MeasurementColor || 1
        };

        this._log('Formatted reading:', formattedReading);
        return formattedReading;
    }

    _parseLibreTimestamp(timestampStr) {
       
        try {
           
            const isoDate = Date.parse(timestampStr);
            if (!isNaN(isoDate)) {
                return isoDate;
            }

           
            const match = timestampStr.match(/(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+):(\d+)\s*(AM|PM)?/i);
            if (match) {
                let [, month, day, year, hours, minutes, seconds, ampm] = match;
                hours = parseInt(hours);

                if (ampm) {
                    if (ampm.toUpperCase() === 'PM' && hours !== 12) {
                        hours += 12;
                    } else if (ampm.toUpperCase() === 'AM' && hours === 12) {
                        hours = 0;
                    }
                }

                return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
            }

            return Date.now();
        } catch {
            return Date.now();
        }
    }

    _calculateDelta(currentValue, currentTimestamp, trend) {
        let delta = 0;

       
        if (this._previousReading) {
            const timeDiff = currentTimestamp - this._previousReading.timestamp;

           
            if (timeDiff <= 900000) {
                delta = currentValue - this._previousReading.value;
            }
        }

       
        if (delta === 0 && this._previousDelta) {
            if (Math.abs(this._previousDelta) <= 3.0) {
                delta = this._previousDelta;
            }
        }

       
        if (delta === 0) {
            const trendDeltas = {
                'DOUBLE_UP': 3.0,
                'SINGLE_UP': 2.0,
                'FORTY_FIVE_UP': 1.0,
                'FLAT': 0.0,
                'FORTY_FIVE_DOWN': -1.0,
                'SINGLE_DOWN': -2.0,
                'DOUBLE_DOWN': -3.0
            };
            delta = trendDeltas[trend] || 0;
        }

        return delta;
    }

    setPatientId(patientId) {
        this._patientId = patientId;
    }

    destroy() {
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        this._token = null;
        this._hashedAccountId = null;
        this._previousReading = null;
        this._previousDelta = null;
    }
}
