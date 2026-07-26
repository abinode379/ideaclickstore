require('dotenv').config();
const express = require('express');
const session = require('express-session');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: process.env.ADMIN_SESSION_SECRET || 'super_secret_key_change_this',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 60 * 60 * 1000 }
}));

function ensureAuth(req, res, next) {
    if (req.session.isAdmin) return next();
    res.redirect('/login');
}

let config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Admin Login</title>
        <style>body{font-family:Arial;max-width:400px;margin:50px auto;padding:20px;background:#2c2f33;color:white;border-radius:10px;} input{width:100%;padding:10px;margin:10px 0;border-radius:5px;border:none;} button{width:100%;padding:10px;background:#7289da;color:white;border:none;border-radius:5px;cursor:pointer;}</style>
        </head>
        <body>
            <h1>🔒 Admin Login</h1>
            <form method="POST" action="/login">
                <input type="password" name="password" placeholder="Enter Admin Password" required>
                <button type="submit">Login</button>
            </form>
        </body>
        </html>
    `);
});

app.post('/login', (req, res) => {
    if (req.body.password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/dashboard');
    } else {
        res.send('<h1 style="color:red;text-align:center;">Invalid Password</h1><a href="/login">Go Back</a>');
    }
});

app.get('/dashboard', ensureAuth, async (req, res) => {
    let products = [];
    try {
        const res2 = await axios.get('https://tunvnmmo.duckdns.org/api/products', { headers: { 'X-API-Key': process.env.TUNVNMMO_API_KEY } });
        products = res2.data.products || res2.data;
    } catch (e) { console.error(e); }

    const hiddenProducts = config.hidden_products || [];

    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Admin Dashboard</title>
        <style>
            body{font-family:Arial;background:#2c2f33;color:white;padding:20px;}
            .card{background:#36393f;padding:20px;border-radius:10px;margin-bottom:20px;}
            input, textarea{width:100%;padding:8px;border-radius:5px;border:none;background:#2f3136;color:white;margin:5px 0;box-sizing:border-box;}
            button{background:#7289da;color:white;border:none;padding:8px 15px;border-radius:5px;cursor:pointer;margin-top:5px;}
            .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(350px,1fr));gap:15px;}
            .item{background:#2f3136;padding:15px;border-radius:8px;}
            label{font-size:12px;color:#b9bbbe;}
            .checkbox-label{display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;color:#ed4245;font-weight:bold;}
            .checkbox-label input{width:auto;margin:0;}
        </style>
        </head>
        <body>
            <h1>🛡️ Admin Dashboard</h1>
            
            <div class="card">
                <h2>⚙️ Global Settings</h2>
                <label>USDT to NPR Exchange Rate:</label>
                <input type="number" id="rate" value="${config.usdt_to_npr_rate}">
                <button onclick="saveSettings()">Save Rate</button>
                <br><br>
                <label>Discord Notification Channel ID:</label>
                <input type="text" id="channel" value="${config.notification_channel_id}" placeholder="e.g., 123456789012345678">
                <button onclick="saveSettings()">Save Channel</button>
                <p id="msg" style="color:green;"></p>
            </div>

            <div class="card">
                <h2>📦 Product Management</h2>
                <p>Leave name/desc/price blank to use default API values. Check "Hide" to remove from shop.</p>
                <div class="grid">
                    ${products.map(p => {
                        const custom = config.custom_products && config.custom_products[p.id] ? config.custom_products[p.id] : {};
                        const isHidden = hiddenProducts.includes(String(p.id));
                        return `
                        <div class="item" style="${isHidden ? 'border: 2px solid #ed4245;' : ''}">
                            <strong>${p.name}</strong> <small>(ID: ${p.id} | Stock: ${p.stock})</small><br>
                            
                            <label>Custom Name (Optional):</label>
                            <input type="text" id="name_${p.id}" value="${custom.name || ''}" placeholder="${p.name}">
                            
                            <label>Custom Description (Optional):</label>
                            <textarea id="desc_${p.id}" rows="3" placeholder="${p.description || 'No description'}">${custom.description || ''}</textarea>
                            
                            <label>Custom Price in NPR (Optional):</label>
                            <input type="number" id="price_${p.id}" value="${custom.price || ''}" placeholder="Auto from USDT">
                            
                            <label class="checkbox-label">
                                <input type="checkbox" id="hidden_${p.id}" ${isHidden ? 'checked' : ''}>
                                Hide this product from shop
                            </label>
                            
                            <button onclick="saveProduct(${p.id})">💾 Save Product</button>
                            <div id="status_${p.id}" style="color:green;margin-top:5px;"></div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>

            <script>
                async function saveSettings() {
                    const rate = document.getElementById('rate').value;
                    const channel = document.getElementById('channel').value;
                    await fetch('/api/settings', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ usdt_to_npr_rate: rate, notification_channel_id: channel })
                    });
                    document.getElementById('msg').innerText = 'Settings saved!';
                }

                async function saveProduct(id) {
                    const name = document.getElementById('name_' + id).value;
                    const description = document.getElementById('desc_' + id).value;
                    const price = document.getElementById('price_' + id).value;
                    const hidden = document.getElementById('hidden_' + id).checked;

                    await fetch('/api/product', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ 
                            product_id: id, 
                            name: name || null, 
                            description: description || null,
                            price: price || null,
                            hidden: hidden
                        })
                    });
                    
                    const statusEl = document.getElementById('status_' + id);
                    statusEl.innerText = hidden ? '✅ Hidden from shop!' : '✅ Saved & Visible!';
                    statusEl.style.color = hidden ? '#ed4245' : 'green';
                    setTimeout(() => { statusEl.innerText = ''; }, 3000);
                    
                    // Reload page after 1 second to update border styles
                    setTimeout(() => { location.reload(); }, 1000);
                }
            </script>
        </body>
        </html>
    `);
});

app.post('/api/settings', ensureAuth, (req, res) => {
    if (req.body.usdt_to_npr_rate) config.usdt_to_npr_rate = Number(req.body.usdt_to_npr_rate);
    if (req.body.notification_channel_id) config.notification_channel_id = req.body.notification_channel_id;
    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
    res.json({ success: true });
});

app.post('/api/product', ensureAuth, (req, res) => {
    const { product_id, name, description, price, hidden } = req.body;
    const pidStr = String(product_id);
    
    // Handle custom product data
    if (!config.custom_products) config.custom_products = {};
    if (!config.custom_products[pidStr]) config.custom_products[pidStr] = {};

    if (name) config.custom_products[pidStr].name = name;
    else delete config.custom_products[pidStr].name;

    if (description) config.custom_products[pidStr].description = description;
    else delete config.custom_products[pidStr].description;

    if (price) config.custom_products[pidStr].price = Number(price);
    else delete config.custom_products[pidStr].price;

    if (Object.keys(config.custom_products[pidStr]).length === 0) {
        delete config.custom_products[pidStr];
    }

    // Handle hidden products array
    if (!config.hidden_products) config.hidden_products = [];
    
    if (hidden) {
        if (!config.hidden_products.includes(pidStr)) {
            config.hidden_products.push(pidStr);
        }
    } else {
        config.hidden_products = config.hidden_products.filter(id => id !== pidStr);
    }

    fs.writeFileSync('config.json', JSON.stringify(config, null, 2));
    res.json({ success: true });
});

const PORT = process.env.ADMIN_PORT || 3001;
app.listen(PORT, () => {
    console.log(`🛡️ Admin panel running on http://localhost:${PORT}`);
});