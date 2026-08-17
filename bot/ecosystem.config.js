module.exports = {
  apps: [
    {
      name: 'battlequizz-bot',
      script: 'index.js',
      cwd: __dirname,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '15s',
      restart_delay: 3000,
      max_memory_restart: '300M',
      out_file: './logs/out.log',
      error_file: './logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      env: { NODE_ENV: 'production' },
    },
  ],
};
