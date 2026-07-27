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