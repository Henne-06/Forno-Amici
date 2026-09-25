'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="content" style={{ padding: 40 }}>
      <h1>Kurze Pause am Ofen.</h1>
      <p>Die Seite konnte nicht geladen werden. Bitte versuche es noch einmal.</p>
      <button className="button primary" onClick={reset}>
        Erneut versuchen
      </button>
    </main>
  );
}
