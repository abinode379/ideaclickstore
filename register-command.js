require('dotenv').config();
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');

const commands = [
    {
        name: 'pin',
        description: 'Pin the shop menu to a channel (Admins only)',
    },
    {
        name: 'announce',
        description: 'Send an announcement embed to a channel (Admins only)',
        options: [
            {
                name: 'channel',
                description: 'The channel to send the announcement to',
                type: ApplicationCommandOptionType.Channel,
                required: true,
            },
        ],
    },
    {
        name: 'manage-balance',
        description: 'Manage user balance (Admins only)',
        options: [
            {
                name: 'user',
                description: 'Target Discord user',
                type: ApplicationCommandOptionType.User,
                required: true,
            },
            {
                name: 'action',
                description: 'Action to perform',
                type: ApplicationCommandOptionType.String,
                required: true,
                choices: [
                    { name: '➕ Add', value: 'add' },
                    { name: '➖ Subtract', value: 'subtract' },
                    { name: '⚙️ Set Exact', value: 'set' },
                ],
            },
            {
                name: 'amount',
                description: 'Amount in NPR',
                type: ApplicationCommandOptionType.Number,
                required: true,
            },
            {
                name: 'reason',
                description: 'Reason for balance adjustment',
                type: ApplicationCommandOptionType.String,
                required: false,
            },
        ],
    },
    {
        name: 'user-info',
        description: 'Check a user balance and loyalty points (Admins & Staff)',
        options: [
            {
                name: 'user',
                description: 'Target Discord user',
                type: ApplicationCommandOptionType.User,
                required: true,
            },
        ],
    },
    {
        name: 'pin-balance-panel',
        description: 'Pin the Admin Balance Management panel to current channel (Admins only)',
    },
    {
        name: 'pin-leaderboard',
        description: 'Pin the live User Balance & Loyalty Points Leaderboard to current channel (Admins only)',
    },
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('🔄 Started refreshing application (/) commands.');

        const clientId = process.env.CLIENT_ID;
        const guildId = process.env.GUILD_ID;

        await rest.put(
            Routes.applicationGuildCommands(clientId, guildId),
            { body: commands }
        );

        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
})();