module.exports = {
  apps: [
    {
      name: "tradespace-web",
      script: "server.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1200M",
      env: {
        NODE_ENV: "production",
      },
      node_args: "--expose-gc --max-old-space-size=1024 --optimize_for_size",
      error_file: "./logs/tradespace-error.log",
      out_file: "./logs/tradespace-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "mt5-bridge",
      script: "./run_mt5_wine.sh",
      interpreter: "bash",
      autorestart: true,
      watch: false,
      max_memory_restart: "1500M",
      error_file: "./logs/mt5-error.log",
      out_file: "./logs/mt5-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
