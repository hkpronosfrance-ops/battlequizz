/**
 * Correctif automatique pour un bug de tiktok-live-connector@2.x (couche "legacy").
 * ---------------------------------------------------------------------------------
 * Bug : la fonction getTopViewerAttributes() plante avec
 * "Cannot read properties of undefined (reading 'map')" quand TikTok n'envoie pas
 * de liste de classement des viewers (typique avec peu de spectateurs en Live).
 *
 * Ce script patche le fichier compilé directement dans node_modules après chaque
 * `npm install` (via le hook "postinstall" dans package.json). Sans danger : si le
 * patch a déjà été appliqué, le script ne fait rien (idempotent).
 */
const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, '..', 'node_modules', 'tiktok-live-connector', 'dist', 'legacy.js');

if (!fs.existsSync(targetFile)) {
    console.log('[patch] tiktok-live-connector introuvable, rien à corriger.');
    process.exit(0);
}

let content = fs.readFileSync(targetFile, 'utf8');

const buggy = 'function getTopViewerAttributes(topViewers) {\n\treturn topViewers.map(';
const fixed = 'function getTopViewerAttributes(topViewers) {\n\tif (!topViewers) return [];\n\treturn topViewers.map(';

if (content.includes('if (!topViewers) return [];')) {
    console.log('[patch] Déjà appliqué, rien à faire.');
} else if (content.includes(buggy)) {
    content = content.replace(buggy, fixed);
    fs.writeFileSync(targetFile, content, 'utf8');
    console.log('[patch] ✅ Correctif appliqué avec succès (getTopViewerAttributes).');
} else {
    console.log('[patch] ⚠️ Fonction cible introuvable (la lib a peut-être changé) — patch ignoré, à vérifier manuellement si des crashs persistent.');
}
