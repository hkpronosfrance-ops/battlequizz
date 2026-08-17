'use client';
import { useEffect, useRef, useState, use } from 'react';
import { supabase } from '../../../lib/supabase';

const OPT_LETTERS = ['A', 'B', 'C', 'D'];

export default function OverlayPage({ params }) {
  const { id } = use(params);
  const sessionId = Number(id);

  const [question, setQuestion] = useState(null);      // question active
  const [counts, setCounts] = useState({ A: 0, B: 0, C: 0, D: 0 });
  const [avatars, setAvatars] = useState({ A: [], B: [], C: [], D: [] });
  const [remaining, setRemaining] = useState(null);
  const [revealed, setRevealed] = useState(null);       // { correct_option }
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardPage, setLeaderboardPage] = useState(0);
  const [playerCount, setPlayerCount] = useState(0);
  const [palierCelebration, setPalierCelebration] = useState(null); // { palier, names, bonus_points }
  const [statusLine, setStatusLine] = useState('En attente de la prochaine question…');

  const seenAvatars = useRef({ A: new Set(), B: new Set(), C: new Set(), D: new Set() });
  const audioRef = useRef(null);
  const voiceQueue = useRef([]);
  const voicePlaying = useRef(false);
  const timerRef = useRef(null);
  const questionRef = useRef(null); // évite les "stale closures" dans le callback Realtime
  const countsRef = useRef({ A: 0, B: 0, C: 0, D: 0 });
  const audioCtxRef = useRef(null); // pour les sons générés (ding, whoosh, fanfare)

  useEffect(() => { questionRef.current = question; }, [question]);
  useEffect(() => { countsRef.current = counts; }, [counts]);

  // --- Sons générés en direct (aucun fichier externe) ---
  function getAudioCtx() {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    return audioCtxRef.current;
  }

  function playDing() {
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1568, ctx.currentTime + 0.09);
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) { /* silencieux si Web Audio indisponible */ }
  }

  function playWhoosh() {
    try {
      const ctx = getAudioCtx();
      const bufferSize = Math.floor(ctx.sampleRate * 0.35);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 0.7;
      filter.frequency.setValueAtTime(150, ctx.currentTime);
      filter.frequency.exponentialRampToValueAtTime(2800, ctx.currentTime + 0.32);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.22, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      noise.connect(filter).connect(gain).connect(ctx.destination);
      noise.start();
    } catch (e) { /* silencieux */ }
  }

  function playFanfare() {
    try {
      const ctx = getAudioCtx();
      const notes = [523.25, 659.25, 783.99, 1046.5]; // do-mi-sol-do aigu
      notes.forEach((freq, i) => {
        const t = ctx.currentTime + i * 0.11;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        gain.gain.setValueAtTime(0.001, t);
        gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.36);
      });
    } catch (e) { /* silencieux */ }
  }

  async function refreshLeaderboard() {
    const { data } = await supabase.rpc('get_leaderboard', { p_session_id: sessionId, p_limit: 100 });
    setLeaderboard(data || []);
    const { data: count } = await supabase.rpc('get_session_player_count', { p_session_id: sessionId });
    setPlayerCount(count || 0);
  }

  async function refreshVotes(questionId) {
    const { data } = await supabase
      .from('answers')
      .select('chosen_option, players(tiktok_username, avatar_url)')
      .eq('question_id', questionId);

    const c = { A: 0, B: 0, C: 0, D: 0 };
    const a = { A: [], B: [], C: [], D: [] };
    (data || []).forEach(row => {
      c[row.chosen_option]++;
      a[row.chosen_option].push({ username: row.players?.tiktok_username, avatar_url: row.players?.avatar_url });
    });
    setCounts(c);

    // N'anime (pop-in) que les avatars pas encore vus pour cette question, et joue un "ding" s'il y en a
    let hasNewVote = false;
    OPT_LETTERS.forEach(letter => {
      a[letter].forEach(av => {
        if (!seenAvatars.current[letter].has(av.username)) hasNewVote = true;
        seenAvatars.current[letter].add(av.username);
      });
    });
    if (hasNewVote) playDing();
    setAvatars(a);
  }

  async function loadActiveQuestion() {
    const { data } = await supabase.from('questions').select('*')
      .eq('session_id', sessionId).eq('status', 'active').maybeSingle();

    if (data && data.id !== questionRef.current?.id) {
      seenAvatars.current = { A: new Set(), B: new Set(), C: new Set(), D: new Set() };
      setQuestion(data);
      setRevealed(null);
      setStatusLine('Tape A, B, C ou D dans le chat pour voter !');
      playWhoosh();
      refreshVotes(data.id);
      startCountdown(data);
    } else if (!data && questionRef.current) {
      // La question a été clôturée entre-temps
      handleClosed(questionRef.current.id);
    }
  }

  function startCountdown(q) {
    clearInterval(timerRef.current);
    const startedAt = new Date(q.started_at).getTime();
    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const left = Math.max(Math.ceil(q.duration_seconds - elapsed), 0);
      setRemaining(left);
      if (left <= 0) clearInterval(timerRef.current);
    }, 500);
  }

  async function handleClosed(questionId) {
    const { data: q } = await supabase.from('questions').select('*').eq('id', questionId).single();
    if (!q) return;
    clearInterval(timerRef.current);
    setRevealed({ correct_option: q.correct_option });
    playFanfare();
    const total = Object.values(countsRef.current).reduce((a, b) => a + b, 0);
    const correctVotes = countsRef.current[q.correct_option] || 0;
    const pct = total > 0 ? Math.round((correctVotes / total) * 100) : 0;
    setStatusLine(`✅ Bonne réponse : ${q.correct_option} — ${q['option_' + q.correct_option.toLowerCase()]} (${pct}% ont trouvé)`);
    refreshLeaderboard();
    setTimeout(() => { setQuestion(null); setStatusLine('En attente de la prochaine question…'); }, 6000);
  }

  function playNextVoice() {
    if (voicePlaying.current || voiceQueue.current.length === 0) return;
    voicePlaying.current = true;
    audioRef.current.src = voiceQueue.current.shift();
    audioRef.current.play().catch(() => {});
  }

  useEffect(() => {
    loadActiveQuestion();
    refreshLeaderboard();

    const channel = supabase.channel('overlay-' + sessionId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${sessionId}` },
        () => loadActiveQuestion())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' },
        (payload) => { if (questionRef.current && payload.new.question_id === questionRef.current.id) refreshVotes(questionRef.current.id); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `session_id=eq.${sessionId}` },
        () => refreshLeaderboard())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'voice_events', filter: `session_id=eq.${sessionId}` },
        (payload) => { voiceQueue.current.push(payload.new.audio_url); playNextVoice(); })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'palier_events' , filter: `session_id=eq.${sessionId}` },
        (payload) => {
          const names = (payload.new.sans_faute_players || []).map(p => p.display_name || p.tiktok_username);
          if (names.length > 0) playFanfare();
          setPalierCelebration({ palier: payload.new.palier, names, bonus_points: payload.new.bonus_points });
          setTimeout(() => setPalierCelebration(null), 6000);
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); clearInterval(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fait défiler automatiquement les pages du classement (10 par page) si plus de 10 joueurs
  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(leaderboard.length / 10));
    if (totalPages <= 1) { setLeaderboardPage(0); return; }
    const interval = setInterval(() => {
      setLeaderboardPage(p => (p + 1) % totalPages);
    }, 6000);
    return () => clearInterval(interval);
  }, [leaderboard.length]);

  return (
    <div style={{ width: 720, minHeight: 1000, padding: 20, background: 'transparent', color: '#fff', fontFamily: "'Segoe UI', Arial, sans-serif" }}>
      <style>{css}</style>

      <div className="top-bar">
        <span>🎮 BattleQuizz LIVE</span>
        <div className="tier-bar"><div className="tier-fill" /></div>
        <span className="player-count">👥 {playerCount}</span>
      </div>

      {palierCelebration ? (
        <div className="palier-celebration enter">
          <div className="palier-title">✅ Palier {palierCelebration.palier} validé</div>
          {palierCelebration.names.length > 0 ? (
            <>
              <div className="palier-subtitle">🎉 Bravo aux sans-faute !</div>
              <div className="palier-names">{palierCelebration.names.slice(0, 12).join(' · ')}</div>
              <div className="palier-bonus">+{palierCelebration.bonus_points} points pour chaque joueur sans-faute</div>
            </>
          ) : (
            <div className="palier-subtitle">Personne n'a fait sans-faute cette fois… la prochaine !</div>
          )}
        </div>
      ) : (
        <div className="leaderboard">
          <div className="leaderboard-head">
            <h4>🏆 Classement live</h4>
            {leaderboard.length > 10 && <span className="page-indicator">Page {leaderboardPage + 1}/{Math.ceil(leaderboard.length / 10)}</span>}
          </div>
          <div className="leaderboard-grid">
            {leaderboard.slice(leaderboardPage * 10, leaderboardPage * 10 + 10).map((p, i) => (
              <div className="row" key={i}>
                <span><span className="rank">{leaderboardPage * 10 + i + 1}</span>{p.display_name || p.tiktok_username}
                  {p.sans_faute_count > 0 && <span className="sf-badge">SF</span>}
                </span>
                <strong>{p.total_points}</strong>
              </div>
            ))}
          </div>
        </div>
      )}

      {question && (
        <div className="question-box enter">
          <div className="timer-circle">{remaining ?? '--'}</div>
          <div className="qtext">{question.question_text}</div>
        </div>
      )}

      {question && (
        <div>
          {OPT_LETTERS.map((letter, i) => (
            <div key={letter} className={`option opt-${letter} enter ${revealed ? (letter === revealed.correct_option ? 'correct' : 'wrong') : ''}`}
              style={{ animationDelay: `${i * 80}ms` }}>
              <div className="badge-letter">{letter}</div>
              <div className="label">{question['option_' + letter.toLowerCase()]}</div>
              <div className="avatars">
                {avatars[letter].slice(-12).map((a, idx) => (
                  <img key={a.username + idx} src={a.avatar_url || 'https://placehold.co/26x26'} title={a.username} className="avatar-pop" />
                ))}
              </div>
              <div className="vote-count">{counts[letter]} vote(s)</div>
            </div>
          ))}
        </div>
      )}

      <div className="status-line">{statusLine}</div>
      <audio ref={audioRef} style={{ display: 'none' }} onEnded={() => { voicePlaying.current = false; playNextVoice(); }} />
    </div>
  );
}

const css = `
.top-bar { display:flex; align-items:center; gap:10px; background:rgba(15,15,25,0.75); border-radius:14px; padding:10px 14px; margin-bottom:16px; font-size:14px; font-weight:600; }
.top-bar .tier-bar { flex:1; height:6px; background:#333; border-radius:4px; overflow:hidden; }
.top-bar .tier-fill { height:100%; background:linear-gradient(90deg,#ffb020,#ff5c2f); width:40%; }
.top-bar .player-count { font-size:13px; opacity:.9; }
.leaderboard { width:100%; box-sizing:border-box; background:rgba(10,12,25,.88); border:1px solid #333; border-radius:14px; padding:10px 14px; margin-bottom:16px; }
.leaderboard-head { display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; }
.leaderboard h4 { margin:0; font-size:13px; text-transform:uppercase; color:#ffb020; }
.page-indicator { font-size:11px; color:#8a8fae; }
.leaderboard-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 14px; }
.leaderboard .row { display:flex; justify-content:space-between; font-size:13px; padding:4px 0; border-bottom:1px solid #222; }
.leaderboard .rank { color:#888; width:20px; display:inline-block; }
.sf-badge { background:#ffb020; color:#1a1a1a; font-size:9px; font-weight:800; padding:1px 5px; border-radius:6px; margin-left:6px; vertical-align:middle; }
.palier-celebration { width:100%; box-sizing:border-box; background:linear-gradient(135deg, rgba(15,50,30,.94), rgba(10,35,25,.94)); border:2px solid #22c55e; border-radius:16px; padding:24px; margin-bottom:16px; text-align:center; }
.palier-title { font-size:20px; font-weight:800; color:#4ade80; margin-bottom:8px; }
.palier-subtitle { font-size:14px; color:#ffe08a; margin-bottom:10px; }
.palier-names { font-size:13px; color:#fff; line-height:1.6; margin-bottom:10px; }
.palier-bonus { font-size:13px; color:#4ade80; font-weight:700; }
.palier-celebration.enter { animation: questionPop .5s cubic-bezier(.34,1.56,.64,1) both; }
.question-box { background:linear-gradient(135deg, rgba(20,25,50,.92), rgba(30,20,55,.92)); border:2px solid #3d5cff; border-radius:16px; padding:22px; margin:16px 0; text-align:center; position:relative; }
.question-box .qtext { font-size:24px; font-weight:700; color:#ffe08a; line-height:1.35; }
.timer-circle { position:absolute; top:14px; right:14px; width:46px; height:46px; border-radius:50%; border:4px solid #3d5cff; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px; background:rgba(0,0,0,.4); }
.option { position:relative; margin-bottom:12px; border-radius:14px; padding:16px 18px; background:rgba(15,15,25,0.8); border:2px solid; overflow:hidden; }
.option .label { font-size:22px; font-weight:800; text-transform:uppercase; letter-spacing:.5px; padding-right:36px; }
.option .badge-letter { position:absolute; top:14px; right:16px; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px; }
.option .avatars { display:flex; flex-wrap:wrap; gap:4px; margin-top:10px; min-height:28px; }
.option .avatars img { width:26px; height:26px; border-radius:50%; border:2px solid rgba(255,255,255,.6); object-fit:cover; }
.option .vote-count { position:absolute; bottom:10px; right:16px; font-size:13px; opacity:.85; font-weight:600; }
.opt-A { border-color:#ff8a3d; } .opt-A .badge-letter { background:#ff8a3d; color:#1a1a1a; }
.opt-B { border-color:#a855f7; } .opt-B .badge-letter { background:#a855f7; }
.opt-C { border-color:#facc15; } .opt-C .badge-letter { background:#facc15; color:#1a1a1a; }
.opt-D { border-color:#ec4899; } .opt-D .badge-letter { background:#ec4899; }
.option.correct { box-shadow:0 0 0 3px #22c55e, 0 0 24px 4px #22c55e; }
.option.wrong { opacity:.35; }
.option.enter { animation: optionPop .5s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes optionPop { 0%{opacity:0; transform:translateY(18px) scale(.92);} 60%{opacity:1; transform:translateY(-3px) scale(1.02);} 100%{opacity:1; transform:translateY(0) scale(1);} }
.question-box.enter { animation: questionPop .5s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes questionPop { 0%{opacity:0; transform:scale(.85) translateY(-12px);} 60%{opacity:1; transform:scale(1.03) translateY(2px);} 100%{opacity:1; transform:scale(1) translateY(0);} }
.avatar-pop { animation: avatarPop .45s cubic-bezier(.34,1.56,.64,1) both; }
@keyframes avatarPop { 0%{opacity:0; transform:scale(0);} 65%{opacity:1; transform:scale(1.25);} 100%{opacity:1; transform:scale(1);} }
.status-line { text-align:center; font-size:13px; color:#ffe08a; margin-top:8px; min-height:18px; }
`;
