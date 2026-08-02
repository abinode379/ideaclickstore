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
const activeShopSessions = new Map();

const SHOP_PAGE_SIZE = 6;
const HISTORY_PAGE_SIZE = 5;

async function sendStaffLog(embed) {
    try {
        const channelId = db.getConfig('staff_log_channel_id') || process.env.STAFF_LOG_CHANNEL_ID;
        if (!channelId) return;
        const channel = await client.channels.fetch(channelId).catch(() => null);
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
        const channel = await client.channels.fetch(channelId).catch(() => null);
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
    const autoSortByStock = db.getConfig('auto_sort_by_stock') === true;
    const productOrder = db.getConfig('product_order') || [];
    
    products.sort((a, b) => {
        if (autoSortByStock) {
            const hasStockA = a.infinite_stock || Number(a.stock) > 0;
            const hasStockB = b.infinite_stock || Number(b.stock) > 0;
            
            if (hasStockA && !hasStockB) return -1;
            if (!hasStockA && hasStockB) return 1;
        }
        
        const idxA = productOrder.indexOf(String(a.id));
        const idxB = productOrder.indexOf(String(b.id));
        if (idxA === -1 && idxB === -1) return 0;
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
    
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
            stock: p.infinite_stock ? 9999 : (p.stock ? p.stock.length : 0),
            infinite_stock: !!p.infinite_stock,
            hidden: !!p.hidden,
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
                stock: p.infinite_stock ? 9999 : (p.stock ? p.stock.length : 0),
                infinite_stock: !!p.infinite_stock,
                hidden: !!p.hidden,
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
    else if (lower.includes('canva')) emojiName = 'Canva';
    else if (lower.includes('netflix')) emojiName = 'Netflix';
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
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel) return;

        const allProducts = await getMergedProducts();
        const hiddenProducts = db.getConfig('hidden_products') || [];
        
        let products = allProducts.filter(p => !p.hidden && !hiddenProducts.includes(String(p.id)));
        products = sortProducts(products);

        let descriptionText = `🇳🇵 **IdeaClick Live Product Catalog**\n\n`;
        if (products.length === 0) {
            descriptionText += `📭 *No products currently available.*`;
        } else {
            products.forEach(product => {
                const pData = getProductData(product);
                const bar = getProgressBar(product.stock ?? 0, product.infinite_stock);
                const emoji = getProductEmoji(pData.name);
                descriptionText += `${emoji} **${pData.name}**\n${bar}\n\n`;
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🏪 Live Product Catalog')
            .setDescription(descriptionText)
            .setColor(0x8b5cf6)
            .setTimestamp();

        let botMessage = null;
        try {
            const messages = await channel.messages.fetch({ limit: 50 });
            botMessage = messages.find(m => m.author.id === client.user.id);
        } catch (fetchErr) {
            log.warn({ err: fetchErr.message }, 'Failed to fetch messages in live catalog channel (Read Message History permission may be missing).');
        }

        try {
            if (botMessage) {
                await botMessage.edit({ embeds: [embed], components: [] }).catch(async (editErr) => {
                    log.warn({ err: editErr.message }, 'Failed to edit bot message in live catalog channel, attempting to send a new one.');
                    await channel.send({ embeds: [embed] });
                });
            } else {
                await channel.send({ embeds: [embed] });
            }
            log.info('Live catalog channel updated successfully.');
        } catch (sendErr) {
            log.error({ err: sendErr.message }, 'Failed to send or edit message in live catalog channel. Please ensure the bot has Send Messages and View Channel permissions.');
        }
    } catch (e) {
        log.error({ err: e.message }, 'Global catalog update error');
    }
}

async function trackStockChanges() {
    try {
        const allProducts = await getMergedProducts();
        const hiddenProducts = db.getConfig('hidden_products') || [];
        const products = allProducts.filter(p => !p.hidden && !hiddenProducts.includes(String(p.id)));

        const channelId = db.getConfig('notification_channel_id');
        if (!channelId) return;
        const channel = await client.channels.fetch(channelId).catch(() => null);
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
                    mention = '@everyone ';
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
                        const liveSalesChannel = await client.channels.fetch(liveSalesChannelId).catch(() => null);
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
    
    // Watch config.json for settings/hidden changes to live update Discord channel
    const fs = require('fs');
    const path = require('path');
    const configFilePath = path.join(__dirname, 'config.json');
    let watchTimeout = null;
    fs.watch(configFilePath, (eventType) => {
        if (eventType === 'change') {
            if (watchTimeout) clearTimeout(watchTimeout);
            watchTimeout = setTimeout(async () => {
                log.info('Detected configuration change on disk, syncing live catalog channel...');
                await updateAvailableProductsChannel().catch(() => null);
            }, 1500);
        }
    });

    // Daily database backup
    await runDailyBackup();
    setInterval(runDailyBackup, 24 * 60 * 60 * 1000);
});

function getShopMainMenuEmbed(interaction) {
    db.ensureUser(interaction.user.id, interaction.user.tag);
    const user = db.getUser(interaction.user.id);
    
    return new EmbedBuilder()
        .setTitle('🏪 IdeaClick Store Menu')
        .setDescription(`━━━━━━━━━━━━━━━━━━━━━
✨ **Nepal's #1 Automated Digital Shop**

👤 **Account Summary:**
• Discord: <@${interaction.user.id}>
• 💰 Balance: **${user.balance_npr} NPR**
• 🏆 Loyalty Points: **${user.loyalty_points || 0} pts**

⚡ **Instant Delivery 24/7** — Digital products are sent directly to your DMs immediately after purchase!
━━━━━━━━━━━━━━━━━━━━━`)
        .setColor(0x8b5cf6)
        .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();
}

function getNavRow(excludeButton) {
    const row = new ActionRowBuilder();
    const buttons = [
        { id: 'nav_shop', label: '🛒 Shop', style: ButtonStyle.Primary },
        { id: 'nav_balance', label: '💰 Balance', style: ButtonStyle.Success },
        { id: 'nav_deposit', label: '📥 Deposit', style: ButtonStyle.Secondary },
        { id: 'nav_history', label: '📜 History', style: ButtonStyle.Secondary },
        { id: 'redeem', label: '🏆 Redeem', style: ButtonStyle.Secondary },
        { id: 'nav_back', label: '🔙 Back', style: ButtonStyle.Danger }
    ];
    let count = 0;
    buttons.forEach(btn => {
        if (btn.id !== `nav_${excludeButton}` && btn.id !== excludeButton) {
            if (count < 5) {
                row.addComponents(new ButtonBuilder().setCustomId(btn.id).setLabel(btn.label).setStyle(btn.style));
                count++;
            }
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
        const hasStock1 = (p1.stock ?? 0) > 0 || p1.infinite_stock;
        const stockEmoji1 = hasStock1 ? '🟢' : '🔴';
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`view_${p1.id}`)
                .setLabel(`${pData1.name.substring(0, 28)} ${stockEmoji1}`)
                .setStyle(!hasStock1 ? ButtonStyle.Secondary : ButtonStyle.Primary)
                .setDisabled(!hasStock1)
        );
        
        if (i + 1 < productsToShow.length) {
            const p2 = productsToShow[i + 1];
            const pData2 = getProductData(p2);
            const hasStock2 = (p2.stock ?? 0) > 0 || p2.infinite_stock;
            const stockEmoji2 = hasStock2 ? '🟢' : '🔴';
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`view_${p2.id}`)
                    .setLabel(`${pData2.name.substring(0, 28)} ${stockEmoji2}`)
                    .setStyle(!hasStock2 ? ButtonStyle.Secondary : ButtonStyle.Primary)
                    .setDisabled(!hasStock2)
            );
        }
        rows.push(row);
    }
    return rows;
}

function getProgressBar(stock, isInfinite = false) {
    if (isInfinite) {
        return `\`[██████████]\` **Infinite Stock**`;
    }
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

    // Ephemeral shop menu session cleaner
    const isShopInteraction = (interaction.isButton() && (
        ['start', 'shop', 'balance', 'deposit', 'daily', 'history', 'redeem', 'nav_shop', 'nav_balance', 'nav_history', 'nav_deposit', 'nav_back'].includes(interaction.customId) ||
        interaction.customId.startsWith('shop_page_') ||
        interaction.customId.startsWith('history_page_') ||
        interaction.customId.startsWith('view_') ||
        interaction.customId.startsWith('buy1_') ||
        interaction.customId.startsWith('buy_') ||
        interaction.customId.startsWith('confirmbuy_') ||
        interaction.customId.startsWith('check_dep_') ||
        interaction.customId.startsWith('check_buy_')
    )) || (interaction.isModalSubmit() && (
        interaction.customId === 'redeem_modal' ||
        interaction.customId.startsWith('purchase_')
    )) || (interaction.isChatInputCommand() && (
        ['shop', 'balance', 'deposit', 'history', 'daily'].includes(interaction.commandName)
    ));

    if (isShopInteraction) {
        const isEntryPoint = (interaction.isChatInputCommand() && ['shop', 'balance', 'deposit', 'history', 'daily'].includes(interaction.commandName)) ||
                             (interaction.isButton() && interaction.customId === 'start');

        if (isEntryPoint) {
            const oldInteraction = activeShopSessions.get(interaction.user.id);
            if (oldInteraction) {
                try {
                    await oldInteraction.deleteReply().catch(() => {});
                } catch (err) {}
            }
        }
        activeShopSessions.set(interaction.user.id, interaction);
    }

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
            const channel = await client.channels.fetch(channelId).catch(() => null);
            const title = interaction.fields.getTextInputValue('ann_title');
            const desc = interaction.fields.getTextInputValue('ann_desc');
            const embed = new EmbedBuilder().setTitle(`📢 ${title}`).setDescription(desc).setColor(0x0099FF).setFooter({ text: `Announcement by ${interaction.user.tag}` }).setTimestamp();
            if (channel) {
                try {
                    await channel.send({ embeds: [embed] });
                    await interaction.reply({ content: `✅ Announcement successfully sent to ${channel}!`, ...ephemeral });
                } catch (sendErr) {
                    log.error({ err: sendErr.message }, 'Failed to send announcement');
                    await interaction.reply({ content: `❌ Failed to send announcement: ${sendErr.message}. Please ensure the bot has permission to View Channel, Send Messages, and Embed Links in ${channel}.`, ...ephemeral });
                }
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
            const embed = getShopMainMenuEmbed(interaction);
            await interaction.reply({ embeds: [embed], components: getMainMenuRows(), ...ephemeral });
        }

        if (interaction.isButton() && interaction.customId === 'shop') {
            const allProducts = await getMergedProducts();
            const hiddenProducts = db.getConfig('hidden_products') || [];
            const products = sortProducts(allProducts.filter(p => !p.hidden && !hiddenProducts.includes(String(p.id))));
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
                
                await interaction.update({ embeds: [embed], components: [getNavRow('back')] });
            } catch (error) {
                let msg = error.message;
                if (msg.startsWith('Next claim time: ')) {
                    const timeMs = Number(msg.replace('Next claim time: ', ''));
                    if (!isNaN(timeMs)) {
                        const timeSecs = Math.floor(timeMs / 1000);
                        msg = `Next claim time: <t:${timeSecs}:F> (<t:${timeSecs}:R>)`;
                    }
                }
                const errEmbed = new EmbedBuilder()
                    .setTitle('⏰ Daily Reward')
                    .setDescription(`❌ ${msg}`)
                    .setColor(0xe74c3c);
                await interaction.update({ embeds: [errEmbed], components: [getNavRow('back')] });
            }
        }

        if (interaction.isButton() && interaction.customId === 'redeem') {
            const configVal = db.getConfig('loyalty_redeem_rate');
            const redeemRate = (configVal !== null && configVal !== undefined) ? Number(configVal) : 10;
            const modal = new ModalBuilder().setCustomId('redeem_modal').setTitle('🏆 Redeem Loyalty Points').addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('points').setLabel(`Points to Redeem (${redeemRate} pts = 1 NPR)`).setStyle(TextInputStyle.Short).setPlaceholder(`e.g., ${redeemRate * 10}`).setRequired(true)));
            await interaction.showModal(modal);
        }

        if (interaction.isButton() && interaction.customId === 'nav_shop') {
            const allProducts = await getMergedProducts();
            const hiddenProducts = db.getConfig('hidden_products') || [];
            const products = sortProducts(allProducts.filter(p => !p.hidden && !hiddenProducts.includes(String(p.id))));
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
            const embed = getShopMainMenuEmbed(interaction);
            await interaction.update({ embeds: [embed], components: getMainMenuRows() });
        }

        if (interaction.isButton() && interaction.customId.startsWith('shop_page_')) {
            const page = parseInt(interaction.customId.replace('shop_page_', ''));
            if (isNaN(page)) return;
            const allProducts = await getMergedProducts();
            const hiddenProducts = db.getConfig('hidden_products') || [];
            const products = sortProducts(allProducts.filter(p => !p.hidden && !hiddenProducts.includes(String(p.id))));
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
            const stockText = product.infinite_stock ? 'Infinite' : String(product.stock ?? 0);
            const embed = new EmbedBuilder().setTitle(`📦 ${pData.name}`).setDescription(pData.description).addFields({ name: ' Price', value: `${pData.price} NPR`, inline: true }, { name: '📦 Stock', value: stockText, inline: true }).setColor((product.stock ?? 0) > 0 || product.infinite_stock ? 0x8b5cf6 : 0xe74c3c);
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`buy1_${product.id}`).setLabel('🛒 Buy 1 Unit').setStyle(ButtonStyle.Success).setDisabled((product.stock ?? 0) === 0 && !product.infinite_stock),
                new ButtonBuilder().setCustomId(`buy_${product.id}`).setLabel('🛍️ Buy Multiple').setStyle(ButtonStyle.Primary).setDisabled((product.stock ?? 0) === 0 && !product.infinite_stock),
                new ButtonBuilder().setCustomId('nav_shop').setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
            );
            await interaction.update({ embeds: [embed], components: [row] });
        }

        if (interaction.isButton() && interaction.customId.startsWith('buy1_')) {
            const productId = interaction.customId.replace('buy1_', '');
            await interaction.deferUpdate();
            try {
                const allProducts = await getMergedProducts();
                const product = allProducts.find(p => String(p.id) === String(productId));
                if (!product) throw new Error('Product not found');
                const pData = getProductData(product);
                const totalCost = Number(pData.price) * 1;
                
                db.ensureUser(interaction.user.id, interaction.user.tag);
                const user = db.getUser(interaction.user.id);
                if (user.balance_npr < totalCost) {
                    const missingAmount = Math.ceil(totalCost - user.balance_npr);
                    const tunnelUrl = process.env.TUNNEL_URL || 'http://localhost:3000';
                    const session = await paybridgeAPI.post('/checkout', { 
                        amount: missingAmount * 100, 
                        returnUrl: `${tunnelUrl}/success`, 
                        cancelUrl: `${tunnelUrl}/cancel`, 
                        metadata: { 
                            discordUserId: interaction.user.id, 
                            discordUsername: interaction.user.tag, 
                            amount: missingAmount,
                            autoBuyProductId: product.id,
                            autoBuyQuantity: 1
                        } 
                    });

                    const embed = new EmbedBuilder()
                        .setTitle('💳 INSUFFICIENT BALANCE')
                        .setDescription(`You need **${totalCost} NPR** but only have **${user.balance_npr} NPR**.\n\nYou are missing **${missingAmount} NPR** for this purchase.\n\nClick the payment button below to deposit the remaining amount and complete your order instantly!`)
                        .setColor(0xe74c3c);
                        
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setLabel(`Pay ${missingAmount} NPR`).setURL(session.data.checkout_url).setStyle(ButtonStyle.Link),
                        new ButtonBuilder().setCustomId(`check_buy_${product.id}_1_${user.balance_npr}`).setLabel('🔄 Check Status').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('nav_shop').setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
                    );
                    
                    return await interaction.editReply({ embeds: [embed], components: [row] });
                }
                
                const nextBalance = Number((user.balance_npr - totalCost).toFixed(2));
                
                const embed = new EmbedBuilder()
                    .setTitle('🛒 CONFIRM YOUR PURCHASE')
                    .setDescription(`Please verify your order details before completing the purchase.\n\n⚠️ **IMPORTANT**: Please ensure your Discord DMs are enabled for this server so the bot can instantly deliver your codes!`)
                    .addFields(
                        { name: '📦 Product', value: pData.name, inline: false },
                        { name: '📊 Quantity', value: `\` 1 \``, inline: true },
                        { name: '💵 Price per Unit', value: `\` ${pData.price} NPR \``, inline: true },
                        { name: '💰 Total Price', value: `\` ${totalCost} NPR \``, inline: false },
                        { name: '💳 Balance Before', value: `\` ${user.balance_npr} NPR \``, inline: true },
                        { name: '💳 Balance After', value: `**${nextBalance} NPR**`, inline: true }
                    )
                    .setColor(0x8b5cf6)
                    .setTimestamp();
                    
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`confirmbuy_${productId}_1`).setLabel('✅ Confirm Order').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('nav_shop').setLabel('❌ Cancel').setStyle(ButtonStyle.Danger)
                );
                
                await interaction.editReply({ embeds: [embed], components: [row] });
            } catch (err) {
                await interaction.editReply({ content: `❌ ${err.message}` });
            }
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('check_dep_')) {
            const parts = interaction.customId.split('_');
            const initialBalance = parseFloat(parts[parts.length - 1]);
            const amount = parseFloat(parts[parts.length - 2]);
            
            await interaction.deferUpdate();
            
            db.ensureUser(interaction.user.id, interaction.user.tag);
            const user = db.getUser(interaction.user.id);
            
            if (user.balance_npr > initialBalance) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ PAYMENT COMPLETED')
                    .setDescription(`Your deposit of **${amount} NPR** has been successfully verified!\n\n💰 New Balance: **${user.balance_npr} NPR**`)
                    .setColor(0x2ecc71)
                    .setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('nav_back').setLabel('🔙 Back to Main Menu').setStyle(ButtonStyle.Success)
                );
                await interaction.editReply({ embeds: [embed], components: [row] });
            } else {
                await interaction.followUp({ content: '⏳ Payment not detected yet. Please complete the payment or wait a few seconds and try again.', flags: [MessageFlags.Ephemeral] });
            }
            return;
        }

        if (interaction.isButton() && interaction.customId.startsWith('check_buy_')) {
            const parts = interaction.customId.split('_');
            const initialBalance = parseFloat(parts[parts.length - 1]);
            const quantity = parseInt(parts[parts.length - 2]);
            const productId = parts.slice(2, parts.length - 2).join('_');
            
            await interaction.deferUpdate();
            
            db.ensureUser(interaction.user.id, interaction.user.tag);
            const user = db.getUser(interaction.user.id);
            
            const allProducts = await getMergedProducts();
            const product = allProducts.find(p => String(p.id) === String(productId));
            const pData = product ? getProductData(product) : null;
            
            const history = user.purchase_history || [];
            const lastPurchase = history[history.length - 1];
            
            const hasPurchased = lastPurchase && pData && lastPurchase.product === pData.name;
            
            if (hasPurchased) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ ORDER COMPLETED')
                    .setDescription(`Your purchase was successfully processed!\n\n🔑 The account credentials / links have been delivered to your **Direct Messages (DMs)**.\n\n💰 Current Balance: **${user.balance_npr} NPR**`)
                    .setColor(0x2ecc71)
                    .setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('nav_shop').setLabel('🔙 Back to Shop').setStyle(ButtonStyle.Success)
                );
                await interaction.editReply({ embeds: [embed], components: [row] });
            } else if (user.balance_npr !== initialBalance) {
                const embed = new EmbedBuilder()
                    .setTitle('✅ PAYMENT COMPLETED')
                    .setDescription(`Your deposit was successfully verified!\n\n💰 Current Balance: **${user.balance_npr} NPR**\n\n*(If your order didn't auto-deliver, you can purchase it manually from the shop using your balance)*`)
                    .setColor(0x2ecc71)
                    .setTimestamp();
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('nav_shop').setLabel('🔙 Go to Shop').setStyle(ButtonStyle.Success)
                );
                await interaction.editReply({ embeds: [embed], components: [row] });
            } else {
                await interaction.followUp({ content: '⏳ Payment / Order completion not detected yet. Please complete the payment or wait a few seconds and try again.', flags: [MessageFlags.Ephemeral] });
            }
            return;
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
            const quantity = parseInt(parts[parts.length - 1]);
            const productId = parts.slice(1, parts.length - 1).join('_');
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
                               const safeDetails = details.length > 1000 ? (details.substring(0, 1000) + '\n... (truncated, see full message below)') : details;
                const formattedDetails = `\`\`\`text\n${safeDetails}\n\`\`\``;
                
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
                
                try { 
                    await interaction.user.send({ embeds: [embed] }); 
                    const limit = 1900;
                    if (details.length <= limit) {
                        await interaction.user.send({ content: `📋 **Copy Code / Account Details below:**\n\`\`\`text\n${details}\n\`\`\`` });
                    } else {
                        await interaction.user.send({ content: `📋 **Copy Code / Account Details:**` });
                        for (let i = 0; i < details.length; i += limit) {
                            const chunk = details.substring(i, i + limit);
                            await interaction.user.send({ content: `\`\`\`text\n${chunk}\n\`\`\`` });
                        }
                    }
                } catch(e) {
                    log.warn({ userId: interaction.user.id, error: e.message }, 'Could not send DM');
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
            await interaction.deferUpdate();
            try {
                const allProducts = await getMergedProducts();
                const product = allProducts.find(p => String(p.id) === String(productId));
                if (!product) throw new Error('Product not found');
                const pData = getProductData(product);
                const totalCost = Number(pData.price) * quantity;
                
                db.ensureUser(interaction.user.id, interaction.user.tag);
                const user = db.getUser(interaction.user.id);
                if (user.balance_npr < totalCost) {
                    const missingAmount = Math.ceil(totalCost - user.balance_npr);
                    const tunnelUrl = process.env.TUNNEL_URL || 'http://localhost:3000';
                    const session = await paybridgeAPI.post('/checkout', { 
                        amount: missingAmount * 100, 
                        returnUrl: `${tunnelUrl}/success`, 
                        cancelUrl: `${tunnelUrl}/cancel`, 
                        metadata: { 
                            discordUserId: interaction.user.id, 
                            discordUsername: interaction.user.tag, 
                            amount: missingAmount,
                            autoBuyProductId: product.id,
                            autoBuyQuantity: quantity
                        } 
                    });

                    const embed = new EmbedBuilder()
                        .setTitle('💳 INSUFFICIENT BALANCE')
                        .setDescription(`You need **${totalCost} NPR** but only have **${user.balance_npr} NPR**.\n\nYou are missing **${missingAmount} NPR** for this purchase.\n\nClick the payment button below to deposit the remaining amount and complete your order instantly!`)
                        .setColor(0xe74c3c);
                        
                    const row = new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setLabel(`Pay ${missingAmount} NPR`).setURL(session.data.checkout_url).setStyle(ButtonStyle.Link),
                        new ButtonBuilder().setCustomId(`check_buy_${product.id}_${quantity}_${user.balance_npr}`).setLabel('🔄 Check Status').setStyle(ButtonStyle.Primary),
                        new ButtonBuilder().setCustomId('nav_shop').setLabel('🔙 Back').setStyle(ButtonStyle.Secondary)
                    );
                    
                    return await interaction.editReply({ embeds: [embed], components: [row] });
                }
                
                const nextBalance = Number((user.balance_npr - totalCost).toFixed(2));
                
                const embed = new EmbedBuilder()
                    .setTitle('🛒 CONFIRM YOUR PURCHASE')
                    .setDescription(`Please verify your order details before completing the purchase.\n\n⚠️ **IMPORTANT**: Please ensure your Discord DMs are enabled for this server so the bot can instantly deliver your codes!`)
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
            await interaction.deferUpdate();
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
                
                await interaction.editReply({ embeds: [embed], components: [getNavRow('back')] });
            } catch (error) {
                const errEmbed = new EmbedBuilder()
                    .setTitle('🏆 Loyalty Points')
                    .setDescription(`❌ ${error.message}`)
                    .setColor(0xe74c3c);
                await interaction.editReply({ embeds: [errEmbed], components: [getNavRow('back')] });
            }
        }

        if (interaction.isModalSubmit() && (interaction.customId === 'deposit_modal' || interaction.customId === 'deposit_modal_nav')) {
            const amount = parseInt(interaction.fields.getTextInputValue('amount'));
            if (amount < 100) return await interaction.reply({ content: '❌ Min 100 NPR', ...ephemeral });
            await interaction.deferUpdate();
            const tunnelUrl = process.env.TUNNEL_URL || 'http://localhost:3000';
            try {
                const session = await paybridgeAPI.post('/checkout', { amount: amount * 100, returnUrl: `${tunnelUrl}/success`, cancelUrl: `${tunnelUrl}/cancel`, metadata: { discordUserId: interaction.user.id, discordUsername: interaction.user.tag, amount } });
                const embed = new EmbedBuilder().setTitle('📥 Deposit').setDescription(`${amount} NPR\nClick to pay:`).setColor(0x0099FF);
                db.ensureUser(interaction.user.id, interaction.user.tag);
                const user = db.getUser(interaction.user.id);
                const payRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setLabel('💳 Pay').setURL(session.data.checkout_url).setStyle(ButtonStyle.Link),
                    new ButtonBuilder().setCustomId(`check_dep_${amount}_${user.balance_npr}`).setLabel('🔄 Check Status').setStyle(ButtonStyle.Primary)
                );
                const backRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('nav_back').setLabel('🔙 Back to Main Menu').setStyle(ButtonStyle.Danger));
                await interaction.editReply({ embeds: [embed], components: [payRow, backRow] });
            } catch (error) { await interaction.editReply({ content: '❌ Deposit failed' }); }
        }

    } catch (error) { log.error({ err: error.message }, 'Global interaction error'); }
});

client.login(process.env.DISCORD_TOKEN);