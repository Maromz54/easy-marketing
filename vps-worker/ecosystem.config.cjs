module.exports = {
  apps: [{
    name: 'fb-group-publisher',
    script: './src/index.js',
    instances: 1,            // MUST stay 1 — single persistent browser session
    autorestart: true,
    watch: false,
    max_memory_restart: '512M',
    env: {
      NODE_ENV: 'production',
    },
  }],
};
