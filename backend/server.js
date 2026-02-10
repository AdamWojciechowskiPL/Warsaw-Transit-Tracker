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
        
        const targetUrl = 'https://api.um.warszawa.pl/api/action/busestrams_get/';
        
        // Default resource_id for vehicles: f2e5503e-927d-4ad3-9500-4ab9e55deb59
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

        console.log(`[Proxy] Requesting Warsaw API (Vehicles): ${targetUrl}`);
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

// Proxy endpoint for dbtimetable_get (Timetables, Stops, Lines)
app.get('/api/dbtimetable_get', async (req, res) => {
    try {
        // Supported IDs from spec:
        // Stops list: ab75c33d-3a26-4342-b36a-6e5fef0a3ac3
        // Lines at stop: 88cd555f-6f31-43ca-9de4-66c479ad5942
        // Schedules: e923fa0e-d96c-43f9-ae6e-60518c9f3238
        
        const { id, apikey, busstopId, busstopNr, line } = req.query;
        const targetUrl = 'https://api.um.warszawa.pl/api/action/dbtimetable_get/';

        const params = {
            id: id, // ID is mandatory for this endpoint to know what to fetch
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

        console.log(`[Proxy] Requesting Warsaw API (Timetables): ${targetUrl}`);
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
         console.error('- Timeout exceeded.');
         res.status(504).json({ 
             error: 'Gateway Timeout', 
             message: 'The Warsaw API took too long to respond (over 30s).',
             details: error.message
         });
    } else if (error.response) {
        console.error(`- API Status: ${error.response.status}`);
        res.status(error.response.status).json(error.response.data);
    } else if (error.request) {
        console.error('- No response received');
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