require('dotenv').config();
const fs = require('fs');
const path = require('path');
const dbModule = require('./db');

const usersPath = path.join(__dirname, 'users.json');
const configPath = path.join(__dirname, 'config.json');
const logsPath = path.join(__dirname, 'admin_logs.json');

console.log('🚀 Starting migration to SQLite...');

// 1. Migrate Users
if (fs.existsSync(usersPath)) {
    console.log('📦 Migrating users.json...');
    const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    let userCount = 0;
    
    dbModule.db.transaction(() => {
        for (const [discordId, data] of Object.entries(usersData)) {
            dbModule.ensureUser(discordId, data.username || '');
            
            dbModule.db.prepare('UPDATE users SET balance_npr = ?, loyalty_points = ?, last_daily_claim = ? WHERE discord_id = ?')
                .run(data.balance_npr || 0, data.loyalty_points || 0, data.last_daily_claim || 0, discordId);
                
            if (Array.isArray(data.purchase_history)) {
                for (const ph of data.purchase_history) {
                    dbModule.db.prepare('INSERT INTO purchase_history (discord_id, product, quantity, price, date) VALUES (?, ?, ?, ?, ?)')
                        .run(discordId, ph.product, ph.quantity || 1, ph.price || 0, ph.date);
                }
            }
            userCount++;
        }
    })();
    
    fs.renameSync(usersPath, `${usersPath}.bak`);
    console.log(`✅ Migrated ${userCount} users!`);
} else {
    console.log('⏭️ No users.json found, skipping.');
}

// 2. Migrate Config
if (fs.existsSync(configPath)) {
    console.log('📦 Migrating config.json...');
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    let configCount = 0;
    
    const keysToMigrate = [
        'usdt_to_npr_rate', 
        'notification_channel_id', 
        'custom_products', 
        'hidden_products', 
        'last_known_stock', 
        'custom_prices'
    ];
    
    for (const key of Object.keys(configData)) {
        if (keysToMigrate.includes(key)) {
            dbModule.setConfig(key, configData[key]);
            configCount++;
        }
    }
    
    fs.renameSync(configPath, `${configPath}.bak`);
    console.log(`✅ Migrated ${configCount} config keys!`);
} else {
    console.log('⏭️ No config.json found, skipping.');
}

// 3. Migrate Admin Logs
if (fs.existsSync(logsPath)) {
    console.log('📦 Migrating admin_logs.json...');
    const logsData = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
    
    dbModule.db.transaction(() => {
        for (const log of logsData) {
            dbModule.appendLog(log);
        }
    })();
    
    fs.renameSync(logsPath, `${logsPath}.bak`);
    console.log(`✅ Migrated ${logsData.length} admin logs!`);
} else {
    console.log('⏭️ No admin_logs.json found, skipping.');
}

console.log('🎉 Migration completed successfully!');
