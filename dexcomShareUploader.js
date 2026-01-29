'use strict';

import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

// Dexcom Share API endpoints
const DEXCOM_URLS = {
    'US': 'https://share2.dexcom.com',
    'Non-US': 'https://shareous1.dexcom.com'
};

const APPLICATION_ID = 'd89443d2-327c-4a6f-89e5-496bbb0317db';
const USER_AGENT = 'Dexcom Share/3.0.2.11';

// Trend mapping from LibreView to Dexcom format
const LIBRE_TO_DEXCOM_TREND = {
    'DOUBLE_DOWN': 7,
    'SINGLE_DOWN': 6,
    'FORTY_FIVE_DOWN': 5,
    'FLAT': 4,
    'FORTY_FIVE_UP': 3,
    'SINGLE_UP': 2,
    'DOUBLE_UP': 1,
    'NOT_COMPUTABLE': 8,
    'RATE_OUT_OF_RANGE': 9
};

export class DexcomShareUploader {
    constructor(username, password, region = 'Non-US', settings = null) {
        this._username = username;
        this._password = password;
        this._region = region.includes('US') && !region.includes('Non') ? 'US' : 'Non-US';
        this._baseUrl = DEXCOM_URLS[this._region];
        this._settings = settings;

        this._sessionId = null;
        this._accountId = null;
        this._lastUploadTime = 0;

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
            const sensitiveKeys = ['password', 'accountName', 'accountId', 'sessionId',
                                   'applicationId', 'token', 'firstName', 'lastName',
                                   'email', 'username', 'sn', 'deviceId', 'patientId', 'id'];
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
                    console.log(`[DexcomShareUploader] ${message}`, maskedData);
                } else {
                    console.log(`[DexcomShareUploader] ${message}`);
                }
            }
        };

        this._log('DexcomShareUploader initialized:', {
            region: this._region,
            baseUrl: this._baseUrl
        });
    }

    async _makeRequest(url, method = 'POST', body = null, params = null) {
        return new Promise((resolve, reject) => {
            try {
                if (params) {
                    const queryString = Object.entries(params)
                        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
                        .join('&');
                    url = `${url}?${queryString}`;
                }

                const message = new Soup.Message({
                    method,
                    uri: GLib.Uri.parse(url, GLib.UriFlags.NONE)
                });

                const headers = message.get_request_headers();
                headers.append('Content-Type', 'application/json; charset=utf-8');
                headers.append('Accept', 'application/json');
                headers.append('User-Agent', USER_AGENT);

                if (body && method !== 'GET') {
                    const jsonStr = JSON.stringify(body);
                    this._log(`Request body: ${JSON.stringify(this._maskSensitiveData(body))}`);
                    const bytes = new TextEncoder().encode(jsonStr);
                    message.set_request_body_from_bytes('application/json', new GLib.Bytes(bytes));
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
                            this._log(`Response body: ${this._maskSensitiveData(responseText)}`);

                            if (statusCode === 200) {
                                try {
                                    resolve(JSON.parse(responseText));
                                } catch {
                                    resolve(responseText.replace(/^"|"$/g, ''));
                                }
                            } else if (statusCode === 429) {
                                reject(new Error('RATE_LIMITED: Too many requests to Dexcom API'));
                            } else if (statusCode === 500 || statusCode === 401) {
                                this._log(`Error response (${statusCode}): ${responseText}`);
                                try {
                                    const errorData = JSON.parse(responseText);
                                    this._log('Parsed error:', JSON.stringify(errorData));
                                    if (errorData.Code === 'SessionNotValid' || errorData.Code === 'SessionIdNotFound') {
                                        reject(new Error('SESSION_EXPIRED'));
                                    } else if (errorData.Code === 'InvalidArgument') {
                                        reject(new Error(`INVALID_ARGUMENT: ${errorData.Message || 'Invalid request format'}`));
                                    } else {
                                        reject(new Error(`DEXCOM_ERROR: ${errorData.Code || statusCode} - ${errorData.Message || responseText}`));
                                    }
                                } catch {
                                    reject(new Error(`Request failed: ${statusCode} - ${responseText}`));
                                }
                            } else {
                                reject(new Error(`Request failed with status ${statusCode}: ${responseText}`));
                            }
                        } catch (error) {
                            reject(this._handleNetworkError(error));
                        }
                    }
                );
            } catch (error) {
                reject(this._handleNetworkError(error));
            }
        });
    }

    _handleNetworkError(error) {
        const errorString = error.toString();

        if (errorString.includes('Gio.IOErrorEnum') ||
            errorString.includes('No route to host') ||
            errorString.includes('timed out')) {
            return new Error('NETWORK_ERROR: Connection to Dexcom failed');
        }

        return error;
    }

    async authenticate() {
        try {
            if (!this._username || !this._password) {
                throw new Error('AUTH_ERROR: Username and password are required');
            }

            this._log('Starting Dexcom authentication...');

           
            const authUrl = `${this._baseUrl}/ShareWebServices/Services/General/AuthenticatePublisherAccount`;
            const authPayload = {
                accountName: this._username,
                password: this._password,
                applicationId: APPLICATION_ID
            };

            this._accountId = await this._makeRequest(authUrl, 'POST', authPayload);

            if (!this._accountId || typeof this._accountId !== 'string') {
                throw new Error('AUTH_ERROR: Invalid account ID received');
            }

            this._log('Account ID received');

           
            const loginUrl = `${this._baseUrl}/ShareWebServices/Services/General/LoginPublisherAccountById`;
            const loginPayload = {
                accountId: this._accountId,
                password: this._password,
                applicationId: APPLICATION_ID
            };

            this._sessionId = await this._makeRequest(loginUrl, 'POST', loginPayload);

            if (!this._sessionId || this._sessionId === '00000000-0000-0000-0000-000000000000') {
                throw new Error('AUTH_ERROR: Invalid session ID received');
            }

            this._log('Dexcom authentication successful');
            return true;

        } catch (error) {
            this._log('Authentication failed:', error.message);
            this._sessionId = null;
            this._accountId = null;
            throw error;
        }
    }

    async uploadGlucoseReading(reading, retryCount = 0) {
        const MAX_RETRIES = 1;
        const MIN_UPLOAD_INTERVAL = 60000;

        try {
           
            const now = Date.now();
            if (now - this._lastUploadTime < MIN_UPLOAD_INTERVAL) {
                this._log('Skipping upload - too soon since last upload');
                return false;
            }

            if (!this._sessionId) {
                await this.authenticate();
            }

           
            const dexcomReading = this._convertToDexcomFormat(reading);

            this._log('Uploading glucose reading:', dexcomReading);

            const url = `${this._baseUrl}/ShareWebServices/Services/Publisher/PostReceiverEgvRecords`;
            const params = {
                sessionId: this._sessionId
            };

           
           
            const payload = {
                SN: this._getDeviceSerialNumber(),
                Egvs: [dexcomReading]
            };

            this._log('Final payload:', JSON.stringify(payload));

            await this._makeRequest(url, 'POST', payload, params);

            this._lastUploadTime = now;
            this._log('Upload successful');
            return true;

        } catch (error) {
            this._log('Upload error:', error.message);

            if (error.message.includes('SESSION_EXPIRED') && retryCount < MAX_RETRIES) {
                this._sessionId = null;
                return this.uploadGlucoseReading(reading, retryCount + 1);
            }

            throw error;
        }
    }

    _convertToDexcomFormat(reading) {
       
        let valueInMgdl = parseFloat(reading.value);
        if (reading.unit === 'mmol/L') {
            valueInMgdl = Math.round(valueInMgdl * 18.0);
        }

       
        const timestamp = reading.timestamp instanceof Date
            ? reading.timestamp.getTime()
            : Date.now();

       
        const trend = LIBRE_TO_DEXCOM_TREND[reading.trend] || 4;

       
        const dexcomRecord = {
            DT: `/Date(${timestamp})/`,
            ST: `/Date(${timestamp})/`,
            WT: `/Date(${timestamp})/`,
            Value: valueInMgdl,
            Trend: trend
        };

        this._log('Converted to Dexcom format:', JSON.stringify(dexcomRecord));

        return dexcomRecord;
    }

    _getDeviceSerialNumber() {
       
       
        if (!this._deviceSerialNumber) {
           
            const hash = this._username.split('').reduce((acc, char) => {
                return ((acc << 5) - acc) + char.charCodeAt(0);
            }, 0);
            const absHash = Math.abs(hash);
            this._deviceSerialNumber = `SM${absHash.toString().padStart(8, '0').slice(0, 8)}`;
        }
        return this._deviceSerialNumber;
    }

    isConfigured() {
        return !!(this._username && this._password);
    }

    destroy() {
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        this._sessionId = null;
        this._accountId = null;
    }
}
