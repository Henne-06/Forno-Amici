import Link from 'next/link';
import { Flame, ArrowUpRight, Check, Clock } from 'lucide-react';
import { BRAND } from '@/lib/config';
import { amounts, positions, type ToppingInput } from '@/lib/domain';
import type { Order } from '@/lib/types';
export function Header({ baker = false }: { baker?: boolean }) {
  return (
    <header className="site-header">
      <Link className="brand" href="/" aria-label={`${BRAND.name} – Startseite`}>
        <span className="brand-icon">
          <Flame size={25} />
        </span>
        {BRAND.name}
        <span className="brand-dot">.</span>
      </Link>
      <Link className="header-link" href={baker ? '/' : '/baecker'}>
        {baker ? 'Für Gäste' : 'Am Pizzaofen'}
        <ArrowUpRight size={17} />
      </Link>
    </header>
  );
}
export function Footer() {
  return (
    <footer>
      <span>{BRAND.tagline}</span>
      <span>
        FATTO CON AMORE <span className="italian-stripe" aria-hidden="true" />
      </span>
    </footer>
  );
}
export function ErrorBox({ children }: { children: React.ReactNode }) {
  return children ? (
    <div className="error-box" role="alert">
      {children}
    </div>
  ) : null;
}
export function LiveBadge({ connected }: { connected: boolean }) {
  return (
    <span className={`live-badge ${connected ? '' : 'offline'}`} role="status">
      <i />
      {connected ? 'Live verbunden' : 'Verbindung wird geprüft'}
    </span>
  );
}
export function ToppingSummary({ toppings }: { toppings: (ToppingInput & { name: string })[] }) {
  if (!toppings.length) return <p className="muted">Nur Teig – ohne Belag</p>;
  return (
    <div className="topping-summary">
      {(Object.keys(positions) as (keyof typeof positions)[]).map((position) => {
        const items = toppings.filter((t) => t.position === position);
        return (
          items.length > 0 && (
            <div key={position}>
              <h4>{positions[position]}</h4>
              <p>
                {items
                  .map((t) => `${t.name}${t.amount ? ` (${amounts[t.amount]})` : ''}`)
                  .join(' · ')}
              </p>
            </div>
          )
        );
      })}
    </div>
  );
}
export function OrderCard({ order, children }: { order: Order; children?: React.ReactNode }) {
  return (
    <article
      className={`order-card ${order.status === 'DONE' ? 'done' : ''}`}
      data-testid={`order-${order.number}`}
    >
      <div className="order-heading">
        <div>
          <span className="eyebrow">PIZZA</span>
          <strong className="order-number">#{String(order.number).padStart(2, '0')}</strong>
        </div>
        <div className="order-person">
          <h3>{order.guestName}</h3>
          <span className="muted">
            {new Date(order.createdAt).toLocaleTimeString('de-DE', {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            Uhr
          </span>
        </div>
        <span className={`status ${order.status.toLowerCase()}`}>
          {order.status === 'DONE' ? <Check size={15} /> : <Clock size={15} />}{' '}
          {order.status === 'DONE' ? 'Erledigt' : 'Offen'}
        </span>
      </div>
      <ToppingSummary toppings={order.toppings} />
      {children}
    </article>
  );
}
