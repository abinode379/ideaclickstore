require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const db = require('./db');
const log = require('./logger').child({ service: 'admin' });

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.OAUTH2_CLIENT_SECRET;
const ADMIN_URL = process.env.ADMIN_URL || 'http://localhost:3001';
const REDIRECT_URI = `${ADMIN_URL}/auth/callback`;
const ADMIN_IDS = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
const USE_OAUTH2 = !!(CLIENT_ID && CLIENT_SECRET && ADMIN_IDS.length > 0);

async function sendStaffLog(embed) {
    try {
        const channelId = db.getConfig('staff_log_channel_id') || process.env.STAFF_LOG_CHANNEL_ID;
        if (!channelId || !process.env.DISCORD_TOKEN) return;
        await axios.post(
            `https://discord.com/api/v10/channels/${channelId}/messages`,
            { embeds: [embed] },
            { headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` } }
        ).catch(() => {});
    } catch (e) {
        log.error({ err: e.message }, 'Failed to post staff log');
    }
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    store: new db.SQLiteSessionStore(),
    secret: process.env.ADMIN_SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 2 * 60 * 60 * 1000 } // 2 hours
}));

app.use('/public', express.static(path.join(__dirname, 'public')));

function ensureAuth(req, res, next) {
    if (req.session.admin) return next();
    res.redirect('/login');
}

function ensureAuthAPI(req, res, next) {
    if (req.session.admin) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/discord', (req, res) => {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/login');

    try {
        const params = new URLSearchParams();
        params.append('client_id', CLIENT_ID);
        params.append('client_secret', CLIENT_SECRET);
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('redirect_uri', REDIRECT_URI);

        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const accessToken = tokenRes.data.access_token;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const user = userRes.data;

        if (!ADMIN_IDS.includes(user.id)) {
            log.warn({ id: user.id, username: user.username }, 'Unauthorized Discord login attempt');
            return res.redirect('/login?error=denied');
        }

        req.session.admin = {
            id: user.id,
            username: user.username,
            discriminator: user.discriminator,
            avatar: user.avatar
        };

        log.info({ id: user.id, username: user.username }, 'Admin logged in via Discord');
        res.redirect('/dashboard');
    } catch (error) {
        log.error({ error: error.message }, 'Discord OAuth2 error');
        res.redirect('/login?error=failed');
    }
});

app.post('/auth/password', (req, res) => {
    if (req.body.password === process.env.ADMIN_PASSWORD) {
        req.session.admin = { id: 'local', username: 'Admin' };
        res.redirect('/dashboard');
    } else {
        res.redirect('/login?error=password');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

app.get('/dashboard', ensureAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API Routes
app.get('/api/me', ensureAuthAPI, (req, res) => {
    res.json(req.session.admin);
});

app.get('/api/settings', ensureAuthAPI, (req, res) => {
    res.json({
        usdt_to_npr_rate: db.getConfig('usdt_to_npr_rate'),
        notification_channel_id: db.getConfig('notification_channel_id'),
        live_sales_channel_id: db.getConfig('live_sales_channel_id'),
        available_products_channel_id: db.getConfig('available_products_channel_id')
    });
});

app.post('/api/settings', ensureAuthAPI, (req, res) => {
    const { usdt_to_npr_rate, notification_channel_id, live_sales_channel_id, available_products_channel_id } = req.body;
    if (usdt_to_npr_rate !== undefined) db.setConfig('usdt_to_npr_rate', usdt_to_npr_rate);
    if (notification_channel_id !== undefined) db.setConfig('notification_channel_id', notification_channel_id);
    if (live_sales_channel_id !== undefined) db.setConfig('live_sales_channel_id', live_sales_channel_id);
    if (available_products_channel_id !== undefined) db.setConfig('available_products_channel_id', available_products_channel_id);
    
    db.appendLog({ action: 'settings_update', details: req.body });
    
    sendStaffLog({
        title: '⚙️ Settings Updated',
        color: 0x9b59b6,
        fields: [
            { name: 'Admin User', value: req.session?.admin?.username || 'System', inline: true },
            { name: 'Exchange Rate', value: usdt_to_npr_rate ? `\` ${usdt_to_npr_rate} NPR \`` : 'N/A', inline: true },
            { name: 'Notification Channel', value: notification_channel_id ? `\` ${notification_channel_id} \`` : 'N/A', inline: true },
            { name: 'Live Sales Channel', value: live_sales_channel_id ? `\` ${live_sales_channel_id} \`` : 'N/A', inline: true },
            { name: 'Catalog Channel', value: available_products_channel_id ? `\` ${available_products_channel_id} \`` : 'N/A', inline: true }
        ],
        timestamp: new Date().toISOString()
    });
    
    res.json({ success: true });
});

