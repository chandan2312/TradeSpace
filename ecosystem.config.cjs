module.exports = {
  apps: [
    {
      name: "tradespace-web",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "250M",
      env: {
        NODE_ENV: "production",
      },
      node_args: "--expose-gc --max-old-space-size=256 --optimize_for_size",
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
      max_memory_restart: "120M",
      error_file: "./logs/mt5-error.log",
      out_file: "./logs/mt5-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
