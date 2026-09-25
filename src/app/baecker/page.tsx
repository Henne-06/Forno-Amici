'use client';
import { useEffect, useState } from 'react';
import { Check, ChevronLeft, Copy, Flame, LogOut, Plus, RotateCcw, Settings2 } from 'lucide-react';
import { ErrorBox, Footer, Header, LiveBadge, OrderCard } from '@/components/shared';
import { api, errorText, useLive } from '@/lib/client';
import type { Party } from '@/lib/types';
export default function BakerPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function loadParties() {
    try {
      setParties(await api<Party[]>('parties'));
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    void api<{ role: string }>('session?role=baker')
      .then(async (s) => {
        setAuthenticated(s.role === 'baker');
        if (s.role === 'baker') await loadParties();
      })
      .catch((e) => {
        setError(errorText(e));
        setAuthenticated(false);
      });
  }, []);
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      await api('login', { password: form.get('password') });
      setAuthenticated(true);
      await loadParties();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const party = await api<Party>('parties', { name: form.get('name') });
      setSelected(party.id);
      await loadParties();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="page-shell">
      <Header baker />
      {authenticated === null ? (
        <main className="content">Der Ofen wird vorbereitet …</main>
      ) : !authenticated ? (
        <main className="auth-content">
          <section className="join-card">
            <div className="card-ornament">
              <Flame size={28} />
              <span>DIETRO IL FORNO</span>
            </div>
            <h1>Dein Platz am Ofen.</h1>
            <p className="muted">Melde dich an, um deine Pizza-Party zu verwalten.</p>
            <form onSubmit={login}>
              <label htmlFor="password">Bäckerpasswort</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
              <ErrorBox>{error}</ErrorBox>
              <button className="button primary full" disabled={busy}>
                {busy ? 'Wird angemeldet …' : 'Ofen öffnen'}
              </button>
            </form>
          </section>
        </main>
      ) : selected ? (
        <BakerParty
          key={selected}
          id={selected}
          back={() => {
            setSelected(null);
            void loadParties();
          }}
        />
      ) : (
        <main className="content">
          <div className="page-title">
            <div>
              <span className="eyebrow accent">AM PIZZAOFEN</span>
              <h1>Zusammen schmeckt’s besser.</h1>
            </div>
            <button
              className="button subtle"
              onClick={async () => {
                try {
                  await api('logout', { role: 'baker' });
                  setAuthenticated(false);
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              <LogOut size={18} />
              Abmelden
            </button>
          </div>
          <ErrorBox>{error}</ErrorBox>
          <div className="party-dashboard">
            <section className="panel">
              <span className="eyebrow accent">EIN NEUER ABEND</span>
              <h2>Lad deine Runde ein.</h2>
              <p className="muted">Eine Party erstellen, Zutaten auswählen und losbacken.</p>
              <form onSubmit={create}>
                <label htmlFor="party-name">
                  Partyname <span className="muted">(optional)</span>
                </label>
                <input id="party-name" name="name" placeholder="Freitag bei Max" maxLength={60} />
                <button className="button primary full" disabled={busy}>
                  <Plus size={19} />
                  {busy ? 'Wird erstellt …' : 'Party erstellen'}
                </button>
              </form>
            </section>
            <section>
              <h2>Deine Partys</h2>
              {parties.length === 0 ? (
                <div className="empty-state">
                  <Flame size={32} />
                  <p>
                    Noch ist es ruhig am Ofen.
                    <br />
                    Starte deine erste Party.
                  </p>
                </div>
              ) : (
                <div className="party-list">
                  {parties.map((p) => (
                    <button
                      key={p.id}
                      className="party-list-item"
                      onClick={() => setSelected(p.id)}
                    >
                      <span>
                        <strong>{p.name}</strong>
                        <small>{p.code}</small>
                      </span>
                      <span className={`status ${p.active ? 'open' : 'done'}`}>
                        {p.active ? 'Aktiv' : 'Beendet'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </div>
        </main>
      )}
      <Footer />
    </div>
  );
}
function BakerParty({ id, back }: { id: string; back: () => void }) {
  const { data, error: liveError, connected, refresh } = useLive('parties/' + id, id);
  const [tab, setTab] = useState<'orders' | 'ingredients'>('orders');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string[]>([]);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [copied, setCopied] = useState(false);
  async function action(key: string, path: string, input: unknown) {
    if (busy.includes(key)) return;
    setBusy((list) => [...list, key]);
    setError('');
    try {
      await api(`parties/${id}/${path}`, input);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy((list) => list.filter((k) => k !== key));
    }
  }
  if (!data)
    return (
      <main className="content">
        <button className="button subtle" onClick={back}>
          <ChevronLeft size={18} />
          Alle Partys
        </button>
        <p>Bestellungen werden geladen …</p>
        <ErrorBox>{liveError}</ErrorBox>
      </main>
    );
  const open = data.orders.filter((o) => o.status === 'OPEN');
  const done = data.orders.filter((o) => o.status === 'DONE');
  return (
    <main className="content baker-content">
      <div className="context-line">
        <button className="text-button" onClick={back}>
          <ChevronLeft size={16} />
          Alle Partys
        </button>
        <LiveBadge connected={connected} />
      </div>
      <div className="party-banner">
        <div>
          <span className="eyebrow">DEIN ABEND AM OFEN</span>
          <h1>{data.party.name}</h1>
          <span className="party-active">
            <i />
            {data.party.active ? 'Der Ofen ist an · Party aktiv' : 'Party beendet'}
          </span>
        </div>
        <div className="group-code">
          <span>DER CODE FÜR DEINE GÄSTE</span>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(data.party.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 2500);
              } catch {
                setError('Kopieren nicht möglich. Du kannst den angezeigten Code ablesen.');
              }
            }}
            aria-label="Gruppencode kopieren"
          >
            <strong data-testid="party-code">{data.party.code}</strong>
            {copied ? <Check size={21} /> : <Copy size={20} />}
          </button>
          <small>{copied ? 'Code kopiert!' : 'Website öffnen, Code eingeben, mitessen.'}</small>
        </div>
      </div>
      <div className="tab-bar">
        <button aria-pressed={tab === 'orders'} onClick={() => setTab('orders')}>
          Am Ofen <span>{open.length}</span>
        </button>
        <button aria-pressed={tab === 'ingredients'} onClick={() => setTab('ingredients')}>
          <Settings2 size={17} />
          Zutaten verwalten
        </button>
      </div>
      <ErrorBox>{error || liveError}</ErrorBox>
      {tab === 'orders' ? (
        <section>
          <div className="section-heading">
            <div>
              <h2>Eine nach der anderen.</h2>
              <p className="muted">Die älteste Bestellung steht zuerst. Bereit, wenn du es bist.</p>
            </div>
            <span className="count-label">{open.length} offen</span>
          </div>
          {open.length === 0 ? (
            <div className="empty-state">
              <Flame size={42} />
              <h2>Alles im grünen Bereich.</h2>
              <p>Neue Bestellungen erscheinen hier automatisch.</p>
            </div>
          ) : (
            <div className="order-grid baker-orders">
              {open.map((o) => (
                <OrderCard key={o.id} order={o}>
                  <button
                    className="button primary full finish-button"
                    disabled={busy.includes(o.id)}
                    onClick={() => action(o.id, `orders/${o.id}`, { status: 'DONE' })}
                  >
                    <Check size={23} />
                    {busy.includes(o.id) ? 'Wird aktualisiert …' : 'Fertig'}
                  </button>
                </OrderCard>
              ))}
            </div>
          )}
          <details className="completed-orders">
            <summary>
              Erledigt <span>{done.length}</span>
            </summary>
            <div className="order-grid">
              {[...done].reverse().map((o) => (
                <OrderCard key={o.id} order={o}>
                  <button
                    className="button secondary full"
                    disabled={busy.includes(o.id)}
                    onClick={() => action(o.id, `orders/${o.id}`, { status: 'OPEN' })}
                  >
                    <RotateCcw size={17} />
                    Wieder öffnen
                  </button>
                </OrderCard>
              ))}
            </div>
          </details>
        </section>
      ) : (
        <section>
          <div className="section-heading">
            <div>
              <h2>Was ist heute da?</h2>
              <p className="muted">
                Änderungen sind sofort bei deinen Gästen sichtbar. Bestellte Pizzen bleiben
                unverändert.
              </p>
            </div>
          </div>
          <div className="availability-grid">
            {[...new Set(data.ingredients.map((i) => i.category))].map((category) => (
              <section className="panel" key={category}>
                <h3>{category}</h3>
                {data.ingredients
                  .filter((i) => i.category === category)
                  .map((i) => (
                    <label className="availability-row" key={i.id}>
                      <span>{i.name}</span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={i.available}
                        disabled={!data.party.active || busy.includes(i.id)}
                        onChange={(e) =>
                          action(i.id, `ingredients/${i.id}`, { available: e.target.checked })
                        }
                      />
                    </label>
                  ))}
              </section>
            ))}
          </div>
        </section>
      )}
      <div className="end-party">
        {data.party.active &&
          (confirmEnd ? (
            <div className="notice">
              <p>
                Party beenden? Danach können keine neuen Pizzen bestellt werden. Offene Bestellungen
                kannst du weiter bearbeiten.
              </p>
              <div className="button-row">
                <button
                  className="button danger"
                  disabled={busy.includes('end')}
                  onClick={() => action('end', 'end', {})}
                >
                  Jetzt beenden
                </button>
                <button className="button secondary" onClick={() => setConfirmEnd(false)}>
                  Weiterbacken
                </button>
              </div>
            </div>
          ) : (
            <button className="text-button" onClick={() => setConfirmEnd(true)}>
              Party beenden
            </button>
          ))}
      </div>
    </main>
  );
}
