'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import AdminGuard from './AdminGuard';

export default function AdminHome() {
  const [sessions, setSessions] = useState([]);
  const [tiktokUsername, setTiktokUsername] = useState('');
  const [title, setTitle] = useState('');

  async function loadSessions() {
    const { data } = await supabase.from('sessions').select('*').order('created_at', { ascending: false }).limit(50);
    setSessions(data || []);
  }

  useEffect(() => { loadSessions(); }, []);

  async function createSession(e) {
    e.preventDefault();
    const { data, error } = await supabase.from('sessions')
      .insert({ tiktok_username: tiktokUsername.trim(), title: title.trim() || null })
      .select().single();
    if (error) { alert(error.message); return; }
    window.location.href = `/admin/session/${data.id}`;
  }

  return (
    <AdminGuard>
      <main className="container">
        <h2>Nouvelle session de quiz</h2>
        <form onSubmit={createSession} className="card form-inline">
          <input type="text" placeholder="Pseudo TikTok (ex: hkpronosfrance)" required
            value={tiktokUsername} onChange={e => setTiktokUsername(e.target.value)} />
          <input type="text" placeholder="Titre (optionnel)" value={title} onChange={e => setTitle(e.target.value)} />
          <button type="submit">Créer</button>
        </form>

        <h2>Sessions</h2>
        <table className="table">
          <thead><tr><th>ID</th><th>Compte TikTok</th><th>Titre</th><th>Statut</th><th>Créée le</th><th></th></tr></thead>
          <tbody>
            {sessions.map(s => (
              <tr key={s.id}>
                <td>#{s.id}</td>
                <td>@{s.tiktok_username}</td>
                <td>{s.title || '—'}</td>
                <td><span className={`badge badge-${s.status}`}>{s.status}</span></td>
                <td>{new Date(s.created_at).toLocaleString('fr-FR')}</td>
                <td><a href={`/admin/session/${s.id}`}>Gérer →</a></td>
              </tr>
            ))}
            {sessions.length === 0 && <tr><td colSpan={6}>Aucune session pour l'instant.</td></tr>}
          </tbody>
        </table>
      </main>
    </AdminGuard>
  );
}
