require('dotenv').config();
const { REST, Routes } = require('discord.js');

const commands = [
    {
        name: 'pin',
        description: 'Post a permanent Start button (Admin only)'
    }
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('Started refreshing application (/) commands.');
        
        // ⚠️ Replace with your actual Client ID
        await rest.put(
            Routes.applicationCommands('1530647216417538149'), 
            { body: commands }
        );

        console.log('✅ Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
})();