require('dotenv').config();
const { 
    Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, 
    EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
    StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} = require('discord.js');
const axios = require('axios');
const db = require('./db');
const log = require('./logger').child({ service: 'bot' });

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

const SHOP_PAGE_SIZE = 6;
const HISTORY_PAGE_SIZE = 5;

async function sendStaffLog(embed) {
    try {
        const channelId = db.getConfig('staff_log_channel_id') || process.env.STAFF_LOG_CHANNEL_ID;
        if (!channelId) return;
        const channel = client.channels.cache.get(channelId);
        if (channel) {
            await channel.send({ embeds: [embed] });
        }
    } catch (e) {
        log.error({ err: e.message }, 'Failed to send staff log');
    }
}

async function runDailyBackup() {
    try {
        const fs = require('fs');
        const channelId = db.getConfig('backup_channel_id') || process.env.BACKUP_CHANNEL_ID;
        if (!channelId) return;
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;
        
        const files = [];
        if (fs.existsSync('users.json')) files.push({ attachment: 'users.json', name: `users_${Date.now()}.json` });
        if (fs.existsSync('config.json')) files.push({ attachment: 'config.json', name: `config_${Date.now()}.json` });
        if (fs.existsSync('sessions.json')) files.push({ attachment: 'sessions.json', name: `sessions_${Date.now()}.json` });
        
        if (files.length > 0) {
            await channel.send({
                content: `📅 **Daily Database Backup** - ${new Date().toLocaleString()}`,
                files: files
            });
            log.info('Daily database backup uploaded successfully');
        }
    } catch (e) {
        log.error({ err: e.message }, 'Failed to run daily database backup');
    }
}

function extractArray(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
        if (Array.isArray(data.products)) return data.products;
        if (Array.isArray(data.orders)) return data.orders;
        if (Array.isArray(data.data)) return data.data;
    }
    return [];
}

function sortProducts(products) {
    const productOrder = db.getConfig('product_order') || [];
    if (productOrder.length > 0) {
        products.sort((a, b) => {
            const idxA = productOrder.indexOf(String(a.id));
            const idxB = productOrder.indexOf(String(b.id));
            if (idxA === -1 && idxB === -1) return 0;
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
    }
    return products;
}

function getProductData(product) {
    if (product.is_local) {
        return {
            name: product.name,
            description: product.description || 'No description.',
            price: ((product.price_usdt || 0) * (db.getConfig('usdt_to_npr_rate') || 250)).toFixed(2)
        };
    }
    const customProducts = db.getConfig('custom_products') || {};
    const custom = customProducts[product.id] || customProducts[String(product.id)] || {};
    return {
        name: custom.name || product.name,
        description: custom.description || product.description || 'No description.',
        price: custom.price || ((product.price_usdt || 0) * (db.getConfig('usdt_to_npr_rate') || 250)).toFixed(2)
    };
}

async function getMergedProducts() {
    try {
        const res = await tunvnmmoAPI.get('/products');
        const apiProducts = extractArray(res.data);
        const localProducts = db.getLocalProducts();
        
        const formattedLocals = localProducts.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description || '',
            price_usdt: Number(p.price) / (db.getConfig('usdt_to_npr_rate') || 250),
            stock: p.stock ? p.stock.length : 0,
            is_local: true
        }));
        
        return [...apiProducts, ...formattedLocals];
    } catch (e) {
        log.error({ err: e.message }, 'Failed to fetch merged products');
        try {
            const localProducts = db.getLocalProducts();
            return localProducts.map(p => ({
                id: p.id,
                name: p.name,
                description: p.description || '',
                price_usdt: Number(p.price) / (db.getConfig('usdt_to_npr_rate') || 250),
                stock: p.stock ? p.stock.length : 0,
                is_local: true
            }));
        } catch (localErr) {
            return [];
        }
    }
}

