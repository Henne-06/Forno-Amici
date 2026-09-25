'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Leaf, Users, Flame } from 'lucide-react';
import { Header, Footer, ErrorBox } from '@/components/shared';
import { api, errorText } from '@/lib/client';
export default function Home() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState(false);
  useEffect(() => {
    void api<{ role: string | null }>('session')
      .then((s) => setResume(s.role === 'guest'))
      .catch(() => {});
  }, []);
  async function join(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await api('join', { code: values.get('code'), name: values.get('name') });
      router.push('/gast');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-shell">
      <Header />
      <main className="landing">
        <section className="landing-copy">
          <span className="eyebrow accent">
            <span className="tiny-line" /> BENVENUTI A TAVOLA
          </span>
          <h1>
            Ein guter Abend
            <br />
            beginnt mit
            <br />
            <em>deiner Pizza.</em>
          </h1>
          <p className="intro">
            Der Ofen ist an, die Freunde sind da.
            <br />
            Jetzt fehlt nur noch deine Lieblingskombination.
          </p>
          <div className="landing-features">
            <span>
              <Leaf size={19} /> Ganz nach deinem Geschmack
            </span>
            <span>
              <Users size={19} /> Für deine Runde
            </span>
          </div>
          <div className="editorial-note">
            <span className="note-star">✳</span>
            <p>
              Eine Pizza. Tausend Möglichkeiten.
              <br />
              <strong>Und immer ein Platz für dich.</strong>
            </p>
          </div>
        </section>
        <section className="join-card">
          <div className="card-ornament">
            <Flame size={29} />
            <span>LA TUA PIZZA TI ASPETTA</span>
          </div>
          <h2>Du bist eingeladen.</h2>
          <p className="muted">Komm zur Party und stell deine Pizza zusammen.</p>
          <form onSubmit={join}>
            <label htmlFor="code">Dein Gruppencode</label>
            <input
              id="code"
              name="code"
              placeholder="FORNO-ABC234"
              required
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="code-input"
            />
            <small>Den Code bekommst du von der Person am Ofen.</small>
            <label htmlFor="name">Wie heißt du?</label>
            <input
              id="name"
              name="name"
              placeholder="Dein Vorname"
              required
              maxLength={40}
              autoComplete="given-name"
            />
            <ErrorBox>{error}</ErrorBox>
            <button className="button primary full" disabled={busy}>
              {busy ? 'Du kommst gleich rein …' : 'Ab zur Pizza-Party'}
              <ArrowRight size={19} />
            </button>
          </form>
          {resume && (
            <button className="button subtle full" onClick={() => router.push('/gast')}>
              Zurück zu deiner Party <ArrowRight size={17} />
            </button>
          )}
          <div className="join-bottom">
            <span className="small-dot" /> Kein Konto. Nur gute Pizza.
          </div>
        </section>
      </main>
      <section className="how-it-works" aria-label="So funktioniert es">
        <div>
          <span>01</span>
          <p>
            <strong>Komm dazu.</strong> Code eingeben & Platz nehmen.
          </p>
        </div>
        <div>
          <span>02</span>
          <p>
            <strong>Mach sie zu deiner.</strong> Beläge nach deinem Geschmack.
          </p>
        </div>
        <div>
          <span>03</span>
          <p>
            <strong>Genieß den Abend.</strong> Wir sagen Bescheid, wenn sie fertig ist.
          </p>
        </div>
      </section>
      <Footer />
    </div>
  );
}
