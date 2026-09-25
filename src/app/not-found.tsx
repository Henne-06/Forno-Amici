import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="content" style={{ padding: 40 }}>
      <h1>Hier steht noch keine Pizza.</h1>
      <p>Diese Seite gibt es nicht.</p>
      <Link className="button primary" href="/">
        Zur Startseite
      </Link>
    </main>
  );
}
