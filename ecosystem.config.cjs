module.exports = {
  apps: [
    {
      name: 'enigme-bot',
      script: 'dist/src/index.js',
      node_args: '--enable-source-maps',
      // Verrou global en mémoire : une seule instance obligatoire
      instances: 1,
      exec_mode: 'fork',
      // Horodatage automatique des logs au format standard (YYYY-MM-DD HH:mm:ss)
      time: true,
      // Redémarrage automatique en cas de crash ou process.exit(1) (Auto-Healing)
      autorestart: true,
      // Temporisation progressive pour éviter le redémarrage en boucle rapide
      exp_backoff_restart_delay: 100,
      // Limite mémoire adaptée aux surfaces natives Cairo/Canvas
      max_memory_restart: '512M',
      // Délai pour laisser le temps au bot de drainer le verrou et fermer SQLite (SIGINT)
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
