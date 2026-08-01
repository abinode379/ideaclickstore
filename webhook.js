require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const db = require('./db');
const log = require('./logger').child({ service: 'webhook' });

const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_SECRET = process.env.PAYBRIDGENP_WEBHOOK_SECRET?.trim();
const PORT = process.env.PORT || 3000;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function sendDMWithRetry(discordUserId, payload, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const dmChannel = await axios.post(
                'https://discord.com/api/v10/users/@me/channels',
                { recipient_id: discordUserId },
                { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } }
            );
            const data = (payload.embeds || payload.content) ? payload : { embeds: [payload] };
            await axios.post(
                `https://discord.com/api/v10/channels/${dmChannel.data.id}/messages`,
                data,
                { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } }
            );
            log.info({ userId: discordUserId, attempt }, 'DM sent successfully');
            return true;
        } catch (err) {
            const status = err.response?.status;
            if (status === 429) {
                // Rate limited
                const retryAfter = (err.response?.data?.retry_after || attempt * 2) * 1000;
                log.warn({ userId: discordUserId, attempt, retryAfter }, 'Rate limited, retrying');
                await sleep(retryAfter);
            } else if (status === 403) {
                // DMs disabled
                log.warn({ userId: discordUserId }, 'User has DMs disabled, cannot notify');
                return false;
            } else if (attempt < retries) {
                log.warn({ userId: discordUserId, attempt, error: err.message }, 'DM failed, retrying');
                await sleep(attempt * 1000);
            } else {
                log.error({ userId: discordUserId, error: err.message }, 'DM failed after all retries');
                return false;
            }
        }
    }
    return false;
}

