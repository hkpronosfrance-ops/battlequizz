# 🚀 Déployer BattleQuizz sur Vercel + Supabase + GitHub

Guide pas-à-pas, à suivre dans l'ordre. Compte-rendu : ~30-40 minutes la première fois.

---

## 1. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com) → **New project**.
2. Choisis un nom (ex: `battlequizz`), un mot de passe DB (garde-le de côté), une région proche de toi (Europe).
3. Attends ~2 minutes que le projet se crée.

### 1.1 Créer les tables

1. Dans le menu de gauche → **SQL Editor** → **New query**.
2. Colle **tout** le contenu de `supabase/schema.sql` (fourni dans ce zip).
3. Clique **Run**. Tu dois voir "Success. No rows returned".

### 1.2 Créer le bucket de stockage (pour les fichiers audio de la voix IA)

1. Menu de gauche → **Storage** → **New bucket**.
2. Nom : `voice`. Coche **Public bucket** (pour que l'overlay puisse lire les mp3 sans authentification).
3. Clique **Create bucket**.

### 1.3 Créer ton compte admin

1. Menu de gauche → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Renseigne ton email + un mot de passe. Décoche "Auto Confirm User" si tu veux confirmer par email, ou coche-le pour pouvoir te connecter immédiatement.
3. C'est cet email/mot de passe que tu utiliseras pour te connecter au back-office.

### 1.4 Récupérer tes clés API

Menu de gauche → **Project Settings** → **API**. Note :
- **Project URL** (ex: `https://xxxxxxxxxxxx.supabase.co`)
- **anon public** key
- **service_role** key ⚠️ (secrète, ne jamais la mettre dans le site web — uniquement sur ton PC pour le bot)

---

## 2. Mettre le code sur GitHub

```bash
cd battlequizz-cloud
git init
git add .
git commit -m "Initial commit BattleQuizz"
```

1. Va sur [github.com/new](https://github.com/new), crée un dépôt (ex: `battlequizz`), **sans** README ni .gitignore auto-générés.
2. Suis les instructions affichées pour pousser ton code existant :
```bash
git remote add origin https://github.com/TON_PSEUDO/battlequizz.git
git branch -M main
git push -u origin main
```

> 💡 Rappel : commits sur ce repo doivent utiliser l'email que tu utilises habituellement pour tes projets perso (pas `hkpronosfrance@gmail.com`, réservé à Football Legacy — sauf si tu veux le même compte ici aussi).

---

## 3. Déployer sur Vercel

1. Va sur [vercel.com/new](https://vercel.com/new), connecte ton compte GitHub, sélectionne le dépôt `battlequizz`.
2. **Important** : dans "Root Directory", clique **Edit** et choisis le dossier **`web`** (l'app Next.js n'est pas à la racine du repo).
3. Dans **Environment Variables**, ajoute :
   ```
   NEXT_PUBLIC_SUPABASE_URL      = (ton Project URL Supabase)
   NEXT_PUBLIC_SUPABASE_ANON_KEY = (ta clé anon public)
   ```
4. Clique **Deploy**. Après ~1-2 minutes, tu obtiens une URL du style `https://battlequizz-xxxx.vercel.app`.

Chaque futur `git push` sur `main` redéploiera automatiquement.

### Vérification

- Va sur `https://ton-app.vercel.app/admin/login` → connecte-toi avec l'email/mot de passe créé à l'étape 1.3.
- Crée une session de test avec ton pseudo TikTok.
- Note l'URL de l'overlay affichée dans la page de session (`https://ton-app.vercel.app/overlay/1`).

---

## 4. Configurer le bot sur ton PC

```bash
cd battlequizz-cloud/bot
npm install
cp .env.example .env
```

Édite `.env` :
```
TIKTOK_USERNAME=ton_pseudo_tiktok
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ta_cle_service_role   ⚠️ celle qui est SECRÈTE, pas la anon
VOICE_ENABLED=true
TTS_PROVIDER=edge
```

Lance-le avec PM2 (auto-restart) :
```bash
npm install -g pm2
npm run pm2:start
pm2 logs battlequizz-bot     # vérifie que tu vois "🔴 Connecté au Live de @..."
```

Pour qu'il redémarre automatiquement avec ton PC :
```bash
pm2 startup
pm2 save
```

---

## 5. Ajouter l'overlay dans OBS

1. Dans OBS : **+ Source → Navigateur (Browser Source)**.
2. URL : `https://ton-app.vercel.app/overlay/ID_DE_SESSION` (une vraie URL publique cette fois, plus de `file://`).
3. Largeur `720`, Hauteur `1280`.
4. Place la source par-dessus ta caméra dans la scène.

---

## 6. Déroulé pendant le Live

1. Le bot (PM2) tourne déjà en fond, il attend qu'une session passe en "live".
2. Tu vas sur l'admin (`/admin`, accessible depuis ton téléphone aussi) → tu cliques **"Passer le Live à live"** sur ta session.
3. Tu démarres ton Live TikTok + OBS comme d'habitude.
4. Tu cliques **"Lancer"** sur tes questions au fur et à mesure — tout se synchronise automatiquement (overlay, votes, voix, classement) via Supabase Realtime.

---

## Récapitulatif des URLs à retenir

| Élément | URL |
|---|---|
| Back-office admin | `https://ton-app.vercel.app/admin` |
| Overlay (à coller dans OBS) | `https://ton-app.vercel.app/overlay/{id session}` |
| Dashboard Supabase | `https://supabase.com/dashboard/project/xxxxx` |
| Dashboard Vercel | `https://vercel.com/dashboard` |

## Dépannage rapide

- **Le bot ne se connecte pas au Live** → vérifie que `TIKTOK_USERNAME` dans `.env` correspond exactement à ton pseudo (sans @), et que le Live est bien démarré.
- **L'overlay reste vide** → vérifie que la session est bien en statut "live" dans l'admin, et que l'URL overlay contient le bon ID de session.
- **Pas de voix** → vérifie `pm2 logs battlequizz-bot` pour voir les erreurs ; teste `VOICE_ENABLED=false` pour isoler le problème si besoin.
- **Erreur RLS / permission denied** → vérifie que tu es bien connecté dans l'admin (sinon les insert/update sur sessions/questions sont bloqués par les policies).
