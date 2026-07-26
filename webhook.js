require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const fs = require('fs');

const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const WEBHOOK_SECRET = process.env.PAYBRIDGENP_WEBHOOK_SECRET?.trim();
const PORT = process.env.PORT || 3000;

// Helper to manage local user balances
function addUserBalance(userId, username, amount) {
    let users = {};
    try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) {}
    
    if (!users[userId]) {
        users[userId] = { balance_npr: 0, username: username };
    }
    users[userId].balance_npr += Number(amount);
    fs.writeFileSync('users.json', JSON.stringify(users, null, 2));
    return users[userId].balance_npr;
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
                console.error('❌ INVALID SIGNATURE!');
                return res.status(401).send('Invalid signature');
            }
        }

        const event = req.body;
        console.log('📩 Webhook received:', event.type || event.status);

        const isSuccess = event.type === 'payment.succeeded' || event.status === 'success';

        if (isSuccess) {
            const metadata = event.data?.metadata || event.metadata || {};
            const discordUserId = metadata.discordUserId;
            const amount = metadata.amount || (event.data?.amount / 100) || 'Unknown';
            const username = metadata.discordUsername || 'User';

            if (discordUserId && amount !== 'Unknown') {
                // 💰 ADD FUNDS TO USER'S LOCAL BALANCE
                const newBalance = addUserBalance(discordUserId, username, amount);
                console.log(`💰 Added ${amount} NPR to ${username}. New Balance: ${newBalance} NPR`);

                // Notify the user on Discord
                if (DISCORD_TOKEN) {
                    try {
                        const dmChannel = await axios.post(
                            'https://discord.com/api/v10/users/@me/channels',
                            { recipient_id: discordUserId },
                            { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } }
                        );

                        await axios.post(
                            `https://discord.com/api/v10/channels/${dmChannel.data.id}/messages`,
                            {
                                embeds: [{
                                    title: '✅ Deposit Successful!',
                                    description: `Your deposit of **${amount} NPR** has been successfully processed.\n\nYour new bot balance is **${newBalance} NPR**. You can now use the **🛒 Shop**!`,
                                    color: 0x00FF00,
                                    timestamp: new Date().toISOString()
                                }]
                            },
                            { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } }
                        );
                        console.log(`✅ Notified user ${discordUserId}`);
                    } catch (error) {
                        console.error('❌ Failed to send DM:', error.message);
                    }
                }
            }
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('❌ Webhook error:', error.message);
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
    console.log(`✅ Webhook server running on port ${PORT}`);
});

