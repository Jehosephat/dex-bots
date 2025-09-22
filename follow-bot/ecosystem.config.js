module.exports = {
  apps: [
    {
      name: 'follow-bot',
      script: 'dist/index.js',
      cwd: './follow-bot',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      env_development: {
        NODE_ENV: 'development',
        LOG_LEVEL: 'debug'
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'info'
      },
      log_file: './logs/follow-bot.log',
      out_file: './logs/follow-bot-out.log',
      error_file: './logs/follow-bot-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      time: true,
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      listen_timeout: 3000,
      reload_delay: 0,
      wait_ready: true,
      ready_timeout: 10000,
      shutdown_with_message: true,
      kill_retry_time: 100,
      autorestart: true,
      cron_restart: '0 2 * * *', // Restart daily at 2 AM
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        'dist',
        '.git'
      ],
      watch_options: {
        followSymlinks: false
      }
    }
  ]
};
