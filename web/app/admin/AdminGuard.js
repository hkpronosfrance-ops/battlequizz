'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function AdminGuard({ children }) {
  const [ready, setReady] = useState(false);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push('/admin/login'); return; }
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.push('/admin/login');
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  if (!ready) return null;

  return (
    <>
      <nav className="topnav">
        <a href="/admin" className="brand">🎮 BattleQuizz</a>
        <button className="logout" onClick={async () => { await supabase.auth.signOut(); router.push('/admin/login'); }}>
          Déconnexion
        </button>
      </nav>
      {children}
    </>
  );
}
