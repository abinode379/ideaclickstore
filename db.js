const fs = require('fs');
const path = require('path');
const session = require('express-session');

const usersPath = path.join(__dirname, 'users.json');
const configPath = path.join(__dirname, 'config.json');
const logsPath = path.join(__dirname, 'admin_logs.json');
const sessionsPath = path.join(__dirname, 'sessions.json');

// Helper functions for safe sync reads/writes
function readJSON(filePath, defaultVal = {}) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2), 'utf8');
            return defaultVal;
        }
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        return defaultVal;
    }
}

function writeJSON(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function getUser(discordId) {
    const users = readJSON(usersPath);
    const user = users[discordId];
    if (!user) return null;
    return {
        discord_id: discordId,
        username: user.username || '',
        balance_npr: user.balance_npr || 0,
        loyalty_points: user.loyalty_points || 0,
        last_daily_claim: user.last_daily_claim || 0
    };
}

function ensureUser(discordId, username = '') {
    const users = readJSON(usersPath);
    if (!users[discordId]) {
        users[discordId] = {
            username: username,
            balance_npr: 0,
            loyalty_points: 0,
            last_daily_claim: 0,
            purchase_history: []
        };
        writeJSON(usersPath, users);
    } else if (username && users[discordId].username !== username) {
        users[discordId].username = username;
        writeJSON(usersPath, users);
    }
    return getUser(discordId);
}

function getAllUsers() {
    const users = readJSON(usersPath);
    return Object.entries(users).map(([discordId, user]) => {
        return {
            discord_id: discordId,
            username: user.username || '',
            balance_npr: user.balance_npr || 0,
            loyalty_points: user.loyalty_points || 0,
            last_daily_claim: user.last_daily_claim || 0,
            purchase_count: Array.isArray(user.purchase_history) ? user.purchase_history.length : 0,
            purchase_history: user.purchase_history || []
        };
    });
}

function addBalance(discordId, username, amount) {
    ensureUser(discordId, username);
    const users = readJSON(usersPath);
    users[discordId].balance_npr = Number(((users[discordId].balance_npr || 0) + Number(amount)).toFixed(2));
    writeJSON(usersPath, users);
    return users[discordId].balance_npr;
}

function purchaseTransaction(discordId, productName, qty, totalCost) {
    const users = readJSON(usersPath);
    const user = users[discordId];
    if (!user) throw new Error('User not found');
    if (user.balance_npr < totalCost) throw new Error('Insufficient balance');

    user.balance_npr = Number((user.balance_npr - totalCost).toFixed(2));
    const configVal = getConfig('loyalty_earn_rate');
    const earnRate = (configVal !== null && configVal !== undefined) ? Number(configVal) : 10;
    const pointsEarned = earnRate > 0 ? Math.floor(totalCost / earnRate) : 0;
    user.loyalty_points = (user.loyalty_points || 0) + pointsEarned;
    
    if (!Array.isArray(user.purchase_history)) {
        user.purchase_history = [];
    }
    user.purchase_history.push({
        product: productName,
        quantity: qty,
        price: totalCost,
        date: new Date().toISOString()
    });

    writeJSON(usersPath, users);

    return {
        balance_npr: user.balance_npr,
        loyalty_points: user.loyalty_points,
        pointsEarned
    };
}

function refundUser(discordId, amount) {
    const users = readJSON(usersPath);
    if (!users[discordId]) return 0;
    users[discordId].balance_npr = Number(((users[discordId].balance_npr || 0) + Number(amount)).toFixed(2));
    writeJSON(usersPath, users);
    return users[discordId].balance_npr;
}

function redeemPoints(discordId, pointsToRedeem) {
    const users = readJSON(usersPath);
    const user = users[discordId];
    if (!user) throw new Error('User not found');
    if ((user.loyalty_points || 0) < pointsToRedeem) throw new Error('Insufficient points');

    const configVal = getConfig('loyalty_redeem_rate');
    const redeemRate = (configVal !== null && configVal !== undefined) ? Number(configVal) : 10;
    const nprEarned = redeemRate > 0 ? Math.floor(pointsToRedeem / redeemRate) : 0;
    if (nprEarned < 1) throw new Error(`Minimum redeem is ${redeemRate} points`);

    user.loyalty_points = (user.loyalty_points || 0) - pointsToRedeem;
    user.balance_npr = Number(((user.balance_npr || 0) + nprEarned).toFixed(2));

    writeJSON(usersPath, users);

    return {
        balance_npr: user.balance_npr,
        loyalty_points: user.loyalty_points,
        nprEarned
    };
}

function dailyClaim(discordId) {
    ensureUser(discordId);
    const users = readJSON(usersPath);
    const user = users[discordId];
    const now = Date.now();

    if (now - (user.last_daily_claim || 0) < 24 * 60 * 60 * 1000) {
        const nextClaim = (user.last_daily_claim || 0) + 24 * 60 * 60 * 1000;
        throw new Error(`Next claim time: ${nextClaim}`);
    }

    const reward = Math.floor(Math.random() * 10) + 1;
    user.balance_npr = Number(((user.balance_npr || 0) + reward).toFixed(2));
    user.last_daily_claim = now;

    writeJSON(usersPath, users);

    return {
        reward,
        balance_npr: user.balance_npr
    };
}

function adjustBalance(discordId, amount) {
    const users = readJSON(usersPath);
    const user = users[discordId];
    if (!user) throw new Error('User not found');
    if ((user.balance_npr || 0) + amount < 0) throw new Error('Balance cannot be negative');

    user.balance_npr = Number(((user.balance_npr || 0) + amount).toFixed(2));
    writeJSON(usersPath, users);
    return user.balance_npr;
}

function getUserHistory(discordId, page = 0, pageSize = 5) {
    const users = readJSON(usersPath);
    const user = users[discordId];
    if (!user || !Array.isArray(user.purchase_history)) {
        return { items: [], total: 0 };
    }
    const reversed = [...user.purchase_history].reverse();
    const offset = page * pageSize;
    const items = reversed.slice(offset, offset + pageSize);
    return { items, total: reversed.length };
}

function getConfig(key) {
    const config = readJSON(configPath);
    return config[key] !== undefined ? config[key] : null;
}

// Re-write setConfig to safely handle key-value config stores
function setConfig(key, value) {
    const config = readJSON(configPath);
    config[key] = value;
    writeJSON(configPath, config);
}

function getAllConfig() {
    return readJSON(configPath);
}

function appendLog(entry) {
    const logs = readJSON(logsPath, []);
    const logItem = {
        id: logs.length + 1,
        timestamp: new Date().toISOString(),
        action: entry.action,
        details: entry
    };
    delete logItem.details.action; // clean action from details
    logs.push(logItem);
    
    // trim logs to max 500
    if (logs.length > 500) {
        logs.splice(0, logs.length - 500);
    }
    writeJSON(logsPath, logs);
}

function getLogs(filter = null, limit = 100) {
    const logs = readJSON(logsPath, []);
    const reversed = [...logs].reverse();
    const filtered = filter ? reversed.filter(l => l.action === filter) : reversed;
    return filtered.slice(0, limit);
}

// Session store using JSON files (safe, persistent, no sqlite needed)
class SQLiteSessionStore extends session.Store {
    constructor() {
        super();
        setInterval(() => {
            try {
                const sessions = readJSON(sessionsPath);
                let changed = false;
                const now = Math.floor(Date.now() / 1000);
                for (const [sid, sess] of Object.entries(sessions)) {
                    if (sess.expired < now) {
                        delete sessions[sid];
                        changed = true;
                    }
                }
                if (changed) writeJSON(sessionsPath, sessions);
            } catch (e) {}
        }, 60 * 60 * 1000).unref();
    }

    get(sid, cb) {
        try {
            const sessions = readJSON(sessionsPath);
            const sess = sessions[sid];
            if (typeof cb !== 'function') return;
            if (!sess) return cb(null, null);
            if (sess.expired < Math.floor(Date.now() / 1000)) {
                this.destroy(sid, () => cb(null, null));
            } else {
                cb(null, sess.sess);
            }
        } catch (err) {
            if (typeof cb === 'function') cb(err);
        }
    }

    set(sid, sess, cb) {
        try {
            const sessions = readJSON(sessionsPath);
            const maxAge = sess.cookie && sess.cookie.maxAge ? sess.cookie.maxAge : 24 * 60 * 60 * 1000;
            sessions[sid] = {
                sess,
                expired: Math.floor((Date.now() + maxAge) / 1000)
            };
            writeJSON(sessionsPath, sessions);
            if (typeof cb === 'function') cb(null);
        } catch (err) {
            if (typeof cb === 'function') cb(err);
        }
    }

    destroy(sid, cb) {
        try {
            const sessions = readJSON(sessionsPath);
            delete sessions[sid];
            writeJSON(sessionsPath, sessions);
            if (typeof cb === 'function') cb(null);
        } catch (err) {
            if (typeof cb === 'function') cb(err);
        }
    }
}

const localProductsPath = path.join(__dirname, 'local_products.json');

function getLocalProducts() {
    return readJSON(localProductsPath, []);
}

function saveLocalProducts(products) {
    writeJSON(localProductsPath, products);
}

function addLocalProduct(name, description, price, stockLines = [], infinite_stock = false) {
    const products = getLocalProducts();
    const id = 'local_' + Date.now();
    const newProduct = {
        id,
        name,
        description,
        price: Number(price),
        stock: Array.isArray(stockLines) ? stockLines.filter(Boolean) : [],
        hidden: false,
        infinite_stock: !!infinite_stock
    };
    products.push(newProduct);
    saveLocalProducts(products);
    return newProduct;
}

function updateLocalProduct(id, updates) {
    const products = getLocalProducts();
    const product = products.find(p => p.id === id);
    if (!product) throw new Error('Local product not found');

    if (updates.name !== undefined) product.name = updates.name;
    if (updates.description !== undefined) product.description = updates.description;
    if (updates.price !== undefined) product.price = Number(updates.price);
    if (updates.hidden !== undefined) product.hidden = !!updates.hidden;
    if (updates.infinite_stock !== undefined) product.infinite_stock = !!updates.infinite_stock;
    
    if (Array.isArray(updates.stock)) {
        product.stock = updates.stock.filter(Boolean);
    } else if (updates.addStockLines && Array.isArray(updates.addStockLines)) {
        if (product.infinite_stock) {
            if (updates.addStockLines.length > 0) {
                product.stock = [updates.addStockLines[0]];
            }
        } else {
            product.stock = product.stock.concat(updates.addStockLines.filter(Boolean));
        }
    }

    saveLocalProducts(products);
    return product;
}

function deleteLocalProduct(id) {
    let products = getLocalProducts();
    products = products.filter(p => p.id !== id);
    saveLocalProducts(products);
}

function retrieveLocalStock(id, qty) {
    const products = getLocalProducts();
    const product = products.find(p => p.id === id);
    if (!product) throw new Error('Local product not found');

    if (product.infinite_stock) {
        const singleLink = product.stock[0] || 'No link set';
        return Array(qty).fill(singleLink);
    }

    if (product.stock.length < qty) throw new Error('Insufficient stock for local product');

    const items = product.stock.splice(0, qty);
    saveLocalProducts(products);
    return items;
}

module.exports = {
    getUser,
    ensureUser,
    getAllUsers,
    addBalance,
    purchaseTransaction,
    refundUser,
    redeemPoints,
    dailyClaim,
    adjustBalance,
    getUserHistory,
    getConfig,
    setConfig,
    getAllConfig,
    appendLog,
    getLogs,
    SQLiteSessionStore, // keeps the same export name to prevent breaking admin.js
    getLocalProducts,
    saveLocalProducts,
    addLocalProduct,
    updateLocalProduct,
    deleteLocalProduct,
    retrieveLocalStock
};