app.get('/api/products', ensureAuthAPI, async (req, res) => {
    try {
        const prodRes = await axios.get('https://tunvnmmo.duckdns.org/api/products', {
            headers: { 'X-API-Key': process.env.TUNVNMMO_API_KEY }
        });
        
        let products = [];
        if (Array.isArray(prodRes.data)) {
            products = prodRes.data;
        } else if (prodRes.data && Array.isArray(prodRes.data.products)) {
            products = prodRes.data.products;
        } else if (prodRes.data && Array.isArray(prodRes.data.data)) {
            products = prodRes.data.data;
        }

        const customProducts = db.getConfig('custom_products') || {};
        const hiddenProducts = db.getConfig('hidden_products') || [];
        const productOrder = db.getConfig('product_order') || [];
        
        let enriched = products.map(p => {
            return {
                ...p,
                custom: customProducts[String(p.id)] || {},
                hidden: hiddenProducts.includes(String(p.id))
            };
        });
        
        if (productOrder.length > 0) {
            enriched.sort((a, b) => {
                const idxA = productOrder.indexOf(String(a.id));
                const idxB = productOrder.indexOf(String(b.id));
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        }
        
        res.json(enriched);
    } catch (err) {
        log.error({ error: err.message, stack: err.stack }, 'Failed to fetch products from TunvnMMO API');
        res.status(500).json({ error: 'Failed to fetch products' });
    }
});

app.post('/api/products/order', ensureAuthAPI, (req, res) => {
    const { order } = req.body; // Array of product IDs
    if (!Array.isArray(order)) return res.status(400).json({ error: 'Missing order array' });
    db.setConfig('product_order', order);
    db.appendLog({ action: 'product_reorder', order });
    
    sendStaffLog({
        title: '📦 Products Reordered',
        color: 0x9b59b6,
        fields: [
            { name: 'Admin User', value: req.session?.admin?.username || 'System', inline: true },
            { name: 'Total Products Sorted', value: String(order.length), inline: true }
        ],
        timestamp: new Date().toISOString()
    });
    
    res.json({ success: true });
});

app.post('/api/product', ensureAuthAPI, (req, res) => {
    const { product_id, name, description, price, hidden } = req.body;
    if (!product_id) return res.status(400).json({ error: 'Missing product_id' });
    
    let customProducts = db.getConfig('custom_products') || {};
    let hiddenProducts = db.getConfig('hidden_products') || [];
    
    if (name || description || price) {
        customProducts[String(product_id)] = {
            name: name || undefined,
            description: description || undefined,
            price: price || undefined
        };
    } else {
        delete customProducts[String(product_id)];
    }
    
    if (hidden) {
        if (!hiddenProducts.includes(String(product_id))) {
            hiddenProducts.push(String(product_id));
        }
    } else {
        hiddenProducts = hiddenProducts.filter(id => id !== String(product_id));
    }
    
    db.setConfig('custom_products', customProducts);
    db.setConfig('hidden_products', hiddenProducts);
    
    db.appendLog({ action: 'product_update', product_id, changes: { custom: customProducts[String(product_id)], hidden } });
    res.json({ success: true });
});

app.get('/api/users', ensureAuthAPI, (req, res) => {
    res.json(db.getAllUsers());
});

app.post('/api/users/:id/balance', ensureAuthAPI, (req, res) => {
    const { amount, reason } = req.body;
    const id = req.params.id;
    try {
        const user = db.getUser(id);
        const username = user ? user.username : id;
        const newBalance = db.adjustBalance(id, Number(amount));
        db.appendLog({
            action: 'balance_adjust',
            targetUser: id,
            username,
            amount: Number(amount),
            reason,
            newBalance
        });
        
        sendStaffLog({
            title: '💰 Balance Adjusted via Admin Panel',
            color: 0xe67e22,
            fields: [
                { name: 'Admin User', value: req.session?.admin?.username || 'System', inline: true },
                { name: 'Target User', value: `${username} (\`${id}\`)`, inline: true },
                { name: 'Amount', value: `\` ${Number(amount) >= 0 ? '+' : ''}${amount} NPR \``, inline: true },
                { name: 'New Balance', value: `\` ${newBalance} NPR \``, inline: true },
                { name: 'Reason', value: reason || 'No reason specified', inline: false }
            ],
            timestamp: new Date().toISOString()
        });
        
        res.json({ success: true, newBalance });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

app.get('/api/analytics', ensureAuthAPI, (req, res) => {
    try {
        const fs = require('fs');
        const users = JSON.parse(fs.readFileSync(path.join(__dirname, 'users.json'), 'utf8') || '{}');
        
        let totalSales = 0;
        let totalDeposits = 0;
        const productCounts = {};
        const dailySales = {};
        
        for (const [userId, user] of Object.entries(users)) {
            const history = user.purchase_history || [];
            for (const item of history) {
                const price = Number(item.price || 0);
                totalSales += price;
                
                const name = item.product || 'Unknown';
                productCounts[name] = (productCounts[name] || 0) + (item.quantity || 1);
                
                if (item.date) {
                    const dateStr = item.date.split('T')[0];
                    dailySales[dateStr] = (dailySales[dateStr] || 0) + price;
                }
            }
        }
        
        const logs = db.getLogs('balance_adjust', 500);
        const dailyDeposits = {};
        for (const logItem of logs) {
            const details = logItem.details || {};
            const amount = Number(details.amount || 0);
            if (amount > 0) {
                totalDeposits += amount;
                if (logItem.timestamp) {
                    const dateStr = logItem.timestamp.split('T')[0];
                    dailyDeposits[dateStr] = (dailyDeposits[dateStr] || 0) + amount;
                }
            }
        }
        
        const labels = [];
        const salesData = [];
        const depositsData = [];
        
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            labels.push(d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
            salesData.push(dailySales[dateStr] || 0);
            depositsData.push(dailyDeposits[dateStr] || 0);
        }
        
        const popularProducts = Object.entries(productCounts)
            .map(([name, qty]) => ({ name, qty }))
            .sort((a, b) => b.qty - a.qty)
            .slice(0, 5);
            
        res.json({
            totalSales,
            totalDeposits,
            charts: {
                labels,
                sales: salesData,
                deposits: depositsData
            },
            popularProducts
        });
    } catch (err) {
        log.error({ error: err.message, stack: err.stack }, 'Failed to generate analytics');
        res.status(500).json({ error: 'Failed to generate analytics' });
    }
});


app.get('/api/logs', ensureAuthAPI, (req, res) => {
    res.json(db.getLogs(req.query.filter || null, 200));
});

const PORT = process.env.ADMIN_PORT || 3001;
app.listen(PORT, () => log.info({ port: PORT }, 'Admin panel running'));