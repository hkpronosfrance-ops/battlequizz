/**
 * Script de test — génère plusieurs échantillons de voix pour comparaison.
 * Usage : node test-voices.js
 * (à lancer depuis le dossier bot/, avec npm install déjà fait)
 */
const { EdgeTTS } = require('node-edge-tts');
const fs = require('fs');

const SAMPLE_TEXT = "Nouvelle question ! Quel dirigeant a unifié le Nejd et le Hedjaz pour fonder l'Arabie saoudite en 1932 ? Bien joué, 78 pour cent d'entre vous avaient trouvé !";

const voices = [
    { file: '1_henri_actuelle.mp3',       voice: 'fr-FR-HenriNeural' },                    // voix actuelle
    { file: '2_denise.mp3',                voice: 'fr-FR-DeniseNeural' },                   // féminine classique
    { file: '3_vivienne_multi.mp3',        voice: 'fr-FR-VivienneMultilingualNeural' },     // féminine nouvelle génération, plus naturelle
    { file: '4_remy_multi.mp3',            voice: 'fr-FR-RemyMultilingualNeural' },         // masculine nouvelle génération, plus naturelle
    { file: '5_remy_multi_dynamique.mp3',  voice: 'fr-FR-RemyMultilingualNeural', rate: '+12%', pitch: '+3Hz' }, // même voix, plus rythmée façon "hype host"
];

(async () => {
    if (!fs.existsSync('./voice_samples')) fs.mkdirSync('./voice_samples');

    for (const v of voices) {
        try {
            const tts = new EdgeTTS({
                voice: v.voice,
                lang: 'fr-FR',
                rate: v.rate || 'default',
                pitch: v.pitch || 'default',
            });
            const path = './voice_samples/' + v.file;
            await tts.ttsPromise(SAMPLE_TEXT, path);
            console.log('✅ Généré :', path, '(' + v.voice + (v.rate ? ', rate ' + v.rate : '') + ')');
        } catch (e) {
            console.log('❌ Erreur pour', v.voice, ':', e.message);
        }
    }
    console.log('\n🎧 Écoute les fichiers dans le dossier voice_samples/ et dis-moi lequel tu préfères !');
})();
