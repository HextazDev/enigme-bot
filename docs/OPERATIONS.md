# Exploitation, sauvegarde et restauration

## Préparer une livraison

La refonte nécessite une compilation avant le redémarrage. Adapter le récepteur de déploiement de votre instance avant de fusionner : un simple `npm install` suivi d’un redémarrage ne garantit pas que `dist/` est à jour.

```bash
npm ci --include=dev
npm run check
npm run build
pm2 startOrReload ecosystem.config.cjs --update-env
```

PM2 doit exécuter `dist/src/index.js` et une seule instance. Le déploiement automatisé doit donc lancer `npm ci --include=dev && npm run build` avant `pm2 reload` : sans compilation, le bot démarre l'ancien `dist/` ou ne démarre pas. Utiliser Node 24 (image Docker et CI) ; les outils exigent au minimum Node 22.13. Le chargement des commandes slash ne change que lors d’une modification de leurs définitions : `npm run deploy` (nécessaire après la refonte TypeScript : options de `/admin set_position` et `/admin tour`, description de `/plateau`). Cette commande contacte réellement Discord ; elle ne fait pas partie des tests.

**`DEV_MODE` ne doit jamais être défini en production.** Sans lui, `npm run deploy` n'enregistre pas `/dev` et le bot ne la charge pas. Si `/dev` apparaît sur le serveur de production (déploiement fait par erreur avec `DEV_MODE=1`), retirer la variable puis relancer `npm run deploy`, qui remplace la liste complète des commandes.

Dans Docker : construire avec `docker build -t enigme-bot .`, fournir les secrets à l’exécution et monter un volume inscriptible par l’utilisateur `node` dans `/app/data`. Les `.env*`, bases et fichiers Git sont exclus du contexte de l’image. L’image finale contient le code compilé et les dépendances de production.

## Sauvegarder

Le bot lit `DATABASE_STORAGE` si défini, sinon `DATA_DIR/database.sqlite`, sinon le fichier à la racine du projet. Charger le même environnement pour les commandes d’exploitation.

```bash
npm run db:backup -- /chemin/backup-avant-refonte.sqlite
```

La commande utilise `VACUUM INTO`, puis `PRAGMA integrity_check` sur la copie. Elle refuse d’écraser un fichier existant. Une sauvegarde n’est pas une simple copie à chaud du fichier principal SQLite : des écritures peuvent se trouver dans le WAL. Protéger les sauvegardes comme les données du bot ; elles contiennent notamment les réponses d’énigmes.

## Migrer une base existante

1. Arrêter le bot et conserver une sauvegarde vérifiée.
2. Tester la livraison sur une copie isolée, en définissant `DATABASE_STORAGE` sur cette copie.
3. Exécuter `npm run db:migrate`. Le premier passage vérifie la présence des colonnes de la base historique avant adoption ; un schéma incomplet est refusé.
4. Vérifier les joueurs, inventaires, positions, état de saison et `schema_migrations`.
5. Redémarrer la livraison validée. Les migrations sont aussi exécutées au démarrage, de manière idempotente.

Ne pas lancer `sync({ force: true })` ou `sync({ alter: true })` sur une base de production. Aucune migration ne doit importer les modèles courants pour recréer un schéma historique.

## Restaurer / revenir en arrière

1. Arrêter PM2 et vérifier qu’aucun autre processus n’utilise la base.
2. Conserver la base en panne et ses éventuels fichiers WAL/SHM dans un dossier de diagnostic.
3. Restaurer la sauvegarde à l’emplacement configuré, sans réutiliser de WAL/SHM provenant d’une autre version du fichier.
4. Vérifier `PRAGMA integrity_check` et les totaux de joueurs/pièces/étoiles.
5. Restaurer une version du code compatible avec cette sauvegarde, recompiler et redémarrer.

La restauration perd les actions postérieures à la sauvegarde : annoncer ce point aux joueurs. Les migrations fournies sont ascendantes ; le retour arrière opérationnel repose sur la paire code + sauvegarde, pas sur une suppression automatique de colonnes.

## Diagnostic

- `[ERROR]` : erreur à examiner avec sa stack ; `[WARN]` : dégradation ou opération lente ; `[TIMEOUT]` : accusé Discord expiré.
- Une opération lente conserve son verrou : examiner le réseau et SQLite avant de redémarrer.
- Un échec d’annonce ne doit pas faire répéter un transfert économique déjà validé.
- La santé Kuma est une surveillance de Discord/SQLite, pas une preuve de succès du dernier cron.
- Les choix en attente (`joueurs.action_en_attente`) sont persistants : au redémarrage, leurs expirations sont réarmées et `/jouer` réaffiche le choix. Seuls les rappels MP de `/deviner` sont en mémoire.
- Les paris du samedi sont persistés (`plateau.mode_data.paris_ouverts`) : un redémarrage entre 10h et 21h ne les perd plus.
- `WINNER_ROLE_ID` (optionnel) définit le rôle donné au vainqueur ; s'il est vide, aucun rôle n'est attribué automatiquement.

Le test `backup.test.js` vérifie sauvegarde et relecture indépendante. Un exercice de restauration sur une copie représentative de votre base de production reste nécessaire avant livraison ; aucune base de production n’a été utilisée dans les tests locaux.
