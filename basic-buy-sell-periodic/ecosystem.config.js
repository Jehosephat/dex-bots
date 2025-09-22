module.exports = {
  apps: [
    {
      name: 'buy-sell-periodic-bot',
      script: 'buy-sell-periodic.mjs',
      cwd: './basic-buy-sell-periodic',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production'
      },
      env_development: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      log_file: './logs/buy-sell-periodic.log',
      out_file: './logs/buy-sell-periodic-out.log',
      error_file: './logs/buy-sell-periodic-error.log',
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
      kill_retry: 100,
      autorestart: true,
      cron_restart: '0 2 * * *', // Restart daily at 2 AM
      ignore_watch: [
        'node_modules',
        'logs',
        '*.log',
        '.git'
      ],
      watch_options: {
        followSymlinks: false
      }
    }
  ]
};
