module.exports = {
  apps: [
    {
      name: "tradespace",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1800M",
      env: {
        NODE_ENV: "production",
      },
      node_args: "--max-old-space-size=2048",
      error_file: "./logs/pm2-error.log",
      out_file: "./logs/pm2-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
