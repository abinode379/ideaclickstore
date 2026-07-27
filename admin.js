require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.ADMIN_SESSION_SECRET || 'change_this_secret_key_' + Date.now(),
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 2 * 60 * 60 * 1000 } // 2 hours
}));

app.use('/public', express.static(path.join(__dirname, 'public')));

function ensureAuth(req, res, next) {
    if (req.session.isAdmin) return next();
    res.redirect('/login');
}

function ensureAuthAPI(req, res, next) {
    if (req.session.isAdmin) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

const configPath = path.join(__dirname, 'config.json');
const usersPath = path.join(__dirname, 'users.json');
const logsPath = path.join(__dirname, 'admin_logs.json');

function readConfig() {
    try {
        return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {
        return {};
    }
}

function writeConfig(data) {
    fs.writeFileSync(configPath, JSON.stringify(data, null, 2), 'utf8');
}

function readUsers() {
    try {
        return JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    } catch (e) {
        return {};
    }
}

function writeUsers(data) {
    fs.writeFileSync(usersPath, JSON.stringify(data, null, 2), 'utf8');
}

function readLogs() {
    try {
        return JSON.parse(fs.readFileSync(logsPath, 'utf8'));
    } catch (e) {
        return [];
    }
}

function appendLog(entry) {
    let logs = readLogs();
    entry.timestamp = new Date().toISOString();
    logs.push(entry);
    if (logs.length > 500) {
        logs = logs.slice(logs.length - 500);
    }
    fs.writeFileSync(logsPath, JSON.stringify(logs, null, 2), 'utf8');
}

// Routes
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
    if (req.body.password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/dashboard');
    } else {
        res.redirect('/login?error=1');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/dashboard', ensureAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/settings', ensureAuthAPI, (req, res) => {
    const config = readConfig();
    res.json({
        usdt_to_npr_rate: config.usdt_to_npr_rate,
        notification_channel_id: config.notification_channel_id
    });
});

app.post('/api/settings', ensureAuthAPI, (req, res) => {
    const config = readConfig();
    const updates = {};
    if (req.body.usdt_to_npr_rate !== undefined) {
        config.usdt_to_npr_rate = Number(req.body.usdt_to_npr_rate);
        updates.usdt_to_npr_rate = config.usdt_to_npr_rate;
    }
    if (req.body.notification_channel_id !== undefined) {
        config.notification_channel_id = req.body.notification_channel_id;
        updates.notification_channel_id = config.notification_channel_id;
    }
    writeConfig(config);
    appendLog({
        action: 'settings_update',
        details: updates
    });
    res.json({ success: true });
});

app.get('/api/products', ensureAuthAPI, async (req, res) => {
    try {
        const response = await axios.get('https://tunvnmmo.duckdns.org/api/products', {
            headers: { 'X-API-Key': process.env.TUNVNMMO_API_KEY }
        });
        let products = [];
        if (Array.isArray(response.data.products)) {
            products = response.data.products;
        } else if (Array.isArray(response.data)) {
            products = response.data;
        }
        
        const config = readConfig();
        const customProducts = config.custom_products || {};
        const hiddenProducts = config.hidden_products || [];
        
        const enrichedProducts = products.map(p => {
            const pid = String(p.id);
            return {
                ...p,
                custom: customProducts[pid] || {},
                hidden: hiddenProducts.includes(pid)
            };
        });
        
        res.json(enrichedProducts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/product', ensureAuthAPI, (req, res) => {
    const config = readConfig();
    const { product_id, name, description, price, hidden } = req.body;
    const pidStr = String(product_id);
    
    if (!config.custom_products) config.custom_products = {};
    if (!config.hidden_products) config.hidden_products = [];
    
    const changes = {};
    
    // Handle custom product data
    if (!config.custom_products[pidStr]) config.custom_products[pidStr] = {};
    
    if (name) {
        config.custom_products[pidStr].name = name;
    } else {
        delete config.custom_products[pidStr].name;
    }
    
    if (description) {
        config.custom_products[pidStr].description = description;
    } else {
        delete config.custom_products[pidStr].description;
    }
    
    if (price) {
        config.custom_products[pidStr].price = Number(price);
    } else {
        delete config.custom_products[pidStr].price;
    }
    
    changes.custom = { ...config.custom_products[pidStr] };
    
    // Clean up empty custom entries
    if (Object.keys(config.custom_products[pidStr]).length === 0) {
        delete config.custom_products[pidStr];
        changes.custom = 'cleared';
    }
    
    // Handle hidden products array
    const isHidden = hidden === true || hidden === 'true';
    if (isHidden && !config.hidden_products.includes(pidStr)) {
        config.hidden_products.push(pidStr);
        changes.hidden = true;
    } else if (!isHidden) {
        config.hidden_products = config.hidden_products.filter(pId => pId !== pidStr);
        changes.hidden = false;
    }
    
    writeConfig(config);
    appendLog({
        action: 'product_update',
        product_id: pidStr,
        changes
    });
    
    res.json({ success: true });
});

app.get('/api/users', ensureAuthAPI, (req, res) => {
    const users = readUsers();
    const usersArray = Object.keys(users).map(id => {
        return {
            id,
            balance_npr: users[id].balance_npr,
            loyalty_points: users[id].loyalty_points,
            username: users[id].username,
            purchase_history: users[id].purchase_history,
            last_daily_claim: users[id].last_daily_claim
        };
    });
    res.json(usersArray);
});

app.post('/api/users/:id/balance', ensureAuthAPI, (req, res) => {
    const userId = req.params.id;
    const { amount, reason } = req.body;
    
    const users = readUsers();
    if (!users[userId]) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    const numAmount = Number(amount);
    if (isNaN(numAmount)) {
        return res.status(400).json({ error: 'Invalid amount' });
    }
    
    if (!users[userId].balance_npr) users[userId].balance_npr = 0;
    
    const newBalance = users[userId].balance_npr + numAmount;
    if (newBalance < 0) {
        return res.status(400).json({ error: 'Balance cannot go below 0' });
    }
    
    users[userId].balance_npr = newBalance;
    writeUsers(users);
    
    appendLog({
        action: 'balance_adjust',
        targetUser_id: userId,
        username: users[userId].username,
        amount: numAmount,
        reason: reason || '',
        newBalance: newBalance
    });
    
    res.json({ success: true, newBalance });
});

app.get('/api/logs', ensureAuthAPI, (req, res) => {
    const logs = readLogs();
    res.json(logs.reverse());
});

const PORT = process.env.ADMIN_PORT || 3001;
app.listen(PORT, () => {
    console.log(`🛡️ Admin panel running on http://localhost:${PORT}`);
});