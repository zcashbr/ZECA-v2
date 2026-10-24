// ecosystem.config.js — PM2
// Uso na VPS (como usuário comum, não root):
//   pm2 start ecosystem.config.js
//   pm2 save && pm2 startup     # volta sozinho após reboot
//   pm2 install pm2-logrotate   # limita os logs do PM2
//
// Segredos ficam no .env (lido pelo dotenv). Não coloque tokens nem a UFVK aqui.

module.exports = {
  apps: [
    {
      name: 'zeca',
      script: 'index.js',
      cwd: __dirname, // .env, database.sqlite e bot.log são relativos a esta pasta

      // UMA instância, modo fork. Cluster ou instances > 1 rodariam dois bots:
      // memos publicados em dobro e escrita concorrente no SQLite.
      exec_mode: 'fork',
      instances: 1,

      // Reinício: espera crescente (100 ms → até 15 s) para não martelar
      // o zkool e o login do Discord quando algo está fora do ar.
      autorestart: true,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '300M',

      // O bot trata SIGINT: fecha o Discord e o banco. Dá tempo para isso.
      kill_timeout: 8000,

      // O bot já grava bot.log com rotação própria. Os logs do PM2 recebem
      // a mesma saída (também com segredos mascarados).
      merge_logs: true,
      time: true,

      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};