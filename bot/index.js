/**
 * BattleQuizz Bot — version Supabase
 * ------------------------------------
 * 1. Se connecte au chat du Live TikTok
 * 2. Interroge Supabase pour connaître la session/question active
 * 3. Enregistre les votes directement dans Supabase (players + answers)
 * 4. Clôture les questions via la fonction SQL close_question()
 * 5. Génère la voix IA et l'upload dans Supabase Storage
 *
 * Ne dépend d'AUCUN serveur web local : tout passe par Supabase.
 * L'overlay (hébergé sur Vercel) reçoit les mises à jour via Supabase Realtime.
 */

require('dotenv').config();
const { WebcastPushConnection } = require('tiktok-live-connector/legacy');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { generateSpeech, CACHE_DIR } = require('./tts');

const TIKTOK_USERNAME = process.env.TIKTOK_USERNAME;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '2000', 10);

if (!TIKTOK_USERNAME || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Vérifie ton fichier .env (TIKTOK_USERNAME, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// --- État en mémoire ---
let sessionId = null;
let currentQuestion = null;
let questionTimeout = null;
let countdownVoiceTimeout = null;
let votedUsers = new Set();

/** Génère la voix, l'upload dans Supabase Storage, et déclenche sa lecture sur l'overlay via voice_events */
async function say(text) {
    const filename = await generateSpeech(text);
    if (!filename) return;

    const filepath = path.join(CACHE_DIR, filename);
    const fileBuffer = fs.readFileSync(filepath);

    const { error: uploadError } = await supabase.storage
        .from('voice')
        .upload(filename, fileBuffer, { contentType: 'audio/mpeg', upsert: true });

    if (uploadError && uploadError.message && !uploadError.message.includes('already exists')) {
        console.error('❌ Erreur upload Supabase Storage:', uploadError.message);
        return;
    }

    const { data: pub } = supabase.storage.from('voice').getPublicUrl(filename);
    await supabase.from('voice_events').insert({ session_id: sessionId, audio_url: pub.publicUrl });
}

// --- 1. Trouver la session live pour ce compte TikTok ---
async function findLiveSession() {
    const { data, error } = await supabase
        .from('sessions')
        .select('id, title')
        .eq('tiktok_username', TIKTOK_USERNAME)
        .eq('status', 'live')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) { console.error('Erreur findLiveSession:', error.message); return; }

    if (data) {
        if (sessionId !== data.id) console.log(`🎬 Session live détectée : #${data.id} (${data.title || 'sans titre'})`);
        sessionId = data.id;
    } else {
        sessionId = null;
    }
}

// --- 2. Poll de la question active ---
async function pollActiveQuestion() {
    if (!sessionId) return;

    const { data, error } = await supabase
        .from('questions')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .maybeSingle();

    if (error) { console.error('Erreur pollActiveQuestion:', error.message); return; }

    if (data && (!currentQuestion || currentQuestion.id !== data.id)) {
        currentQuestion = data;
        votedUsers = new Set();

        console.log(`❓ Nouvelle question active : "${currentQuestion.question_text}"`);
        say(`Nouvelle question ! ${currentQuestion.question_text} Réponse A : ${currentQuestion.option_a}. B : ${currentQuestion.option_b}. C : ${currentQuestion.option_c}. D : ${currentQuestion.option_d}.`);

        clearTimeout(questionTimeout);
        clearTimeout(countdownVoiceTimeout);

        const msUntilEnd = currentQuestion.duration_seconds * 1000;
        if (currentQuestion.duration_seconds > 5) {
            countdownVoiceTimeout = setTimeout(() => say('3, 2, 1 !'), Math.max(msUntilEnd - 3000, 0));
        }
        questionTimeout = setTimeout(() => closeCurrentQuestion(), msUntilEnd + 500);
    }

    if (!data && currentQuestion) {
        await closeCurrentQuestion();
    }
}

// --- 3. Clôture de la question ---
async function closeCurrentQuestion() {
    if (!currentQuestion) return;
    const question = currentQuestion;
    clearTimeout(questionTimeout);
    clearTimeout(countdownVoiceTimeout);
    currentQuestion = null;

    const { data: results, error } = await supabase.rpc('close_question', { p_question_id: question.id });
    if (error) { console.error('Erreur close_question:', error.message); return; }

    const counts = { A: 0, B: 0, C: 0, D: 0 };
    (results || []).forEach(r => { counts[r.chosen_option] = Number(r.votes); });
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const correctVotes = counts[question.correct_option] || 0;
    const correctText = question['option_' + question.correct_option.toLowerCase()];

    console.log(`✅ Question #${question.id} clôturée. Bonne réponse : ${question.correct_option}`);

    let commentary = `La bonne réponse était ${question.correct_option} : ${correctText} !`;
    if (total > 0) {
        const pct = Math.round((correctVotes / total) * 100);
        commentary += pct >= 50
            ? ` Bien joué, ${pct} pour cent d'entre vous avaient trouvé !`
            : ` Seulement ${pct} pour cent d'entre vous avaient trouvé, attention à la prochaine !`;
    }
    say(commentary);

    const { data: leaderboard } = await supabase.rpc('get_leaderboard', { p_session_id: question.session_id, p_limit: 1 });
    if (leaderboard && leaderboard.length > 0) {
        const leader = leaderboard[0];
        const leaderName = leader.display_name || leader.tiktok_username;
        setTimeout(() => say(`${leaderName} est en tête du classement avec ${leader.total_points} points, félicitations !`), 5000);
    }
}

// --- 4. Connexion au chat TikTok Live ---
let tiktokConnection = null;

async function connectToTikTok() {
    const options = {};
    if (process.env.EULERSTREAM_API_KEY) options.signApiKey = process.env.EULERSTREAM_API_KEY;

    tiktokConnection = new WebcastPushConnection(TIKTOK_USERNAME, options);

    try {
        const state = await tiktokConnection.connect();
        console.log(`🔴 Connecté au Live de @${TIKTOK_USERNAME} (roomId: ${state.roomId})`);
    } catch (err) {
        console.error('❌ Connexion TikTok échouée, nouvelle tentative dans 15s :', err.message);
        setTimeout(connectToTikTok, 15000);
        return;
    }

    tiktokConnection.on('chat', async (data) => {
        const raw = (data.comment || '').trim().toUpperCase();
        const letter = ['A', 'B', 'C', 'D'].find(l => raw === l || raw.startsWith(l + ' '));
        if (!letter || !currentQuestion) return;

        const userId = String(data.userId);
        if (votedUsers.has(userId)) return;
        votedUsers.add(userId);

        try {
            // Upsert du joueur (crée ou met à jour pseudo/avatar)
            const { data: player, error: playerError } = await supabase
                .from('players')
                .upsert(
                    { tiktok_user_id: userId, tiktok_username: data.uniqueId, display_name: data.nickname, avatar_url: data.profilePictureUrl },
                    { onConflict: 'tiktok_user_id' }
                )
                .select().single();

            if (playerError) { console.error('Erreur upsert player:', playerError.message); return; }

            // Insertion du vote (ignoré silencieusement si déjà voté, grâce à la contrainte unique)
            await supabase.from('answers').insert({
                question_id: currentQuestion.id,
                player_id: player.id,
                chosen_option: letter,
            });
        } catch (err) {
            console.error('Erreur enregistrement vote:', err.message);
        }
    });

    tiktokConnection.on('streamEnd', () => {
        console.log("⚫ Le Live TikTok s'est terminé.");
        setTimeout(connectToTikTok, 15000);
    });

    tiktokConnection.on('disconnected', () => {
        console.log('⚠️  Déconnecté du Live, nouvelle tentative dans 10s…');
        setTimeout(connectToTikTok, 10000);
    });
}

// --- Boucles principales ---
setInterval(findLiveSession, POLL_INTERVAL_MS);
setInterval(pollActiveQuestion, POLL_INTERVAL_MS);
findLiveSession();
connectToTikTok();
