/**
 * Module Text-to-Speech — 3 fournisseurs au choix (voir server/.env : TTS_PROVIDER)
 * ------------------------------------------------------------------------------
 * - "edge"       : GRATUIT, illimité, sans clé API. Voix neurales Microsoft Edge.
 *                  ⚠️ Les voix "Multilingual" (Remy, Vivienne) peuvent parfois
 *                  prononcer un mot isolé à l'anglaise en pleine phrase française.
 * - "polly"      : Amazon Polly. Voix Neural verrouillées sur le français (pas de
 *                  mélange de langue). Gratuit ~12 mois (1M caractères/mois en
 *                  Neural), puis 16$/million de caractères. Nécessite un compte AWS.
 * - "elevenlabs" : Payant, voix la plus expressive/premium.
 *
 * Dans tous les cas : cache disque pour éviter de regénérer les phrases répétées.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

const CACHE_DIR = path.join(__dirname, 'audio_cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

const ENABLED = (process.env.VOICE_ENABLED || 'true').toLowerCase() === 'true';
const PROVIDER = (process.env.TTS_PROVIDER || 'edge').toLowerCase(); // "edge", "polly" ou "elevenlabs"

// --- Config Edge TTS (gratuit) ---
const EDGE_VOICE = process.env.EDGE_VOICE || 'fr-FR-RemyMultilingualNeural';

// --- Config Amazon Polly ---
const POLLY_VOICE_ID = process.env.POLLY_VOICE_ID || 'Remi'; // ou "Lea" (féminine)
const POLLY_REGION = process.env.AWS_REGION || 'eu-west-3'; // Paris

// --- Config ElevenLabs (payant) ---
const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

function hashText(text) {
    return crypto.createHash('md5').update(PROVIDER + '::' + EDGE_VOICE + POLLY_VOICE_ID + ELEVEN_VOICE_ID + '::' + text).digest('hex');
}

async function generateSpeechEdge(text, filepath) {
    const { EdgeTTS } = require('node-edge-tts');
    const tts = new EdgeTTS({ voice: EDGE_VOICE, lang: EDGE_VOICE.slice(0, 5) });
    await tts.ttsPromise(text, filepath);
}

async function generateSpeechPolly(text, filepath) {
    const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
    const client = new PollyClient({ region: POLLY_REGION }); // credentials lues depuis les variables d'env AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY

    const command = new SynthesizeSpeechCommand({
        Text: text,
        OutputFormat: 'mp3',
        VoiceId: POLLY_VOICE_ID,
        Engine: 'neural',
        LanguageCode: 'fr-FR',
    });

    const response = await client.send(command);
    const chunks = [];
    for await (const chunk of response.AudioStream) chunks.push(chunk);
    fs.writeFileSync(filepath, Buffer.concat(chunks));
}

async function generateSpeechElevenLabs(text, filepath) {
    if (!ELEVEN_API_KEY || ELEVEN_API_KEY === 'ta_cle_elevenlabs') {
        console.warn('⚠️  ELEVENLABS_API_KEY non configurée — voix IA désactivée.');
        return false;
    }
    const response = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
        {
            text,
            model_id: 'eleven_multilingual_v2',
            voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true },
        },
        {
            headers: { 'xi-api-key': ELEVEN_API_KEY, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
            responseType: 'arraybuffer',
            timeout: 20000,
        }
    );
    fs.writeFileSync(filepath, response.data);
    return true;
}

/**
 * Génère (ou récupère depuis le cache) l'audio pour un texte.
 * Retourne le nom de fichier (relatif à /audio_cache) ou null si désactivé/erreur.
 */
async function generateSpeech(text) {
    if (!ENABLED) return null;

    const filename = hashText(text) + '.mp3';
    const filepath = path.join(CACHE_DIR, filename);

    if (fs.existsSync(filepath)) {
        return filename; // déjà généré précédemment
    }

    try {
        if (PROVIDER === 'elevenlabs') {
            const ok = await generateSpeechElevenLabs(text, filepath);
            if (!ok) return null;
        } else if (PROVIDER === 'polly') {
            await generateSpeechPolly(text, filepath);
        } else {
            await generateSpeechEdge(text, filepath);
        }
        console.log(`🔊 [${PROVIDER}] Voix générée : "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);
        return filename;
    } catch (err) {
        console.error(`❌ Erreur TTS (${PROVIDER}):`, err.response?.data?.toString?.() || err.message);
        return null;
    }
}

module.exports = { generateSpeech, CACHE_DIR };

