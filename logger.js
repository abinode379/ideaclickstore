const pino = require('pino');
const path = require('path');
const fs = require('fs');

const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const streams = [
    { stream: process.stdout },
    { stream: fs.createWriteStream(path.join(logsDir, 'app.log'), { flags: 'a' }) }
];

const logger = pino(
    { level: 'info', timestamp: pino.stdTimeFunctions.isoTime },
    pino.multistream(streams)
);

module.exports = logger;
