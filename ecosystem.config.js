module.exports = {
  apps: [
    {
      name: 'discord-shop-bot',
      script: 'index.js',
      watch: true,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.json',
        '*.json.bak',
        'sessions.json',
        'users.json',
        'config.json',
        'admin_logs.json'
      ],
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'discord-shop-admin',
      script: 'admin.js',
      watch: true,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.json',
        '*.json.bak',
        'sessions.json',
        'users.json',
        'config.json',
        'admin_logs.json'
      ],
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'discord-shop-webhook',
      script: 'webhook.js',
      watch: true,
      ignore_watch: [
        'node_modules',
        'logs',
        '*.json',
        '*.json.bak',
        'sessions.json',
        'users.json',
        'config.json',
        'admin_logs.json'
      ],
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
