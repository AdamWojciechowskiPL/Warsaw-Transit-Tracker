const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const https = require('https');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Configure HTTPS Agent
const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

// Create customized axios instance
const apiClient = axios.create({
    httpsAgent: httpsAgent,
    timeout: 30000
});

// API Health check
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Helper function for retrying requests
async function fetchWithRetry(url, params, method = 'POST', retries = 1) {
    try {
        console.log(`[Proxy] Attempt 1 (${method}): ${url}`);
        if (method === 'POST') {
             return await apiClient.post(url, null, { params });
        } else {
             return await apiClient.get(url, { params });
        }
    } catch (error) {
        if (retries > 0) {
            console.warn(`[Proxy] Request failed, retrying... (${retries} left)`);
            // Fallback: Try HTTP instead of HTTPS if SSL is the blocker
            // Warsaw API is also accessible via http://api.um.warszawa.pl often
            const httpUrl = url.replace('https://', 'http://');
            console.log(`[Proxy] Fallback to HTTP: ${httpUrl}`);
            
            try {
                if (method === 'POST') {
                    return await axios.post(httpUrl, null, { params, timeout: 30000 });
                } else {
                    return await axios.get(httpUrl, { params, timeout: 30000 });
                }
            } catch (retryError) {
                // If HTTP fallback fails, throw the original error or the new one
                throw retryError;
            }
        }
        throw error;
    }
}

// Proxy endpoint specifically for busestrams_get (Vehicles locations)
app.get('/api/busestrams_get', async (req, res) => {
    try {
        const { resource_id, apikey, type, line, brigade } = req.query;
        
        const targetUrl = 'https://api.um.warszawa.pl/api/action/busestrams_get/';
        
        const params = {
            resource_id: resource_id || 'f2e5503e-927d-4ad3-9500-4ab9e55deb59',
            apikey: apikey || '34574ba5-4ce4-432b-ae87-0c26cec9809b',
            type: type || '1',
            ...req.query
        };

        const logParams = { ...params };
        if (logParams.apikey) logParams.apikey = logParams.apikey.substring(0, 5) + '...';

        console.log(`[Proxy] Requesting Warsaw API (Vehicles)`);
        console.log(`[Proxy] Params:`, JSON.stringify(logParams));

        // Try POST first, with retry logic falling back to HTTP
        const response = await fetchWithRetry(targetUrl, params, 'POST', 1);

        console.log(`[Proxy] Success! Status: ${response.status}`);
        const dataPreview = Array.isArray(response.data.result) 
            ? `Array(${response.data.result.length})` 
            : typeof response.data.result;
        console.log(`[Proxy] Data result type: ${dataPreview}`);

        res.json(response.data);
    } catch (error) {
        handleProxyError(error, res);
    }
});

// Proxy endpoint for dbtimetable_get (Timetables, Stops, Lines)
app.get('/api/dbtimetable_get', async (req, res) => {
    try {
        const { id, apikey, busstopId, busstopNr, line } = req.query;
        const targetUrl = 'https://api.um.warszawa.pl/api/action/dbtimetable_get/';

        const params = {
            id: id,
            apikey: apikey || '34574ba5-4ce4-432b-ae87-0c26cec9809b',
            busstopId,
            busstopNr,
            line,
            ...req.query
        };

        const logParams = { ...params };
        if (logParams.apikey) logParams.apikey = logParams.apikey.substring(0, 5) + '...';

        console.log(`[Proxy] Requesting Warsaw API (Timetables)`);
        
        // Use GET for timetables with retry
        const response = await fetchWithRetry(targetUrl, params, 'GET', 1);

        console.log(`[Proxy] Success! Status: ${response.status}`);
        res.json(response.data);
    } catch (error) {
        handleProxyError(error, res);
    }
});

function handleProxyError(error, res) {
    console.error('[Proxy] Error details:');
    if (error.code) console.error(`- Code: ${error.code}`);
    if (error.message) console.error(`- Message: ${error.message}`);
    
    if (error.code === 'ECONNABORTED') {
         console.error('- Timeout exceeded. The Warsaw API is too slow or blocking Railway IP.');
         res.status(504).json({ 
             error: 'Gateway Timeout', 
             message: 'The Warsaw API took too long to respond (over 30s). Tried HTTPS and HTTP.',
             details: error.message
         });
    } else if (error.response) {
        console.error(`- API Status: ${error.response.status}`);
        res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
        console.error('- No response received from upstream');
        res.status(502).json({ error: 'Bad Gateway', message: 'No response from upstream server' });
    } else {
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
}

// Diagnostic endpoint to test connectivity
app.get('/api/test-connection', async (req, res) => {
    const results = {
        timestamp: new Date().toISOString(),
        tests: []
    };

    const testUrl = async (name, url, method = 'GET') => {
        const start = Date.now();
        try {
            const response = await axios({
                method,
                url,
                timeout: 5000, // Short timeout for testing
                validateStatus: () => true // Resolve even if status is error
            });
            return {
                name,
                url,
                status: response.status,
                duration: `${Date.now() - start}ms`,
                success: response.status >= 200 && response.status < 400
            };
        } catch (error) {
            return {
                name,
                url,
                error: error.message,
                code: error.code,
                duration: `${Date.now() - start}ms`,
                success: false
            };
        }
    };

    // Test 1: General Internet Connectivity
    results.tests.push(await testUrl('Google (Connectivity Check)', 'https://www.google.com'));

    // Test 2: Warsaw API (HTTPS)
    results.tests.push(await testUrl('Warsaw API (HTTPS)', 'https://api.um.warszawa.pl/api/action/busestrams_get/'));

    // Test 3: Warsaw API (HTTP)
    results.tests.push(await testUrl('Warsaw API (HTTP)', 'http://api.um.warszawa.pl/api/action/busestrams_get/'));

    // Test 4: Warsaw API (IP Check - external service)
    try {
        const ipCheck = await axios.get('https://ifconfig.me', { timeout: 5000 });
        results.serverIp = ipCheck.data;
    } catch (e) {
        results.serverIp = 'Unknown (failed to resolve)';
    }

    res.json(results);
});

// Handle 404 for undefined API routes (must be before catch-all)
app.use('/api/*', (req, res) => {
    console.warn(`[404] API Endpoint not found: ${req.originalUrl}`);
    res.status(404).json({ error: 'API endpoint not found' });
});

// Serve static files from the root directory (where index.html is)
app.use(express.static(path.join(__dirname, '..')));

// Catch-all route to serve index.html (SPA support) - MUST BE LAST
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    console.log(`Warsaw Transit Proxy running on port ${PORT}`);
});