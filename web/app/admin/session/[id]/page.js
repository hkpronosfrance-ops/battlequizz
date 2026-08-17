'use client';
import { useEffect, useState, use } from 'react';
import { supabase } from '../../../../lib/supabase';
import AdminGuard from '../../AdminGuard';

export default function SessionPage({ params }) {
  const { id } = use(params);
  const sessionId = Number(id);

  const [session, setSession] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [voteCounts, setVoteCounts] = useState(null);
  const [overlayUrl, setOverlayUrl] = useState('');

  const [form, setForm] = useState({
    question_text: '', option_a: '', option_b: '', option_c: '', option_d: '',
    correct_option: '', duration_seconds: 15, points_reward: 2,
  });

  async function loadAll() {
    const { data: s } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    setSession(s);
    const { data: qs } = await supabase.from('questions').select('*').eq('session_id', sessionId).order('position');
    setQuestions(qs || []);
    const { data: lb } = await supabase.rpc('get_leaderboard', { p_session_id: sessionId, p_limit: 10 });
    setLeaderboard(lb || []);

    const active = (qs || []).find(q => q.status === 'active');
    if (active) {
      const { data: answers } = await supabase.from('answers').select('chosen_option').eq('question_id', active.id);
      const counts = { A: 0, B: 0, C: 0, D: 0 };
      (answers || []).forEach(a => counts[a.chosen_option]++);
      setVoteCounts(counts);
    } else {
      setVoteCounts(null);
    }
  }

  useEffect(() => {
    loadAll();
    setOverlayUrl(`${window.location.origin}/overlay/${sessionId}`);

    // Realtime: rafraîchit dès qu'une question, une réponse ou un score change
    const channel = supabase.channel('admin-session-' + sessionId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'answers' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores', filter: `session_id=eq.${sessionId}` }, loadAll)
      .subscribe();

    return () => supabase.removeChannel(channel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function setSessionStatus(status) {
    const patch = { status };
    if (status === 'ended') patch.ended_at = new Date().toISOString();
    await supabase.from('sessions').update(patch).eq('id', sessionId);
    loadAll();
  }

  async function addQuestion(e) {
    e.preventDefault();
    const { error } = await supabase.from('questions').insert({
      session_id: sessionId,
      position: questions.length + 1,
      question_text: form.question_text,
      option_a: form.option_a, option_b: form.option_b, option_c: form.option_c, option_d: form.option_d,
      correct_option: form.correct_option,
      duration_seconds: Number(form.duration_seconds) || 15,
      points_reward: Number(form.points_reward) || 2,
    });
    if (error) { alert(error.message); return; }
    setForm({ question_text: '', option_a: '', option_b: '', option_c: '', option_d: '', correct_option: '', duration_seconds: 15, points_reward: 2 });
    loadAll();
  }

  async function deleteQuestion(qid) {
    if (!confirm('Supprimer cette question ?')) return;
    await supabase.from('questions').delete().eq('id', qid);
    loadAll();
  }

  async function startQuestion(qid) {
    // Clôture toute question déjà active dans la session avant d'en lancer une nouvelle
    const active = questions.find(q => q.status === 'active');
    if (active) await supabase.rpc('close_question', { p_question_id: active.id });
    await supabase.from('questions').update({ status: 'active', started_at: new Date().toISOString() }).eq('id', qid);
    loadAll();
  }

  async function stopQuestion(qid) {
    await supabase.rpc('close_question', { p_question_id: qid });
    loadAll();
  }

  function copyOverlay() {
    navigator.clipboard.writeText(overlayUrl);
    alert('URL copiée ! Ajoute-la comme "Browser Source" dans OBS.');
  }

  if (!session) return <AdminGuard><main className="container">Chargement…</main></AdminGuard>;

  return (
    <AdminGuard>
      <main className="container">
        <h2>
          Session #{session.id} — @{session.tiktok_username}{' '}
          <span className={`badge badge-${session.status}`}>{session.status}</span>
        </h2>

        <div className="card actions-bar">
          {session.status !== 'live'
            ? <button onClick={() => setSessionStatus('live')}>▶️ Passer le Live à "live"</button>
            : <button className="danger" onClick={() => setSessionStatus('ended')}>⏹️ Terminer la session</button>}
          <span className="hint">Overlay OBS : <code>{overlayUrl}</code> <button className="mini" onClick={copyOverlay}>Copier</button></span>
        </div>

        <div className="grid2">
          <div>
            <h3>Ajouter une question</h3>
            <form className="card" onSubmit={addQuestion}>
              <textarea placeholder="Texte de la question" required
                value={form.question_text} onChange={e => setForm({ ...form, question_text: e.target.value })} />
              <div className="options-grid">
                <input placeholder="Réponse A" required value={form.option_a} onChange={e => setForm({ ...form, option_a: e.target.value })} />
                <input placeholder="Réponse B" required value={form.option_b} onChange={e => setForm({ ...form, option_b: e.target.value })} />
                <input placeholder="Réponse C" required value={form.option_c} onChange={e => setForm({ ...form, option_c: e.target.value })} />
                <input placeholder="Réponse D" required value={form.option_d} onChange={e => setForm({ ...form, option_d: e.target.value })} />
              </div>
              <div className="options-grid">
                <select required value={form.correct_option} onChange={e => setForm({ ...form, correct_option: e.target.value })}>
                  <option value="">Bonne réponse…</option>
                  <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
                </select>
                <input type="number" placeholder="Durée (s)" value={form.duration_seconds} onChange={e => setForm({ ...form, duration_seconds: e.target.value })} />
                <input type="number" placeholder="Points" value={form.points_reward} onChange={e => setForm({ ...form, points_reward: e.target.value })} />
              </div>
              <button type="submit">+ Ajouter la question</button>
            </form>

            <h3>Questions ({questions.length})</h3>
            <div className="card">
              {questions.map(q => (
                <div className="question-row" key={q.id}>
                  <div>
                    <strong>#{q.position}</strong> {q.question_text}
                    <div className="opts-preview">
                      A) {q.option_a} · B) {q.option_b} · C) {q.option_c} · D) {q.option_d}<br />
                      ✅ Bonne réponse : {q.correct_option} · ⏱ {q.duration_seconds}s · 🏅 {q.points_reward}pts
                    </div>
                  </div>
                  <div className="row-actions">
                    <span className={`badge badge-${q.status}`}>{q.status}</span>
                    {q.status === 'pending' && <button onClick={() => startQuestion(q.id)}>▶️ Lancer</button>}
                    {q.status === 'active' && <button className="danger" onClick={() => stopQuestion(q.id)}>⏹️ Clôturer</button>}
                    {q.status === 'pending' && <button className="mini danger" onClick={() => deleteQuestion(q.id)}>🗑</button>}
                  </div>
                </div>
              ))}
              {questions.length === 0 && <p className="hint">Aucune question.</p>}
            </div>
          </div>

          <div>
            <h3>🔴 Contrôle live</h3>
            <div className="card">
              <p className="hint">La question active et le décompte des votes en direct :</p>
              {voteCounts ? (
                ['A', 'B', 'C', 'D'].map(l => (
                  <div className="vote-bar-row" key={l}><span>{l}</span><strong>{voteCounts[l]} vote(s)</strong></div>
                ))
              ) : 'Aucune question active.'}
            </div>

            <h3>🏆 Classement (top 10)</h3>
            <div className="card">
              {leaderboard.length ? (
                <ol>{leaderboard.map((p, i) => (
                  <li key={i}>{p.display_name || p.tiktok_username} — <strong>{p.total_points} pts</strong> ({p.correct_answers} bonnes rép.)</li>
                ))}</ol>
              ) : <p className="hint">Pas encore de scores.</p>}
            </div>
          </div>
        </div>
      </main>
    </AdminGuard>
  );
}
