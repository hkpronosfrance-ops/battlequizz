'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../lib/supabase';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const router = useRouter();

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setError('Identifiants incorrects'); return; }
    router.push('/admin');
  }

  return (
    <div className="login-page">
      <form className="login-box" onSubmit={handleSubmit}>
        <h1>🎮 BattleQuizz</h1>
        <p className="subtitle">Back-office admin</p>
        {error && <p className="error">{error}</p>}
        <input type="email" placeholder="Email" required value={email} onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Mot de passe" required value={password} onChange={e => setPassword(e.target.value)} />
        <button type="submit">Se connecter</button>
      </form>
    </div>
  );
}
