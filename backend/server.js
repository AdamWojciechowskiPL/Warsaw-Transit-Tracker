const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const https = require('https');
const { HttpsProxyAgent } = require('https-proxy-agent');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Configure Axios Client
function createApiClient() {
    const config = {
        timeout: 30000,
        headers: {
            // Spoof headers to look like a browser to avoid some IP blocks
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': 'https://www.google.com/',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        }
    };

    // Proxy Configuration via Environment Variable
    // Example format: http://user:pass@1.2.3.4:8080 or http://1.2.3.4:8080
    if (process.env.PROXY_URL) {
        console.log(`[Config] Using Proxy: ${process.env.PROXY_URL.replace(/:[^:]*@/, ':****@')}`);
        const proxyAgent = new HttpsProxyAgent(process.env.PROXY_URL);
        config.httpsAgent = proxyAgent;
        config.httpAgent = proxyAgent; // Use same agent for http fallback if needed
    } else {
        // Standard HTTPS Agent with SSL verification disabled (legacy fix)
        config.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    }

    return axios.create(config);
}

const apiClient = createApiClient();

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
        // Retry logic ONLY if we are NOT using a specific proxy (if proxy fails, it likely needs changing, not retrying on same)
        // Or if error is a timeout/network issue
        if (retries > 0 && !process.env.PROXY_URL) {
            console.warn(`[Proxy] Request failed, retrying... (${retries} left)`);
            
            // Fallback: Try HTTP instead of HTTPS
            const httpUrl = url.replace('https://', 'http://');
            console.log(`[Proxy] Fallback to HTTP: ${httpUrl}`);
            
            try {
                if (method === 'POST') {
                    // Use a fresh axios call for fallback to avoid reusing failed agent if that was the cause
                    return await axios.post(httpUrl, null, { 
                        params, 
                        timeout: 30000,
                        headers: apiClient.defaults.headers // keep headers
                    });
                } else {
                    return await axios.get(httpUrl, { 
                        params, 
                        timeout: 30000,
                        headers: apiClient.defaults.headers
                    });
                }
            } catch (retryError) {
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

        const response = await fetchWithRetry(targetUrl, params, 'GET', 1);

        console.log(`[Proxy] Success! Status: ${response.status}`);
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
             message: 'The Warsaw API took too long to respond (over 30s). This usually means the API is blocking our server IP.',
             details: error.message,
             tip: 'Try configuring a PROXY_URL environment variable in Railway.'
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
        config: {
            proxyConfigured: !!process.env.PROXY_URL,
            userAgent: apiClient.defaults.headers['User-Agent'] ? 'Custom' : 'Default'
        },
        tests: []
    };

    const testUrl = async (name, url, method = 'GET') => {
        const start = Date.now();
        try {
            // Use the main apiClient to test if the headers/proxy configuration works
            const response = await apiClient({
                method,
                url,
                timeout: 5000, 
                validateStatus: () => true 
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

    results.tests.push(await testUrl('Google (Connectivity Check)', 'https://www.google.com'));
    results.tests.push(await testUrl('Warsaw API (HTTPS)', 'https://api.um.warszawa.pl/api/action/busestrams_get/'));
    results.tests.push(await testUrl('Warsaw API (HTTP)', 'http://api.um.warszawa.pl/api/action/busestrams_get/'));

    try {
        // Check IP using the same agent (so if proxy is on, we see proxy IP)
        const ipCheck = await apiClient.get('https://api.ipify.org?format=json', { timeout: 5000 });
        results.serverIp = ipCheck.data.ip;
    } catch (e) {
        results.serverIp = 'Unknown (failed to resolve)';
    }

    res.json(results);
});

// Handle 404
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

// Serve static files
app.use(express.static(path.join(__dirname, '..')));

// Catch-all route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.listen(PORT, () => {
    console.log(`Warsaw Transit Proxy running on port ${PORT}`);
    if (process.env.PROXY_URL) {
        console.log('Extensions: Proxy Agent enabled');
    }
});