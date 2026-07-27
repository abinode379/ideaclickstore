require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags 
} = require('discord.js');
const axios = require('axios');
const fs = require('fs');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const tunvnmmoAPI = axios.create({
    baseURL: 'https://tunvnmmo.duckdns.org/api',
    headers: { 'X-API-Key': process.env.TUNVNMMO_API_KEY }
});

const paybridgeAPI = axios.create({
    baseURL: 'https://api.paybridgenp.com/v1',
    headers: {
        'Authorization': `Bearer ${process.env.PAYBRIDGENP_SECRET_KEY}`,
        'Content-Type': 'application/json'
    }
});

const ephemeral = { flags: [MessageFlags.Ephemeral] };

let config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
let users = {};
try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }

function saveUsers() { fs.writeFileSync('users.json', JSON.stringify(users, null, 2)); }
function saveConfig() { fs.writeFileSync('config.json', JSON.stringify(config, null, 2)); }

function extractArray(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        if (Array.isArray(data.products)) return data.products;
        if (Array.isArray(data.orders)) return data.orders;
        if (Array.isArray(data.data)) return data.data;
    }
    return [];
}

function getProductData(product) {
    const custom = config.custom_products && config.custom_products[product.id] ? config.custom_products[product.id] : {};
    return {
        name: custom.name || product.name,
        description: custom.description || product.description || 'No description.',
        price: custom.price || ((product.price_usdt || 0) * config.usdt_to_npr_rate).toFixed(2)
    };
}

async function trackStockChanges() {
    try {
        const res = await tunvnmmoAPI.get('/products');
        const products = extractArray(res.data);
        const channelId = config.notification_channel_id;
        if (!channelId) return;
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        products.forEach(product => {
            const currentStock = product.stock;
            const lastStock = config.last_known_stock[product.id];
            if (lastStock !== undefined && lastStock !== currentStock) {
                const embed = new EmbedBuilder()
                    .setTitle('📦 Stock Update')
                    .setDescription(`${product.name}: ${lastStock} → ${currentStock}`)
                    .setColor(currentStock > 0 ? 0x00FF00 : 0xFF0000)
                    .setTimestamp();
                channel.send({ embeds: [embed] }).catch(console.error);
            }
            config.last_known_stock[product.id] = currentStock;
        });
        saveConfig();
    } catch (error) { console.error('❌ Stock tracker error:', error.message); }
}

client.once('clientReady', async () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    await trackStockChanges();
    setInterval(trackStockChanges, 5 * 60 * 1000); 
});

function getNavRow(excludeButton) {
    const row = new ActionRowBuilder();
    const buttons = [
        { id: 'nav_shop', label: '🛒 Shop', style: ButtonStyle.Primary },
        { id: 'nav_balance', label: '💰 Balance', style: ButtonStyle.Success },
        { id: 'nav_deposit', label: '📥 Deposit', style: ButtonStyle.Secondary },
        { id: 'nav_history', label: '📜 History', style: ButtonStyle.Secondary },
        { id: 'nav_back', label: '🔙 Back', style: ButtonStyle.Danger }
    ];
    buttons.forEach(btn => {
        if (btn.id !== `nav_${excludeButton}`) {
            row.addComponents(new ButtonBuilder().setCustomId(btn.id).setLabel(btn.label).setStyle(btn.style));
        }
    });
    return row;
}

function getMainMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('shop').setLabel('🛒 Shop').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('balance').setLabel('💰 Balance').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('deposit').setLabel('📥 Deposit').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('daily').setLabel('🎁 Daily').setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('history').setLabel('📜 History').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('redeem').setLabel(' Redeem').setStyle(ButtonStyle.Secondary)
        )
    ];
}

// ✅ FIXED: Emoji at the END of label for better Discord rendering
function buildShopRows(products) {
    const rows = [];
    const productsToShow = products.slice(0, 8); 
    
    for (let i = 0; i < productsToShow.length; i += 2) {
        const row = new ActionRowBuilder();
        
        const p1 = productsToShow[i];
        const pData1 = getProductData(p1);
        const stockEmoji1 = (p1.stock ?? 0) > 0 ? '🟢' : '🔴';
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`view_${p1.id}`)
                .setLabel(`${pData1.name.substring(0, 28)} ${stockEmoji1}`)
                .setStyle((p1.stock ?? 0) === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setDisabled((p1.stock ?? 0) === 0)
        );
        
        if (i + 1 < productsToShow.length) {
            const p2 = productsToShow[i + 1];
            const pData2 = getProductData(p2);
            const stockEmoji2 = (p2.stock ?? 0) > 0 ? '🟢' : '🔴';
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`view_${p2.id}`)
                    .setLabel(`${pData2.name.substring(0, 28)} ${stockEmoji2}`)
                    .setStyle((p2.stock ?? 0) === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary)
                    .setDisabled((p2.stock ?? 0) === 0)
            );
        }
        rows.push(row);
    }
    return rows;
}

