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

// Proxy endpoint specifically for busestrams_get
app.get('/api/busestrams_get', async (req, res) => {
    try {
        const { resource_id, apikey, type, line, brigade } = req.query;
        
        const targetUrl = 'https://api.um.warszawa.pl/api/action/busestrams_get/';
        
        // Construct params, hiding sensitive API key in logs usually, 
        // but for debugging we might want to see if it's being passed correctly (partially masked)
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

        console.log(`[Proxy] Requesting Warsaw API: ${targetUrl}`);
        console.log(`[Proxy] Params:`, JSON.stringify(logParams));

        const response = await axios.get(targetUrl, {
            params,
            timeout: 10000 // Increased timeout to 10s
        });

        console.log(`[Proxy] Success! Status: ${response.status}`);
        // Log first element of data to verify structure without flooding logs
        const dataPreview = Array.isArray(response.data.result) 
            ? `Array(${response.data.result.length})` 
            : typeof response.data.result;
        console.log(`[Proxy] Data result type: ${dataPreview}`);

        res.json(response.data);
    } catch (error) {
        console.error('[Proxy] Error details:');
        console.error(`- Message: ${error.message}`);
        console.error(`- Code: ${error.code}`);
        
        if (error.response) {
            console.error(`- API Status: ${error.response.status}`);
            console.error(`- API Headers:`, JSON.stringify(error.response.headers));
            console.error(`- API Data:`, JSON.stringify(error.response.data));
            res.status(error.response.status).json(error.response.data);
        } else if (error.request) {
            console.error('- No response received from Warsaw API');
            res.status(504).json({ error: 'No response from upstream server', details: error.message });
        } else {
            console.error('- Request setup failed');
            res.status(500).json({ error: 'Proxy request failed', message: error.message });
        }
    }
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