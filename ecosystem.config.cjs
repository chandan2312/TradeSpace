module.exports = {
  apps: [
    {
      name: "tradespace-web",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "650M",
      env: {
        NODE_ENV: "production",
      },
      node_args: "--max-old-space-size=768",
      error_file: "./logs/tradespace-error.log",
      out_file: "./logs/tradespace-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "mt5-bridge",
      script: "mt5_server.py",
      interpreter: "python",
      args: "--host 0.0.0.0 --port 8765",
      autorestart: true,
      watch: false,
      error_file: "./logs/mt5-error.log",
      out_file: "./logs/mt5-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
