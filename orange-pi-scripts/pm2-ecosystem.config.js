module.exports = {
  apps: [
    {
      name: 'ezvendo_app',
      cwd: '/home/sonny/opt/ezvendo',
      script: 'npm',
      args: 'start',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: '/home/sonny/.pm2/logs/ezvendo-app-error.log',
      out_file: '/home/sonny/.pm2/logs/ezvendo-app-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true
    }
  ]
};

