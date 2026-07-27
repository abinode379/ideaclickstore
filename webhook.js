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

async function sendDMWithRetry(discordUserId, embed, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const dmChannel = await axios.post(
                'https://discord.com/api/v10/users/@me/channels',
                { recipient_id: discordUserId },
                { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } }
            );
            await axios.post(
                `https://discord.com/api/v10/channels/${dmChannel.data.id}/messages`,
                { embeds: [embed] },
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

        res.status(200).send('OK');
    } catch (error) {
        log.error({ error: error.message }, 'Webhook error');
        res.status(500).send('Internal Server Error');
    }
});

// Success & Cancel Pages
app.get('/success', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Payment Successful</title><style>body{font-family:Arial;text-align:center;padding:50px;background:#2c2f33;color:white}.btn{background:#5865F2;color:white;padding:15px 30px;text-decoration:none;border-radius:5px;font-size:18px;display:inline-block;margin-top:20px}</style></head><body><h1>✅ Payment Successful!</h1><p>Check your Discord DMs for confirmation.</p><a href="https://discord.com/app" class="btn">Return to Discord</a></body></html>`);
});

app.get('/cancel', (req, res) => {
    res.send(`<!DOCTYPE html><html><head><title>Payment Cancelled</title></head><body style="font-family:Arial;text-align:center;padding:50px;background:#2c2f33;color:white"><h1>❌ Payment Cancelled</h1><p>You cancelled the payment.</p><a href="https://discord.com/app" style="background:#ed4245;color:white;padding:15px 30px;text-decoration:none;border-radius:5px">Return to Discord</a></body></html>`);
});

app.listen(PORT, () => {
    log.info({ port: PORT }, 'Webhook server running');
});
