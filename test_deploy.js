// test marker - deployed at 2026-06-19 14:20:24
const express = require('express');
const app = express();
app.get('/test-deploy', (req, res) => res.json({ deployed: true, time: '2026-06-19 14:20:24' }));
app.listen(19999);
