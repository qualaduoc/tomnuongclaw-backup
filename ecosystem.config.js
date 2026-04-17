module.exports = {
  apps: [
    {
      name: "tom-bot",
      script: "./bot.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "2G",
      env: {NODE_ENV: "production"}
    },
    {
      name: "tom-api",
      script: "./api_gateway.js",
      exec_mode: "cluster",
      instances: 4, // 4 clone cùng hút traffic
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {NODE_ENV: "production"}
    },
    {
      name: "tom-tunnel",
      script: "cloudflared",
      args: "tunnel --url http://127.0.0.1:3000",
      autorestart: true,
      watch: false
    }
  ]
};