app.post('/webhook/paybridgenp', async (req, res) => {
    try {
        const sig = req.headers['x-paybridgenp-signature'];
        if (WEBHOOK_SECRET && sig) {
            const signatureParts = sig.split(',');
            let timestamp = '', receivedSignature = '';
            signatureParts.forEach(part => {
                if (part.startsWith('t=')) timestamp = part.substring(2);
                if (part.startsWith('v1=')) receivedSignature = part.substring(3);
            });

            const signedPayload = `${timestamp}.${req.rawBody.toString('utf8')}`;
            const expectedSig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(signedPayload).digest('hex');
            
            if (receivedSignature !== expectedSig) {
                log.error('INVALID SIGNATURE!');
                return res.status(401).send('Invalid signature');
            }
        }

        const event = req.body;
        log.info({ type: event.type || event.status }, 'Webhook received');

        const isSuccess = event.type === 'payment.succeeded' || event.status === 'success';

        if (isSuccess) {
            const metadata = event.data?.metadata || event.metadata || {};
            const discordUserId = metadata.discordUserId;
            const amount = metadata.amount || (event.data?.amount / 100) || 'Unknown';
            const username = metadata.discordUsername || 'User';

            if (discordUserId && amount !== 'Unknown') {
                // ADD FUNDS TO USER'S LOCAL BALANCE
                const newBalance = db.addBalance(discordUserId, username, amount);
                log.info({ userId: discordUserId, username, amount, newBalance }, 'Deposit processed');

                if (metadata.autoBuyProductId) {
                    autoPurchaseProduct(discordUserId, username, metadata.autoBuyProductId, parseInt(metadata.autoBuyQuantity || 1));
                } else {
                    // Notify the user on Discord
                    if (DISCORD_TOKEN) {
                        const embed = {
                            title: '✅ Deposit Successful!',
                            description: `Your deposit of **${amount} NPR** has been successfully processed.\n\nYour new bot balance is **${newBalance} NPR**. You can now use the **🛒 Shop**!`,
                            color: 0x00FF00,
                            timestamp: new Date().toISOString()
                        };
                        await sendDMWithRetry(discordUserId, embed);
                    }
                }
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        log.error({ error: error.message }, 'Webhook error');
        res.status(500).send('Internal Server Error');
    }
});

async function autoPurchaseProduct(discordUserId, username, productId, quantity) {
    try {
        let apiProducts = [];
        try {
            const prodRes = await axios.get('https://tunvnmmo.duckdns.org/api/products', {
                headers: { 'X-API-Key': process.env.TUNVNMMO_API_KEY }
            });
            if (Array.isArray(prodRes.data)) apiProducts = prodRes.data;
            else if (prodRes.data && Array.isArray(prodRes.data.products)) apiProducts = prodRes.data.products;
        } catch (apiErr) {
            log.error({ err: apiErr.message }, 'Failed to fetch API products during auto-buy');
        }

        const localProducts = db.getLocalProducts() || [];
        const formattedLocals = localProducts.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description || '',
            price_usdt: Number(p.price) / (db.getConfig('usdt_to_npr_rate') || 250),
            stock: p.infinite_stock ? 9999 : (p.stock ? p.stock.length : 0),
            infinite_stock: !!p.infinite_stock,
            is_local: true,
            price_npr: Number(p.price)
        }));

        const apiFormatted = apiProducts.map(p => {
            const customProducts = db.getConfig('custom_products') || {};
            const custom = customProducts[p.id] || customProducts[String(p.id)] || {};
            return {
                ...p,
                price_npr: Number(custom.price || ((p.price_usdt || 0) * (db.getConfig('usdt_to_npr_rate') || 250))),
                name: custom.name || p.name,
                description: custom.description || p.description || 'No description.'
            };
        });

        const allProducts = [...apiFormatted, ...formattedLocals];
        const product = allProducts.find(p => String(p.id) === String(productId));
        if (!product) throw new Error('Product not found');

        const totalCost = Number(product.price_npr) * quantity;
        
        // Perform transaction
        const txResult = db.purchaseTransaction(discordUserId, product.name, quantity, totalCost);
        
        let details = '';
        if (product.is_local) {
            try {
                const items = db.retrieveLocalStock(productId, quantity);
                details = items.join('\n');
            } catch (localErr) {
                db.refundUser(discordUserId, totalCost);
                throw new Error(`Auto-buy failed: ${localErr.message}`);
            }
        } else {
            try {
                const buyRes = await axios.post(
                    'https://tunvnmmo.duckdns.org/api/buy',
                    { product_id: parseInt(productId), quantity, currency: 'usdt' },
                    { headers: { 'X-API-Key': process.env.TUNVNMMO_API_KEY } }
                );
                const buyData = buyRes.data;
                if (buyData.success === false || buyData.error) throw new Error(buyData.message || 'API returned failure');
                details = buyData.account_details || (buyData.items ? buyData.items.join('\n') : 'No details');
            } catch (apiError) {
                db.refundUser(discordUserId, totalCost);
                throw new Error(`Auto-buy API failed: ${apiError.message}`);
            }
        }

        // Send Success DM
        const safeDetails = details.length > 1000 ? (details.substring(0, 1000) + '\n... (truncated, see full message below)') : details;
        const embed = {
            title: '✅ Auto-Purchase Successful!',
            description: `Thank you for your payment! Bought ${quantity}x **${product.name}**\nTotal Cost: **${totalCost} NPR**\nRemaining Balance: **${txResult.balance_npr} NPR**\n**+${txResult.pointsEarned} Loyalty Points earned!**`,
            color: 0x2ecc71,
            fields: [
                { name: '🔑 Delivery Details', value: `\`\`\`text\n${safeDetails}\n\`\`\`` }
            ],
            timestamp: new Date().toISOString()
        };
        await sendDMWithRetry(discordUserId, embed);

        const limit = 1900;
        if (details.length <= limit) {
            await sendDMWithRetry(discordUserId, { content: `📋 **Copy Code / Account Details below:**\n\`\`\`text\n${details}\n\`\`\`` });
        } else {
            await sendDMWithRetry(discordUserId, { content: `📋 **Copy Code / Account Details:**` });
            for (let i = 0; i < details.length; i += limit) {
                const chunk = details.substring(i, i + limit);
                await sendDMWithRetry(discordUserId, { content: `\`\`\`text\n${chunk}\n\`\`\`` });
            }
        }

        // Send Staff Log
        try {
            const staffEmbed = {
                title: '🛒 Auto-Purchase Logged',
                fields: [
                    { name: 'Buyer', value: `${username} (\`${discordUserId}\`)`, inline: true },
                    { name: 'Product', value: product.name, inline: true },
                    { name: 'Quantity', value: String(quantity), inline: true },
                    { name: 'Total Cost', value: `${totalCost} NPR`, inline: true },
                    { name: 'New Balance', value: `${txResult.balance_npr} NPR`, inline: true }
                ],
                color: 0x3498db,
                timestamp: new Date().toISOString()
            };
            const staffChannelId = db.getConfig('staff_log_channel_id') || process.env.STAFF_LOG_CHANNEL_ID;
            if (staffChannelId) {
                await axios.post(
                    `https://discord.com/api/v10/channels/${staffChannelId}/messages`,
                    { embeds: [staffEmbed] },
                    { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } }
                );
            }
        } catch (staffErr) {
            log.error({ err: staffErr.message }, 'Failed to send staff log for auto-buy');
        }

    } catch (err) {
        log.error({ userId: discordUserId, err: err.message }, 'Auto-purchase execution failed');
        const failEmbed = {
            title: '⚠️ Auto-Purchase Failed',
            description: `Your deposit was successful, but the auto-purchase for your item failed.\n\n**Reason**: ${err.message}\n\nThe funds have been credited to your bot balance. You can manually purchase it using the **🛒 Shop** menu.`,
            color: 0xe74c3c,
            timestamp: new Date().toISOString()
        };
        await sendDMWithRetry(discordUserId, failEmbed);
    }
}

// Success & Cancel Pages
app.get('/success', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title><style>body{font-family:Arial;text-align:center;padding:50px;background:#2c2f33;color:white}.btn{background:#5865F2;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;font-size:18px;display:inline-block;margin-top:20px}</style></head><body><h1>✅ Payment Successful!</h1><p>Check your Discord DMs for confirmation, or return to Discord and click the <b>Check Status</b> button inside the chat.</p><a href="https://discord.com/app" class="btn">Return to Discord</a></body></html>`);
});

app.get('/cancel', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Payment Cancelled</title></head><body style="font-family:Arial;text-align:center;padding:50px;background:#2c2f33;color:white"><h1>❌ Payment Cancelled</h1><p>You cancelled the payment.</p><a href="https://discord.com/app" style="background:#ed4245;color:white;padding:15px 30px;text-decoration:none;border-radius:5px">Return to Discord</a></body></html>`);
});

app.listen(PORT, () => {
    log.info({ port: PORT }, 'Webhook server running');
});
