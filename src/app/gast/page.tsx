'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Bell, Check, Plus, LogOut, Flame } from 'lucide-react';
import {
  ErrorBox,
  Footer,
  Header,
  LiveBadge,
  OrderCard,
  ToppingSummary,
} from '@/components/shared';
import { api, ApiError, errorText, useLive } from '@/lib/client';
import { amounts, positions, orderSchema, type ToppingInput } from '@/lib/domain';
import type { Ingredient } from '@/lib/types';
type Guest = { id: string; name: string; partyId: string };
type Pending = { idempotencyKey: string; toppings: ToppingInput[] };
export default function GuestPage() {
  const router = useRouter();
  const [guest, setGuest] = useState<Guest | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    void api<{ role: string; guest: Guest }>('session')
      .then((s) => {
        if (s.role !== 'guest') router.replace('/');
        else setGuest(s.guest);
      })
      .catch((e) => setError(errorText(e)));
  }, [router]);
  return (
    <div className="page-shell">
      <Header />
      {guest ? (
        <GuestApp guest={guest} />
      ) : (
        <main className="content">
          <p>Deine Party wird geladen …</p>
          <ErrorBox>{error}</ErrorBox>
          {error && <Link href="/">Zur Startseite</Link>}
        </main>
      )}
      <Footer />
    </div>
  );
}
function GuestApp({ guest }: { guest: Guest }) {
  const router = useRouter();
  const { data, error: liveError, connected, refresh } = useLive('guest');
  const [view, setView] = useState<'configure' | 'review' | 'orders'>('configure');
  const [selected, setSelected] = useState<ToppingInput[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [notice, setNotice] = useState<string[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const previous = useRef<Map<string, string> | null>(null);
  const sending = useRef(false);
  const storageKey = 'forno-order-' + guest.id;
  useEffect(() => {
    // Hydrate a persisted network request after mounting; browser storage is unavailable during SSR.
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = orderSchema.parse(JSON.parse(saved));
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPending(parsed);
        setSelected(parsed.toppings);
        setView('review');
      }
    } catch {
      setError(
        'Lokaler Speicher ist nicht verfügbar. Lass diese Seite bis zur Bestellbestätigung geöffnet.',
      );
    }
    setStorageReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!data) return;
    const done = data.orders.filter(
      (o) => o.status === 'DONE' && previous.current?.get(o.id) === 'OPEN',
    );
    if (done.length) {
      setNotice(done.map((o) => o.id));
      if (notifications) {
        try {
          if (audio.current?.state === 'running') {
            const oscillator = audio.current.createOscillator();
            const gain = audio.current.createGain();
            oscillator.connect(gain);
            gain.connect(audio.current.destination);
            oscillator.frequency.value = 660;
            gain.gain.setValueAtTime(0.12, audio.current.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, audio.current.currentTime + 0.6);
            oscillator.start();
            oscillator.stop(audio.current.currentTime + 0.6);
          }
        } catch {}
        try {
          if ('Notification' in window && Notification.permission === 'granted')
            new Notification('Deine Pizza ist fertig!', {
              body: 'Hol sie am Ofen ab. Buon appetito!',
              tag: done[0].id,
            });
        } catch {}
      }
    }
    previous.current = new Map(data.orders.map((o) => [o.id, o.status]));
  }, [data, notifications]);
  async function enableNotifications() {
    setNotifications(true);
    try {
      audio.current ??= new AudioContext();
      await audio.current.resume();
    } catch {}
    try {
      if ('Notification' in window && Notification.permission === 'default')
        await Notification.requestPermission();
    } catch {}
  }
  function toggle(item: Ingredient) {
    setSelected((list) =>
      list.some((t) => t.ingredientId === item.id)
        ? list.filter((t) => t.ingredientId !== item.id)
        : [
            ...list,
            { ingredientId: item.id, position: 'WHOLE', amount: item.hasAmount ? 'MEDIUM' : null },
          ],
    );
  }
  function update(id: string, changes: Partial<ToppingInput>) {
    setSelected((list) => list.map((t) => (t.ingredientId === id ? { ...t, ...changes } : t)));
  }
  async function submit() {
    if (sending.current || !storageReady) return;
    sending.current = true;
    setBusy(true);
    setError('');
    const request = pending ?? { idempotencyKey: crypto.randomUUID(), toppings: selected };
    setPending(request);
    try {
      localStorage.setItem(storageKey, JSON.stringify(request));
    } catch {}
    try {
      await api('orders', request);
      setPending(null);
      setSelected([]);
      setView('orders');
      try {
        localStorage.removeItem(storageKey);
      } catch {}
      await refresh();
    } catch (e) {
      setError(errorText(e));
      if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429) {
        setPending(null);
        try {
          localStorage.removeItem(storageKey);
        } catch {}
        await refresh();
      }
    } finally {
      setBusy(false);
      sending.current = false;
    }
  }
  if (!data)
    return (
      <main className="content">
        <p>Der Tisch wird gedeckt …</p>
        <ErrorBox>{liveError}</ErrorBox>
      </main>
    );
  const readyOrders = data.orders.filter((o) => notice.includes(o.id) && o.status === 'DONE');
  const invalid = selected.filter(
    (t) => !data.ingredients.find((i) => i.id === t.ingredientId)?.available,
  );
  const summary = selected.map((t) => ({
    ...t,
    name: data.ingredients.find((i) => i.id === t.ingredientId)?.name ?? 'Nicht mehr verfügbar',
  }));
  return (
    <main className="content guest-content">
      <div className="context-line">
        <span>{data.party.name}</span>
        <LiveBadge connected={connected} />
      </div>
      <div className="page-title">
        <div>
          <span className="eyebrow accent">CIAO, {guest.name.toUpperCase()}</span>
          <h1>Deine Pizza. Dein Geschmack.</h1>
        </div>
        <button
          className="icon-button"
          aria-label="Party verlassen"
          onClick={async () => {
            try {
              await api('logout', {});
              router.push('/');
            } catch (e) {
              setError(errorText(e));
            }
          }}
        >
          <LogOut size={20} />
        </button>
      </div>
      <div className="tab-bar">
        <button
          aria-pressed={view !== 'orders'}
          onClick={() => setView(pending ? 'review' : 'configure')}
        >
          Pizza zusammenstellen
        </button>
        <button aria-pressed={view === 'orders'} onClick={() => setView('orders')}>
          Meine Pizzen <span>{data.orders.length}</span>
        </button>
      </div>
      <ErrorBox>{error || liveError}</ErrorBox>
      {!data.party.active && (
        <div className="notice">
          Der Ofen macht Pause. Die Party ist beendet – deine Bestellungen bleiben hier sichtbar.
        </div>
      )}
      {readyOrders.length > 0 && (
        <div className="ready-banner" role="status">
          <Check size={28} />
          <strong>
            Pizza #{readyOrders.map((o) => String(o.number).padStart(2, '0')).join(', #')} ist
            fertig. Buon appetito!
          </strong>
          <button
            className="icon-button"
            aria-label="Fertig-Hinweis schließen"
            onClick={() => setNotice([])}
          >
            ×
          </button>
        </div>
      )}
      {view === 'orders' ? (
        <section>
          <div className="section-heading">
            <h2>Deine Bestellungen</h2>
            <button className="button subtle" onClick={enableNotifications}>
              <Bell size={17} />
              {notifications ? 'Hinweise aktiviert' : 'Ton & Hinweise aktivieren'}
            </button>
          </div>
          <p className="muted small">
            Der Status aktualisiert sich automatisch. Ton und Systemhinweise funktionieren, soweit
            dein Browser sie erlaubt.
          </p>
          {data.orders.length === 0 ? (
            <div className="empty-state">
              <Flame size={38} />
              <h2>Deine erste Pizza wartet auf dich.</h2>
              <p>Such dir aus, was draufkommt.</p>
            </div>
          ) : (
            <div className="order-grid" aria-live="polite">
              {[...data.orders].reverse().map((order) => (
                <OrderCard key={order.id} order={order}>
                  {order.status === 'DONE' && (
                    <p className="ready-text">Pizza ist fertig – ab zum Ofen!</p>
                  )}
                </OrderCard>
              ))}
            </div>
          )}
          {data.party.active && (
            <button
              className="button primary"
              onClick={() => setView(pending ? 'review' : 'configure')}
            >
              <Plus size={20} />
              Noch eine Pizza bestellen
            </button>
          )}
        </section>
      ) : view === 'review' ? (
        <section className="review-card">
          <span className="eyebrow accent">NOCH EIN KLEINER CHECK</span>
          <h2>Genau so soll sie sein?</h2>
          <ToppingSummary toppings={summary} />
          {invalid.length > 0 && (
            <ErrorBox>Einige Beläge sind inzwischen aus. Bitte passe deine Auswahl an.</ErrorBox>
          )}
          {pending && (
            <div className="notice">
              Die Bestätigung steht noch aus. Mit „Bestellung prüfen“ sendest du dieselbe Anfrage
              sicher erneut – es entsteht keine zweite Pizza.
            </div>
          )}
          <div className="review-actions">
            <button
              className="button secondary"
              disabled={busy || !!pending}
              onClick={() => setView('configure')}
            >
              <ArrowLeft size={18} />
              Auswahl ändern
            </button>
            <button
              className="button primary"
              disabled={
                busy || !storageReady || (!pending && (!data.party.active || invalid.length > 0))
              }
              onClick={submit}
            >
              {busy ? 'Wird bestätigt …' : pending ? 'Bestellung prüfen' : 'Pizza bestellen'}
              <ArrowRight size={18} />
            </button>
          </div>
        </section>
      ) : (
        <>
          <div className="section-heading">
            <div>
              <h2>Was darf drauf?</h2>
              <p className="muted">Wähle deine Beläge. Ganze Pizza oder lieber halb und halb?</p>
            </div>
            <span className="step-label">01 / 02</span>
          </div>
          {invalid.length > 0 && (
            <div className="error-box" role="alert">
              Ein Belag ist inzwischen aus.{' '}
              <button
                className="text-button"
                onClick={() => setSelected((list) => list.filter((t) => !invalid.includes(t)))}
              >
                Nicht verfügbare Beläge entfernen
              </button>
            </div>
          )}
          <div className="ingredient-categories">
            {[...new Set(data.ingredients.map((i) => i.category))].map((category, index) => (
              <section className="category" key={category}>
                <h3>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  {category}
                </h3>
                <div className="ingredient-grid">
                  {data.ingredients
                    .filter((i) => i.category === category)
                    .map((item) => {
                      const value = selected.find((t) => t.ingredientId === item.id);
                      return (
                        <div
                          key={item.id}
                          className={`ingredient ${value ? 'selected' : ''} ${!item.available ? 'unavailable' : ''}`}
                        >
                          <button
                            className="ingredient-toggle"
                            aria-pressed={!!value}
                            disabled={!data.party.active || (!item.available && !value)}
                            onClick={() => toggle(item)}
                          >
                            <span>
                              {item.name}
                              {!item.available && <small>Heute aus</small>}
                            </span>
                            <span className="selection-box">
                              {value ? <Check size={17} /> : <Plus size={17} />}
                            </span>
                          </button>
                          {value && (
                            <div className="ingredient-options">
                              <div
                                className="segments"
                                role="group"
                                aria-label={`Position für ${item.name}`}
                              >
                                {(Object.keys(positions) as (keyof typeof positions)[]).map((p) => (
                                  <button
                                    key={p}
                                    aria-pressed={value.position === p}
                                    onClick={() => update(item.id, { position: p })}
                                  >
                                    {p === 'WHOLE' ? 'Ganz' : p === 'LEFT' ? 'Links ½' : 'Rechts ½'}
                                  </button>
                                ))}
                              </div>
                              {item.hasAmount && (
                                <div className="amount-row">
                                  <span>Menge</span>
                                  <div
                                    className="segments"
                                    role="group"
                                    aria-label={`Menge für ${item.name}`}
                                  >
                                    {(Object.keys(amounts) as (keyof typeof amounts)[]).map((a) => (
                                      <button
                                        key={a}
                                        aria-pressed={value.amount === a}
                                        onClick={() => update(item.id, { amount: a })}
                                      >
                                        {amounts[a]}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </section>
            ))}
          </div>
          <div className="sticky-checkout">
            <div>
              <strong>Eine Pizza, ganz deine.</strong>
              <span>
                {selected.length} {selected.length === 1 ? 'Zutat' : 'Zutaten'} ausgewählt
              </span>
            </div>
            <button
              className="button primary"
              disabled={!data.party.active || invalid.length > 0}
              onClick={() => {
                setError('');
                setView('review');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              Pizza prüfen
              <ArrowRight size={18} />
            </button>
          </div>
        </>
      )}
    </main>
  );
}