function getProductEmoji(name) {
    const lower = (name || '').toLowerCase();
    let emojiName = '🔹';
    if (lower.includes('chatgpt') || lower.includes('chat gpt')) emojiName = 'ChatGPT';
    else if (lower.includes('capcut')) emojiName = 'Capcut';
    else if (lower.includes('linkedin')) emojiName = 'LinkedIn';
    else if (lower.includes('gemini')) emojiName = 'gemini~1';
    else if (lower.includes('grok')) emojiName = 'Grok';
    else if (lower.includes('api')) emojiName = 'ActiveDeveloper';
    else return '🔹';

    const foundEmoji = client.emojis.cache.find(e => e.name.toLowerCase() === emojiName.toLowerCase().replace('~1', ''));
    if (foundEmoji) {
        return `<:${foundEmoji.name}:${foundEmoji.id}>`;
    }
    return `:${emojiName}:`;
}

async function updateAvailableProductsChannel() {
    try {
        const channelId = db.getConfig('available_products_channel_id');
        if (!channelId) return;
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        const allProducts = await getMergedProducts();
        const hiddenProducts = db.getConfig('hidden_products') || [];
        
        let products = allProducts.filter(p => !hiddenProducts.includes(String(p.id)));
        products = sortProducts(products);

        let descriptionText = `🇳🇵 **IdeaClick Live Product Catalog**\n\n`;
        if (products.length === 0) {
            descriptionText += `📭 *No products currently available.*`;
        } else {
            products.forEach(product => {
                const pData = getProductData(product);
                const bar = getProgressBar(product.stock ?? 0);
                const emoji = getProductEmoji(pData.name);
                descriptionText += `${emoji} **${pData.name}**\n${bar}\n\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🏪 Live Product Catalog')
            .setDescription(descriptionText)
            .setColor(0x8b5cf6)
            .setTimestamp();

        const messages = await channel.messages.fetch({ limit: 50 });
        const botMessage = messages.find(m => m.author.id === client.user.id);

        if (botMessage) {
            await botMessage.edit({ embeds: [embed], components: [] });
        } else {
            await channel.send({ embeds: [embed] });
        }
        log.info('Live catalog channel updated successfully.');
    } catch (e) {
        log.error({ err: e.message }, 'Failed to update live catalog channel');
    }
}

async function trackStockChanges() {
    try {
        const products = await getMergedProducts();
        const channelId = db.getConfig('notification_channel_id');
        if (!channelId) return;
        const channel = client.channels.cache.get(channelId);
        if (!channel) return;

        let lastKnownStock = db.getConfig('last_known_stock') || {};
        let updated = false;

        for (const product of products) {
            const currentStock = Number(product.stock || 0);
            const lastStock = lastKnownStock[String(product.id)] !== undefined ? Number(lastKnownStock[String(product.id)]) : undefined;
            
            if (lastStock !== undefined && lastStock !== currentStock) {
                const pData = getProductData(product);
                
                let title = '📦 STOCK UPDATE';
                let color = 0x9b59b6; // Purple (Standard update)
                let mention = '';
                let statusText = '🟢 Available';
                
                if (lastStock === 0 && currentStock > 0) {
                    title = '🎉 PRODUCT RESTOCKED!';
                    color = 0x2ecc71; // Vivid Green
                    mention = '@everyone ';
                    statusText = '🟢 Back in Stock!';
                } else if (currentStock === 0 && lastStock > 0) {
                    title = '🔴 SOLD OUT';
                    color = 0xe74c3c; // Vivid Red
                    statusText = '🔴 Temporarily Out of Stock';
                } else if (currentStock > lastStock) {
                    title = '📈 STOCK INCREASED';
                    color = 0x2ecc71; // Green
                    statusText = '🟢 Stock Refilled';
                } else if (currentStock < lastStock) {
                    title = '📉 STOCK DECREASED';
                    color = 0xe67e22; // Orange
                    statusText = currentStock <= 5 ? '🟡 Low Stock!' : '🟢 Available';
                }

                const embed = new EmbedBuilder()
                    .setTitle(title)
                    .setDescription(`### ${getProductEmoji(pData.name)} ${pData.name}`)
                    .addFields(
                        { name: '📊 Stock Change', value: `\` ${lastStock} \` ➔ \` ${currentStock} \``, inline: true },
                        { name: '⚡ Status', value: `**${statusText}**`, inline: true }
                    )
                    .setColor(color)
                    .setFooter({ text: 'IdeaClick Automated Shop Alerts' })
                    .setTimestamp();
                    
                await channel.send({
                    content: mention,
                    embeds: [embed]
                }).catch(err => log.error({ err: err.message }, 'Failed to send stock alert'));

                // Fake live sale notification when stock decreases
                if (currentStock < lastStock) {
                    const diff = lastStock - currentStock;
                    const liveSalesChannelId = db.getConfig('live_sales_channel_id');
                    if (liveSalesChannelId) {
                        const liveSalesChannel = client.channels.cache.get(liveSalesChannelId);
                        if (liveSalesChannel) {
                            const fakePurchaseEmbed = new EmbedBuilder()
                                .setDescription(`🛒 **New Purchase!** 👤 An anonymous customer just bought **${diff}x ${getProductEmoji(pData.name)} ${pData.name}**! ⚡ Delivery Speed: **Instant (0.1s)**`)
                                .setColor(0x2ecc71);

                            await liveSalesChannel.send({ embeds: [fakePurchaseEmbed] }).catch(err => log.error({ err: err.message }, 'Failed to send fake live sale alert'));
                        }
                    }
                }
                
                // Send owner DM warning if stock is low
                const ownerId = db.getConfig('owner_discord_id') || process.env.OWNER_DISCORD_ID;
                if (ownerId && currentStock <= 5 && (lastStock === undefined || lastStock > 5)) {
                    try {
                        const owner = await client.users.fetch(ownerId);
                        if (owner) {
                            const warningEmbed = new EmbedBuilder()
                                .setTitle('⚠️ Low Stock Warning')
                                .setDescription(`The product **${pData.name}** is low in stock!\nRemaining Stock: **${currentStock}**`)
                                .setColor(0xe67e22)
                                .setTimestamp();
                            await owner.send({ embeds: [warningEmbed] });
                        }
                    } catch (e) {
                        log.error({ err: e.message, ownerId }, 'Failed to send low stock alert to owner');
                    }
                }
                
                log.info({ product: product.name, lastStock, currentStock }, 'Stock updated');
            }
            lastKnownStock[String(product.id)] = currentStock;
            updated = true;
        }
        
        if (updated) {
            db.setConfig('last_known_stock', lastKnownStock);
            await updateAvailableProductsChannel();
        }
    } catch (error) { log.error({ err: error.message }, 'Stock tracker error'); }
}

client.once('clientReady', async () => {
    log.info({ user: client.user.tag }, 'Bot logged in');
    await trackStockChanges();
    await updateAvailableProductsChannel();
    setInterval(trackStockChanges, 1 * 60 * 1000); 
    
    // Daily database backup
    await runDailyBackup();
    setInterval(runDailyBackup, 24 * 60 * 60 * 1000);
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

function buildShopRows(products, page = 0) {
    const rows = [];
    const start = page * SHOP_PAGE_SIZE;
    const productsToShow = products.slice(start, start + SHOP_PAGE_SIZE);
    
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

function getProgressBar(stock) {
    const maxCapacity = 100;
    const filledBlocks = Math.max(0, Math.min(10, Math.round((stock / maxCapacity) * 10)));
    const emptyBlocks = 10 - filledBlocks;
    const bar = '█'.repeat(filledBlocks) + '░'.repeat(emptyBlocks);
    if (stock === 0) {
        return `\`[░░░░░░░░░░]\` **Out of Stock**`;
    }
    return `\`[${bar}]\` (${stock} left)`;
}

function getShopPaginationRow(page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`shop_page_${page - 1}`)
            .setLabel('◀ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId('shop_pageinfo')
            .setLabel(`Page ${page + 1} / ${totalPages}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId(`shop_page_${page + 1}`)
            .setLabel('Next ▶')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
    );
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

async function renderShopPage(interaction, products, page) {
    const totalPages = Math.max(1, Math.ceil(products.length / SHOP_PAGE_SIZE));
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;
    
    const rows = buildShopRows(products, page);
    if (totalPages > 1) {
        rows.push(getShopPaginationRow(page, totalPages));
    }
    rows.push(getNavRow('shop'));
    
    const embed = getShopEmbed();
    if (totalPages > 1) {
        embed.setFooter({ text: `Page ${page + 1} of ${totalPages} • ${products.length} products` });
    }
    
    await interaction.update({ embeds: [embed], components: rows });
}

async function renderHistoryPage(interaction, page) {
    const { items, total } = db.getUserHistory(interaction.user.id, page, HISTORY_PAGE_SIZE);
    const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
    if (page < 0) page = 0;
    if (page >= totalPages) page = totalPages - 1;
    
    const embed = new EmbedBuilder()
        .setTitle('📜 Your Purchase History')
        .setColor(0x9900FF);
    
    if (items.length === 0) {
        embed.setDescription('You have no purchase history yet.');
    } else {
        items.forEach((purchase, i) => {
            const globalIndex = total - (page * HISTORY_PAGE_SIZE + i);
            const date = new Date(purchase.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
            embed.addFields({ name: `#${globalIndex} - ${date}`, value: `**${purchase.product}**\nQty: ${purchase.quantity} | Price: ${purchase.price} NPR`, inline: false });
        });
        embed.setFooter({ text: `Page ${page + 1} of ${totalPages} • ${total} total purchases` });
    }
    
    const components = [];
    if (totalPages > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`history_page_${page - 1}`)
                .setLabel('◀ Previous')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId('history_pageinfo')
                .setLabel(`Page ${page + 1} / ${totalPages}`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(true),
            new ButtonBuilder()
                .setCustomId(`history_page_${page + 1}`)
                .setLabel('Next ▶')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page >= totalPages - 1)
        ));
    }
    components.push(getNavRow('history'));
    
    await interaction.update({ embeds: [embed], components });
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
            const hiddenProducts = db.getConfig('hidden_products') || [];
            const products = sortProducts(allProducts.filter(p => !hiddenProducts.includes(String(p.id))));
            if (products.length === 0) return await interaction.update({ content: '📭 No products available.', components: [], ...ephemeral });
            await renderShopPage(interaction, products, 0);
        }

        if (interaction.isButton() && interaction.customId === 'balance') {
            const user = db.getUser(interaction.user.id) || { balance_npr: 0, loyalty_points: 0 };
            const embed = new EmbedBuilder().setTitle('💰 Your Balance').addFields({ name: '💰 Balance', value: `${user.balance_npr} NPR`, inline: true }, { name: '🏆 Loyalty Points', value: `${user.loyalty_points || 0} pts`, inline: true }).setColor(0x00FF00).setTimestamp();
            await interaction.update({ embeds: [embed], components: [getNavRow('balance')] });
        }

        if (interaction.isButton() && interaction.customId === 'history') {
            await renderHistoryPage(interaction, 0);
        }

        if (interaction.isButton() && interaction.customId === 'deposit') {
            const modal = new ModalBuilder().setCustomId('deposit_modal').setTitle('💰 Deposit').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Amount (NPR)').setStyle(TextInputStyle.Short).setPlaceholder('Min: 100').setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'daily') {
            try {
                db.ensureUser(interaction.user.id);
                const result = db.dailyClaim(interaction.user.id);
                const embed = new EmbedBuilder()
                    .setTitle('🎁 Daily Reward Claimed!')
                    .setDescription(`You received **${result.reward} NPR**! 🎉\nCome back tomorrow.`)
                    .setColor(0x00FF00)
                    .setFooter({ text: `New Balance: ${result.balance_npr} NPR` });
                
                await sendStaffLog(
                    new EmbedBuilder()
                        .setTitle('🎁 Daily Reward Logged')
                        .addFields(
                            { name: 'User', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Reward', value: `\` ${result.reward} NPR \``, inline: true },
                            { name: 'New Balance', value: `\` ${result.balance_npr} NPR \``, inline: true }
                        )
                        .setColor(0x2ecc71)
                        .setTimestamp()
                );
                
                await interaction.reply({ embeds: [embed], ...ephemeral });
            } catch (error) {
                let msg = error.message;
                if (msg.startsWith('Next claim time: ')) {
                    const timeMs = Number(msg.replace('Next claim time: ', ''));
                    if (!isNaN(timeMs)) {
                        const timeSecs = Math.floor(timeMs / 1000);
                        msg = `Next claim time: <t:${timeSecs}:F> (<t:${timeSecs}:R>)`;
                    }
                }
                await interaction.reply({ content: `⏰ ${msg}`, ...ephemeral });
            }
        }

        if (interaction.isButton() && interaction.customId === 'redeem') {
            const modal = new ModalBuilder().setCustomId('redeem_modal').setTitle('🏆 Redeem Loyalty Points').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('points').setLabel('Points to Redeem (10 pts = 1 NPR)').setStyle(TextInputStyle.Short).setPlaceholder('e.g., 100').setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'nav_shop') {
            const allProducts = await getMergedProducts();
            const hiddenProducts = db.getConfig('hidden_products') || [];
            const products = sortProducts(allProducts.filter(p => !hiddenProducts.includes(String(p.id))));
            if (products.length === 0) return await interaction.update({ content: '📭 No products available.', components: [], ...ephemeral });
            await renderShopPage(interaction, products, 0);
        }

        if (interaction.isButton() && interaction.customId === 'nav_balance') {
            const user = db.getUser(interaction.user.id) || { balance_npr: 0, loyalty_points: 0 };
            const embed = new EmbedBuilder().setTitle('💰 Balance').addFields({ name: '💰 Balance', value: `${user.balance_npr} NPR`, inline: true }, { name: ' Loyalty Points', value: `${user.loyalty_points || 0} pts`, inline: true }).setColor(0x00FF00).setTimestamp();
            await interaction.update({ embeds: [embed], components: [getNavRow('balance')] });
        }

        if (interaction.isButton() && interaction.customId === 'nav_history') {
            await renderHistoryPage(interaction, 0);
        }

        if (interaction.isButton() && interaction.customId === 'nav_deposit') {
            const modal = new ModalBuilder().setCustomId('deposit_modal_nav').setTitle('💰 Deposit').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('amount').setLabel('Amount (NPR)').setStyle(TextInputStyle.Short).setPlaceholder('Min: 100').setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'nav_back') {
            const mainMenuEmbed = new EmbedBuilder().setTitle('🏪 Shop Menu').setDescription('Choose an option below:').setColor(0x0099FF);
            await interaction.update({ embeds: [mainMenuEmbed], components: getMainMenuRows() });
        }

        if (interaction.isButton() && interaction.customId.startsWith('shop_page_')) {
            const page = parseInt(interaction.customId.replace('shop_page_', ''));
            if (isNaN(page)) return;
            const allProducts = await getMergedProducts();
            const hiddenProducts = db.getConfig('hidden_products') || [];
            const products = sortProducts(allProducts.filter(p => !hiddenProducts.includes(String(p.id))));
            await renderShopPage(interaction, products, page);
        }

        if (interaction.isButton() && interaction.customId.startsWith('history_page_')) {
            const page = parseInt(interaction.customId.replace('history_page_', ''));
            if (isNaN(page)) return;
            await renderHistoryPage(interaction, page);
        }

        if (interaction.isButton() && interaction.customId.startsWith('view_')) {
            const productId = interaction.customId.replace('view_', '');
            const allProducts = await getMergedProducts();
            const product = allProducts.find(p => String(p.id) === String(productId));
            if (!product) return await interaction.reply({ content: '❌ Not found', ...ephemeral });
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
            const allProducts = await getMergedProducts();
            const product = allProducts.find(p => String(p.id) === String(productId));
            if (!product) return await interaction.reply({ content: '❌ Not found', ...ephemeral });
            const pData = getProductData(product);
            const modal = new ModalBuilder().setCustomId(`purchase_${productId}`).setTitle(`Buy: ${pData.name.substring(0, 30)}`).addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('qty').setLabel('Quantity').setStyle(TextInputStyle.Short).setPlaceholder(`Max: ${product.stock}`).setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId.startsWith('confirmbuy_')) {
            const parts = interaction.customId.split('_');
            const productId = parts[1];
            const quantity = parseInt(parts[2]);
            await interaction.deferUpdate();
            try {
                const allProducts = await getMergedProducts();
                const product = allProducts.find(p => String(p.id) === String(productId));
                if (!product) throw new Error('Product not found');
                const pData = getProductData(product);
                const totalCost = Number(pData.price) * quantity;
                
                db.ensureUser(interaction.user.id, interaction.user.tag);
                const txResult = db.purchaseTransaction(interaction.user.id, pData.name, quantity, totalCost);
                
                let details = '';
                if (product.is_local) {
                    try {
                        const items = db.retrieveLocalStock(productId, quantity);
                        details = items.join('\n');
                    } catch (localErr) {
                        db.refundUser(interaction.user.id, totalCost);
                        log.warn({ userId: interaction.user.id, product: pData.name, totalCost, error: localErr.message }, 'Local purchase failed, balance refunded');
                        throw new Error(`Purchase failed, your ${totalCost} NPR has been refunded. (${localErr.message})`);
                    }
                } else {
                    let buyData;
                    try {
                        const buyRes = await tunvnmmoAPI.post('/buy', { product_id: parseInt(productId), quantity, currency: 'usdt' });
                        buyData = buyRes.data;
                        if (buyData.success === false || buyData.error) throw new Error(buyData.message || 'API returned failure');
                    } catch (apiError) {
                        db.refundUser(interaction.user.id, totalCost);
                        log.warn({ userId: interaction.user.id, product: pData.name, totalCost, error: apiError.message }, 'Purchase API failed, balance refunded');
                        throw new Error(`Purchase failed, your ${totalCost} NPR has been refunded. (${apiError.message})`);
                    }
                    details = buyData.account_details || (buyData.items ? buyData.items.join('\n') : 'No details');
                }
                
                log.info({ userId: interaction.user.id, product: pData.name, quantity, totalCost, pointsEarned: txResult.pointsEarned }, 'Purchase completed successfully');
                const formattedDetails = `\`\`\`text\n${details}\n\`\`\``;
                
                const embed = new EmbedBuilder()
                    .setTitle('✅ Success!')
                    .setDescription(`Bought ${quantity}x **${pData.name}**\nCost: **${totalCost} NPR**\nRemaining Balance: **${txResult.balance_npr} NPR**\n**+${txResult.pointsEarned} Loyalty Points earned!**`)
                    .addFields({ name: '🔑 Delivery Details', value: formattedDetails })
                    .setColor(0x00FF00);
                    
                await sendStaffLog(
                    new EmbedBuilder()
                        .setTitle('🛒 Purchase Logged')
                        .addFields(
                            { name: 'Buyer', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Product', value: pData.name, inline: true },
                            { name: 'Quantity', value: String(quantity), inline: true },
                            { name: 'Total Cost', value: `${totalCost} NPR`, inline: true },
                            { name: 'New Balance', value: `${txResult.balance_npr} NPR`, inline: true }
                        )
                        .setColor(0x3498db)
                        .setTimestamp()
                );
                
                try { await interaction.user.send({ embeds: [embed] }); } catch(e) {
                    log.warn({ userId: interaction.user.id }, 'Could not send DM');
                }
                await interaction.editReply({ 
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🎉 Purchase Successful!')
                            .setDescription(`Bought ${quantity}x **${pData.name}**\nCheck your Direct Messages (DMs) for details!`)
                            .setColor(0x00FF00)
                    ], 
                    components: [getNavRow('categories')] 
                });
            } catch (error) {
                log.error({ userId: interaction.user.id, error: error.message }, 'Purchase error');
                await interaction.editReply({ 
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('❌ Transaction Failed')
                            .setDescription(error.message)
                            .setColor(0xFF0000)
                    ], 
                    components: [getNavRow('categories')] 
                });
            }
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('purchase_')) {
            const productId = interaction.customId.replace('purchase_', '');
            const quantity = parseInt(interaction.fields.getTextInputValue('qty'));
            if (isNaN(quantity) || quantity <= 0) return await interaction.reply({ content: '❌ Invalid quantity.', ...ephemeral });
            await interaction.deferReply({ ...ephemeral });
            try {
                const productsRes = await tunvnmmoAPI.get('/products');
                const product = extractArray(productsRes.data).find(p => String(p.id) === String(productId));
                if (!product) throw new Error('Product not found');
                const pData = getProductData(product);
                const totalCost = Number(pData.price) * quantity;
                
                db.ensureUser(interaction.user.id, interaction.user.tag);
                const user = db.getUser(interaction.user.id);
                if (user.balance_npr < totalCost) {
                    throw new Error(`Insufficient balance. You need **${totalCost} NPR** but only have **${user.balance_npr} NPR**.`);
                }
                
                const nextBalance = Number((user.balance_npr - totalCost).toFixed(2));
                
                const embed = new EmbedBuilder()
                    .setTitle('🛒 CONFIRM YOUR PURCHASE')
                    .setDescription(`Please verify your order details before completing the purchase.`)
                    .addFields(
                        { name: '📦 Product', value: pData.name, inline: false },
                        { name: '📊 Quantity', value: `\` ${quantity} \``, inline: true },
                        { name: '💵 Price per Unit', value: `\` ${pData.price} NPR \``, inline: true },
                        { name: '💰 Total Price', value: `\` ${totalCost} NPR \``, inline: false },
                        { name: '💳 Balance Before', value: `\` ${user.balance_npr} NPR \``, inline: true },
                        { name: '💳 Balance After', value: `**${nextBalance} NPR**`, inline: true }
                    )
                    .setColor(0xFFA500)
                    .setTimestamp();
                    
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`confirmbuy_${productId}_${quantity}`)
                        .setLabel('✅ Confirm & Buy')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId('nav_shop')
                        .setLabel('❌ Cancel')
                        .setStyle(ButtonStyle.Danger)
                );
                
                await interaction.editReply({ embeds: [embed], components: [row] });
            } catch (error) {
                await interaction.editReply({ content: `❌ ${error.message}`, components: [getNavRow('categories')] });
            }
        }

        if (interaction.isModalSubmit() && interaction.customId === 'redeem_modal') {
            const pointsToRedeem = parseInt(interaction.fields.getTextInputValue('points'));
            if (isNaN(pointsToRedeem) || pointsToRedeem <= 0) return await interaction.reply({ content: '❌ Invalid points amount.', ...ephemeral });
            try {
                const result = db.redeemPoints(interaction.user.id, pointsToRedeem);
                const embed = new EmbedBuilder()
                    .setTitle('🏆 Points Redeemed!')
                    .setDescription(`You exchanged **${pointsToRedeem} points** for **${result.nprEarned} NPR**! 💰`)
                    .setColor(0xFFD700)
                    .setFooter({ text: `Points left: ${result.loyalty_points} | Balance: ${result.balance_npr} NPR` });
                
                await sendStaffLog(
                    new EmbedBuilder()
                        .setTitle('🏆 Points Redeemed')
                        .addFields(
                            { name: 'User', value: `${interaction.user.tag} (\`${interaction.user.id}\`)`, inline: true },
                            { name: 'Points Exchanged', value: String(pointsToRedeem), inline: true },
                            { name: 'NPR Credited', value: `${result.nprEarned} NPR`, inline: true },
                            { name: 'New Balance', value: `${result.balance_npr} NPR`, inline: true }
                        )
                        .setColor(0xf1c40f)
                        .setTimestamp()
                );
                
                await interaction.reply({ embeds: [embed], ...ephemeral });
            } catch (error) {
                await interaction.reply({ content: `❌ ${error.message}`, ...ephemeral });
            }
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

    } catch (error) { log.error({ err: error.message }, 'Global interaction error'); }
});

client.login(process.env.DISCORD_TOKEN);