import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ThemeProvider } from '@/lib/theme/theme-context';
import { I18nProvider } from '@/lib/i18n/i18n-context';
import LandingPage from './page';

// framer-motion whileInView needs IntersectionObserver; jsdom lacks it. Stub one that reports "in view" immediately so
// reveal-wrapped sections render at their final state.
beforeAll(() => {
  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) { this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
    root = null; rootMargin = ''; thresholds = [];
  }
  vi.stubGlobal('IntersectionObserver', IO as unknown as typeof IntersectionObserver);
});

function renderPage() {
  return render(<ThemeProvider><I18nProvider><LandingPage /></I18nProvider></ThemeProvider>);
}

const links = (name: string | RegExp) => screen.getAllByRole('link', { name });

describe('Public landing (WEB-LANDING)', () => {
  it('WEB-LANDING-01 hero has a single h1 with the personalization positioning', () => {
    renderPage();
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent).toContain('Izlan keyingi qadamni ko‘rsatadi');
  });

  it('WEB-LANDING-02 primary CTAs route to /register (never fake)', () => {
    renderPage();
    const starts = links('Bepul boshlash');
    expect(starts.length).toBeGreaterThanOrEqual(2); // header + hero + final CTA
    for (const a of starts) expect(a).toHaveAttribute('href', '/register');
  });

  it('WEB-LANDING-03 Kirish routes to /login', () => {
    renderPage();
    const signins = links('Kirish');
    expect(signins.length).toBeGreaterThanOrEqual(2); // header + footer + final CTA
    for (const a of signins) expect(a).toHaveAttribute('href', '/login');
  });

  it('WEB-LANDING-04 "Qanday ishlaydi" points at the #how-it-works section', () => {
    renderPage();
    for (const a of links('Qanday ishlaydi')) expect(a).toHaveAttribute('href', '#how-it-works');
  });

  it('WEB-LANDING-05 Tariflar and "Tariflarni ko‘rish" point at #plans (no /pricing route invented)', () => {
    renderPage();
    for (const a of links('Tariflar')) expect(a).toHaveAttribute('href', '#plans');
    expect(links('Tariflarni ko‘rish')[0]).toHaveAttribute('href', '#plans');
    expect(screen.queryByRole('link', { name: /pricing/i })).toBeNull();
  });

  it('WEB-LANDING-06 the real staff access point is preserved discreetly in the footer', () => {
    renderPage();
    const staff = screen.getByRole('link', { name: 'Metodistlar uchun' });
    expect(staff).toHaveAttribute('href', '/staff/login');
    // it lives in the footer, not the primary header nav
    expect(staff.closest('footer')).toBeTruthy();
  });

  it('WEB-LANDING-07 maturity is honest: future sections labelled Tez orada / Rejada', () => {
    renderPage();
    // Smart Library, Dictionary, Community, Plans → Tez orada; AI chat badge also Tez orada
    expect(screen.getAllByText('Tez orada').length).toBeGreaterThanOrEqual(4);
    // Historical timeline map → Rejada (single planned section)
    expect(screen.getAllByText('Rejada').length).toBeGreaterThanOrEqual(1);
    // implemented sections → Mavjud
    expect(screen.getAllByText('Mavjud').length).toBeGreaterThanOrEqual(1);
  });

  it('WEB-LANDING-08 major narrative regions render', () => {
    renderPage();
    for (const title of [
      'Juda ko‘p material, ammo aniq yo‘nalish yo‘q.', // problem
      'Har kim bir xil joydan boshlamaydi.', // roadmap
      'Xato qilgan mavzu yo‘qolib ketmaydi.', // adaptive review
      'AI yordam beradi. Metodist sifatni nazorat qiladi.', // AI + methodist
      'Kitobni yopganingizda o‘qish to‘xtamaydi.', // smart library
      'Bilmagan narsangizni so‘rang. Bilganingizni tushuntiring.', // community
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  it('WEB-LANDING-09 XP and IZL stay distinct and make no cash-out/trade claim', () => {
    renderPage();
    const note = screen.getByText(/Sotib olish, ayirboshlash yoki pul yechish/); // the XP/IZL clarification note
    expect(note.textContent).toContain('XP');
    expect(note.textContent).toContain('IZL');
    expect(note.textContent).toContain('XP’dan mustaqil'); // explicitly independent
    expect(note.textContent).toMatch(/Sotib olish, ayirboshlash yoki pul yechish imkoniyati yo‘q/); // no buy/trade/cash-out
  });

  it('WEB-LANDING-10 no fabricated prices/ratings on the plans teaser', () => {
    renderPage();
    // conceptual tier names only
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Max')).toBeInTheDocument();
    expect(screen.getByText('Tavsiya etiladi')).toBeInTheDocument(); // Pro recommended
    // no price/currency or star-rating anywhere
    expect(screen.queryByText(/\$\s?\d|\d+\s?(so‘m|som|UZS|USD)|\/\s?(oy|month)|★|⭐/i)).toBeNull();
  });

  it('WEB-LANDING-11 the mobile menu is an accessible disclosure (aria-expanded toggles)', () => {
    renderPage();
    const btn = screen.getByRole('button', { name: 'Menyu' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(btn).toHaveAttribute('aria-controls', 'landing-mobile-menu');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });

  it('WEB-LANDING-12 illustrative product demos are hidden from assistive tech (no sample stats as the visitor’s data)', () => {
    const { container } = renderPage();
    // every sample skill percentage lives only inside an aria-hidden demo card (never presented as the visitor's data)
    for (const pct of screen.getAllByText('68%')) expect(pct.closest('[aria-hidden="true"]')).toBeTruthy();
    // sanity: several demo regions are aria-hidden
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(5);
  });
});