function getShopEmbed() {
    return new EmbedBuilder()
        .setTitle('🛒 Available Products')
        .setDescription(` **Guide:**
🟢 In Stock | 🔴 Out of Stock
⏱️ D/M = Day/Month | 🛡️ NW = No Warranty | FW = Full Warranty

👇 **Tap a product to view details:**`)
        .setColor(0xFFA500);
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() && !interaction.isButton() && !interaction.isModalSubmit()) return;

    try {
        if (interaction.isChatInputCommand() && interaction.commandName === 'announce') {
            if (!interaction.member.permissions.has('Administrator')) {
                return await interaction.reply({ content: '❌ Admins only.', ...ephemeral });
            }
            const channel = interaction.options.getChannel('channel');
            const modal = new ModalBuilder()
                .setCustomId(`announce_modal_${channel.id}`)
                .setTitle('📢 Send Announcement')
                .addComponents(
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ann_title').setLabel('Title').setStyle(TextInputStyle.Short).setPlaceholder('e.g., New Year Sale!').setRequired(true)),
                    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ann_desc').setLabel('Message Body').setStyle(TextInputStyle.Paragraph).setPlaceholder('Write your announcement details here...').setRequired(true))
                );
            await interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('announce_modal_')) {
            if (!interaction.member.permissions.has('Administrator')) return await interaction.reply({ content: '❌ Admins only.', ...ephemeral });
            const channelId = interaction.customId.replace('announce_modal_', '');
            const channel = client.channels.cache.get(channelId);
            const title = interaction.fields.getTextInputValue('ann_title');
            const desc = interaction.fields.getTextInputValue('ann_desc');
            const embed = new EmbedBuilder().setTitle(`📢 ${title}`).setDescription(desc).setColor(0x0099FF).setFooter({ text: `Announcement by ${interaction.user.tag}` }).setTimestamp();
            if (channel) {
                await channel.send({ embeds: [embed] });
                await interaction.reply({ content: `✅ Announcement successfully sent to ${channel}!`, ...ephemeral });
            } else {
                await interaction.reply({ content: '❌ Could not find the selected channel.', ...ephemeral });
            }
        }

        if (interaction.isChatInputCommand() && interaction.commandName === 'pin') {
            if (!interaction.member.permissions.has('Administrator')) {
                return await interaction.reply({ content: '❌ Admins only.', ...ephemeral });
            }
            const startRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('start').setLabel(' Start Shopping').setStyle(ButtonStyle.Success));
            const embed = new EmbedBuilder()
                .setTitle('🇳🇵 Welcome to IdeaClick Store')
                .setDescription(`━━━━━━━━━━━━━━━━━━━━
**Nepal's #1 Automated Digital Shop**

✨ **What We Offer:**
• Premium Streaming Accounts (Netflix, Spotify, Capcut Pro)
• Software Licenses & Digital Products
• Instant Delivery 24/7
• Secure Payments via eSewa, Khalti & Fonepay

🎁 **Exclusive Features:**
• 🎁 Daily Rewards - Claim free NPR every day!
• 🏆 Loyalty Points - Earn 1 point per 10 NPR spent
• ⚡ Instant Auto-Delivery to your DMs

**Need Help?**
Join our support channel or open a ticket!

**Click "Start Shopping" to begin!**
━━━━━━━━━━━━━━━━━━━━`)
                .setColor(0x0099FF)
                .setFooter({ text: 'Trusted by Nepali Customers | IdeaClick Digital' })
                .setTimestamp();
            await interaction.channel.send({ embeds: [embed], components: [startRow] });
            await interaction.reply({ content: '✅ Permanent Start button posted! Pin this message.', ...ephemeral });
        }

        if (interaction.isButton() && interaction.customId === 'start') {
            const mainMenuEmbed = new EmbedBuilder().setTitle('🏪 Shop Menu').setDescription('Choose an option below:').setColor(0x0099FF);
            await interaction.reply({ embeds: [mainMenuEmbed], components: getMainMenuRows(), ...ephemeral });
        }

        if (interaction.isButton() && interaction.customId === 'shop') {
            const productsResponse = await tunvnmmoAPI.get('/products');
            const allProducts = extractArray(productsResponse.data);
            const hiddenProducts = config.hidden_products || [];
            const products = allProducts.filter(p => !hiddenProducts.includes(String(p.id)));
            if (products.length === 0) return await interaction.update({ content: '📭 No products available.', components: [], ...ephemeral });
            
            const rows = buildShopRows(products);
            rows.push(getNavRow('shop'));
            await interaction.update({ embeds: [getShopEmbed()], components: rows });
        }

        if (interaction.isButton() && interaction.customId === 'balance') {
            try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }
            const user = users[interaction.user.id] || { balance_npr: 0, loyalty_points: 0 };
            const embed = new EmbedBuilder().setTitle('💰 Your Balance').addFields({ name: '💰 Balance', value: `${user.balance_npr} NPR`, inline: true }, { name: '🏆 Loyalty Points', value: `${user.loyalty_points || 0} pts`, inline: true }).setColor(0x00FF00).setTimestamp();
            await interaction.update({ embeds: [embed], components: [getNavRow('balance')] });
        }

        if (interaction.isButton() && interaction.customId === 'history') {
            try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }
            const user = users[interaction.user.id];
            const history = user?.purchase_history || [];
            const embed = new EmbedBuilder().setTitle('📜 Your Purchase History').setColor(0x9900FF);
            if (history.length === 0) embed.setDescription('You have no purchase history yet.');
            else {
                const recentHistory = [...history].reverse().slice(0, 10);
                recentHistory.forEach((purchase, i) => {
                    const date = new Date(purchase.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    embed.addFields({ name: `#${history.length - i} - ${date}`, value: `**${purchase.product}**\nQty: ${purchase.quantity} | Price: ${purchase.price} NPR`, inline: false });
                });
            }
            await interaction.update({ embeds: [embed], components: [getNavRow('history')] });
        }

        if (interaction.isButton() && interaction.customId === 'deposit') {
            const modal = new ModalBuilder().setCustomId('deposit_modal').setTitle('💰 Deposit').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Amount (NPR)').setStyle(TextInputStyle.Short).setPlaceholder('Min: 100').setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'daily') {
            try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }
            if (!users[interaction.user.id]) users[interaction.user.id] = { balance_npr: 0, loyalty_points: 0 };
            const user = users[interaction.user.id];
            const now = Date.now();
            const oneDay = 24 * 60 * 60 * 1000;
            if (user.last_daily_claim && (now - user.last_daily_claim < oneDay)) {
                const nextClaim = new Date(user.last_daily_claim + oneDay);
                return await interaction.reply({ content: `⏰ You already claimed your daily reward! Come back at **${nextClaim.toLocaleTimeString()}**.`, ...ephemeral });
            }
            const reward = Math.floor(Math.random() * 10) + 1;
            user.balance_npr += reward;
            user.last_daily_claim = now;
            saveUsers();
            const embed = new EmbedBuilder().setTitle('🎁 Daily Reward Claimed!').setDescription(`You received **${reward} NPR**! 🎉\nCome back tomorrow for another chance.`).setColor(0x00FF00).setFooter({ text: `New Balance: ${user.balance_npr} NPR` });
            await interaction.reply({ embeds: [embed], ...ephemeral });
        }

        if (interaction.isButton() && interaction.customId === 'redeem') {
            const modal = new ModalBuilder().setCustomId('redeem_modal').setTitle('🏆 Redeem Loyalty Points').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('points').setLabel('Points to Redeem (10 pts = 1 NPR)').setStyle(TextInputStyle.Short).setPlaceholder('e.g., 100').setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'nav_shop') {
            const productsResponse = await tunvnmmoAPI.get('/products');
            const allProducts = extractArray(productsResponse.data);
            const hiddenProducts = config.hidden_products || [];
            const products = allProducts.filter(p => !hiddenProducts.includes(String(p.id)));
            const rows = buildShopRows(products);
            rows.push(getNavRow('shop'));
            await interaction.update({ embeds: [getShopEmbed()], components: rows });
        }

        if (interaction.isButton() && interaction.customId === 'nav_balance') {
            try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }
            const user = users[interaction.user.id] || { balance_npr: 0, loyalty_points: 0 };
            const embed = new EmbedBuilder().setTitle('💰 Balance').addFields({ name: '💰 Balance', value: `${user.balance_npr} NPR`, inline: true }, { name: ' Loyalty Points', value: `${user.loyalty_points || 0} pts`, inline: true }).setColor(0x00FF00).setTimestamp();
            await interaction.update({ embeds: [embed], components: [getNavRow('balance')] });
        }

        if (interaction.isButton() && interaction.customId === 'nav_history') {
            try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }
            const user = users[interaction.user.id];
            const history = user?.purchase_history || [];
            const embed = new EmbedBuilder().setTitle('📜 Your Purchase History').setColor(0x9900FF);
            if (history.length === 0) embed.setDescription('You have no purchase history yet.');
            else {
                const recentHistory = [...history].reverse().slice(0, 10);
                recentHistory.forEach((purchase, i) => {
                    const date = new Date(purchase.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                    embed.addFields({ name: `#${history.length - i} - ${date}`, value: `**${purchase.product}**\nQty: ${purchase.quantity} | Price: ${purchase.price} NPR`, inline: false });
                });
            }
            await interaction.update({ embeds: [embed], components: [getNavRow('history')] });
        }

        if (interaction.isButton() && interaction.customId === 'nav_deposit') {
            const modal = new ModalBuilder().setCustomId('deposit_modal_nav').setTitle('💰 Deposit').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Amount (NPR)').setStyle(TextInputStyle.Short).setPlaceholder('Min: 100').setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'nav_back') {
            const mainMenuEmbed = new EmbedBuilder().setTitle('🏪 Shop Menu').setDescription('Choose an option below:').setColor(0x0099FF);
            await interaction.update({ embeds: [mainMenuEmbed], components: getMainMenuRows() });
        }

        if (interaction.isButton() && interaction.customId.startsWith('view_')) {
            const productId = interaction.customId.replace('view_', '');
            const productsResponse = await tunvnmmoAPI.get('/products');
            const product = extractArray(productsResponse.data).find(p => String(p.id) === String(productId));
            if (!product) return await interaction.reply({ content: ' Not found', ...ephemeral });
            const pData = getProductData(product);
            const embed = new EmbedBuilder().setTitle(`📦 ${pData.name}`).setDescription(pData.description).addFields({ name: ' Price', value: `${pData.price} NPR`, inline: true }, { name: '📦 Stock', value: `${product.stock ?? 0}`, inline: true }).setColor((product.stock ?? 0) > 0 ? 0x00FF00 : 0xFF0000);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`buy_${product.id}`).setLabel('🛒 Buy').setStyle(ButtonStyle.Success).setDisabled((product.stock ?? 0) === 0),
                new ButtonBuilder().setCustomId('nav_shop').setLabel('🔙 Back to Shop').setStyle(ButtonStyle.Secondary)
            );
            await interaction.update({ embeds: [embed], components: [row] });
        }

        if (interaction.isButton() && interaction.customId.startsWith('buy_')) {
            const productId = interaction.customId.replace('buy_', '');
            const productsResponse = await tunvnmmoAPI.get('/products');
            const product = extractArray(productsResponse.data).find(p => String(p.id) === String(productId));
            if (!product) return await interaction.reply({ content: '❌ Not found', ...ephemeral });
            const pData = getProductData(product);
            const modal = new ModalBuilder().setCustomId(`purchase_${productId}`).setTitle(`Buy: ${pData.name.substring(0, 30)}`).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qty').setLabel('Quantity').setStyle(TextInputStyle.Short).setPlaceholder(`Max: ${product.stock}`).setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('purchase_')) {
            const productId = interaction.customId.replace('purchase_', '');
            const quantity = parseInt(interaction.fields.getTextInputValue('qty'));
            await interaction.deferReply({ ...ephemeral });
            try {
                const productsRes = await tunvnmmoAPI.get('/products');
                const product = extractArray(productsRes.data).find(p => String(p.id) === String(productId));
                if (!product) throw new Error("Product not found");
                const pData = getProductData(product);
                const totalCost = Number(pData.price) * quantity;
                try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }
                if (!users[interaction.user.id]) users[interaction.user.id] = { balance_npr: 0, loyalty_points: 0, purchase_history: [] };
                if (users[interaction.user.id].balance_npr < totalCost) throw new Error(`Need ${totalCost} NPR, have ${users[interaction.user.id].balance_npr} NPR`);
                const buyRes = await tunvnmmoAPI.post('/buy', { product_id: parseInt(productId), quantity, currency: 'usdt' });
                const data = buyRes.data;
                if (data.success === false || data.error) throw new Error(data.message || "Failed");
                users[interaction.user.id].balance_npr -= totalCost;
                const pointsEarned = Math.floor(totalCost / 10);
                if (!users[interaction.user.id].loyalty_points) users[interaction.user.id].loyalty_points = 0;
                users[interaction.user.id].loyalty_points += pointsEarned;
                if (!users[interaction.user.id].purchase_history) users[interaction.user.id].purchase_history = [];
                users[interaction.user.id].purchase_history.push({ product: pData.name, price: totalCost, quantity: quantity, date: new Date().toISOString() });
                saveUsers();
                let details = data.account_details || (data.items ? data.items.join('\n') : "No details");
                const embed = new EmbedBuilder().setTitle('✅ Success!').setDescription(`Bought ${quantity}x ${pData.name}\nCost: ${totalCost} NPR\nBalance: ${users[interaction.user.id].balance_npr} NPR\n**+${pointsEarned} Loyalty Points earned!**`).addFields({ name: 'Details', value: `\`\`\`${details}\`\`\`` }).setColor(0x00FF00);
                try { await interaction.user.send({ embeds: [embed] }); } catch(e) {}
                await interaction.editReply({ embeds: [embed.setDescription(`Bought ${quantity}x ${pData.name}\nCheck DMs for details!`)], components: [getNavRow('shop')] });
            } catch (error) { await interaction.editReply({ content: `❌ ${error.message}`, components: [getNavRow('shop')] }); }
        }

        if (interaction.isModalSubmit() && interaction.customId === 'redeem_modal') {
            const pointsToRedeem = parseInt(interaction.fields.getTextInputValue('points'));
            if (isNaN(pointsToRedeem) || pointsToRedeem <= 0) return await interaction.reply({ content: ' Invalid points amount.', ...ephemeral });
            try { users = JSON.parse(fs.readFileSync('users.json', 'utf8')); } catch (e) { users = {}; }
            const user = users[interaction.user.id];
            if (!user || !user.loyalty_points || user.loyalty_points < pointsToRedeem) return await interaction.reply({ content: `❌ You don't have enough points! You have **${user?.loyalty_points || 0}** points.`, ...ephemeral });
            const nprEarned = Math.floor(pointsToRedeem / 10);
            if (nprEarned < 1) return await interaction.reply({ content: '❌ Minimum redeem is 10 points (equals 1 NPR).', ...ephemeral });
            user.loyalty_points -= pointsToRedeem;
            user.balance_npr += nprEarned;
            saveUsers();
            const embed = new EmbedBuilder().setTitle('🏆 Points Redeemed!').setDescription(`You exchanged **${pointsToRedeem} points** for **${nprEarned} NPR**! 💰`).setColor(0xFFD700).setFooter({ text: `Points left: ${user.loyalty_points} | Balance: ${user.balance_npr} NPR` });
            await interaction.reply({ embeds: [embed], ...ephemeral });
        }

        if (interaction.isModalSubmit() && (interaction.customId === 'deposit_modal' || interaction.customId === 'deposit_modal_nav')) {
            const amount = parseInt(interaction.fields.getTextInputValue('amount'));
            if (amount < 100) return await interaction.reply({ content: '❌ Min 100 NPR', ...ephemeral });
            await interaction.deferReply({ ...ephemeral });
            const tunnelUrl = process.env.TUNNEL_URL || 'http://localhost:3000';
            try {
                const session = await paybridgeAPI.post('/checkout', { amount: amount * 100, returnUrl: `${tunnelUrl}/success`, cancelUrl: `${tunnelUrl}/cancel`, metadata: { discordUserId: interaction.user.id, discordUsername: interaction.user.tag, amount } });
                const embed = new EmbedBuilder().setTitle('📥 Deposit').setDescription(`${amount} NPR\nClick to pay:`).setColor(0x0099FF);
                const payRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('💳 Pay').setURL(session.data.checkout_url).setStyle(ButtonStyle.Link));
                const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nav_back').setLabel('🔙 Back to Main Menu').setStyle(ButtonStyle.Danger));
                await interaction.editReply({ embeds: [embed], components: [payRow, backRow] });
            } catch (error) { await interaction.editReply({ content: '❌ Deposit failed' }); }
        }

    } catch (error) { console.error('❌ Error:', error.message); }
});

client.login(process.env.DISCORD_TOKEN);