const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Minimal CORS setup - allow all origins for now since it's used by both Tracker and Tester
app.use(cors());

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Proxy endpoint specifically for busestrams_get
app.get('/api/busestrams_get', async (req, res) => {
    try {
        const { resource_id, apikey, type, line, brigade } = req.query;
        
        // Construct the target URL with query parameters
        // Using the exact resource_id provided in the prompt if not passed, 
        // but generally passing through what the frontend sends
        const targetUrl = 'https://api.um.warszawa.pl/api/action/busestrams_get/';
        
        const params = {
            resource_id: resource_id || 'f2e5503e-927d-4ad3-9500-4ab9e55deb59',
            apikey: apikey || '34574ba5-4ce4-432b-ae87-0c26cec9809b',
            type: type || '1',
            ...req.query
        };

        console.log(`Proxying request to Warsaw API with params:`, { ...params, apikey: '***' });

        const response = await axios.get(targetUrl, {
            params,
            timeout: 5000 // 5s timeout to keep it light
        });

        res.json(response.data);
    } catch (error) {
        console.error('Proxy error:', error.message);
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'Proxy request failed', message: error.message });
        }
    }
});

app.listen(PORT, () => {
    console.log(`Warsaw Transit Proxy running on port ${PORT}`);
});