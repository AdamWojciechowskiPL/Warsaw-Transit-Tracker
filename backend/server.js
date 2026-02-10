const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// API Health check
app.get('/api/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy endpoint specifically for busestrams_get (Vehicles locations)
app.get('/api/busestrams_get', async (req, res) => {
    try {
        const { resource_id, apikey, type, line, brigade } = req.query;
        
        // Use POST instead of GET for busestrams_get as per documentation examples (often more reliable)
        // Although docs say both work, POST is explicitly used in example #1 and #2.
        const targetUrl = 'https://api.um.warszawa.pl/api/action/busestrams_get/';
        
        const params = {
            resource_id: resource_id || 'f2e5503e-927d-4ad3-9500-4ab9e55deb59',
            apikey: apikey || '34574ba5-4ce4-432b-ae87-0c26cec9809b',
            type: type || '1',
            ...req.query
        };

        const logParams = { ...params };
        if (logParams.apikey) {
            logParams.apikey = logParams.apikey.substring(0, 5) + '...';
        }

        console.log(`[Proxy] Requesting Warsaw API (Vehicles) via POST: ${targetUrl}`);
        console.log(`[Proxy] Params being sent:`, JSON.stringify(logParams));

        // Switch to POST request
        // Note: Warsaw API expects params in query string even for POST sometimes, or body.
        // Let's try sending params as query params in URL even with POST, as per curl example:
        // curl -X POST .../busestrams_get/?resource_id=...
        
        const response = await axios.post(targetUrl, null, {
            params, // axios sends these as query parameters ?key=value
            timeout: 30000 
        });

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
        if (logParams.apikey) {
             logParams.apikey = logParams.apikey.substring(0, 5) + '...';
        }

        console.log(`[Proxy] Requesting Warsaw API (Timetables) via GET: ${targetUrl}`);
        console.log(`[Proxy] Params:`, JSON.stringify(logParams));

        const response = await axios.get(targetUrl, {
            params,
            timeout: 30000
        });

        console.log(`[Proxy] Success! Status: ${response.status}`);
        res.json(response.data);
    } catch (error) {
        handleProxyError(error, res);
    }
});

function handleProxyError(error, res) {
    console.error('[Proxy] Error details:');
    console.error(`- Message: ${error.message}`);
    
    if (error.code === 'ECONNABORTED') {
         console.error('- Timeout exceeded. The Warsaw API is too slow or blocking Railway IP.');
         res.status(504).json({ 
             error: 'Gateway Timeout', 
             message: 'The Warsaw API took too long to respond (over 30s). This usually indicates the Railway IP is blocked by ZTM.',
             details: error.message
         });
    } else if (error.response) {
        console.error(`- API Status: ${error.response.status}`);
        console.error(`- API Data:`, JSON.stringify(error.response.data));
        res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
        console.error('- No response received from upstream');
        res.status(502).json({ error: 'Bad Gateway', message: 'No response from upstream server' });
    } else {
        res.status(500).json({ error: 'Proxy request failed', message: error.message });
    }
}

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