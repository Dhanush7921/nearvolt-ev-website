import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CONTACT_LINK, MENU, type MenuGroup } from '../config/menu';
import { gsap, ScrollTrigger } from '../lib/gsap';
import { prefersReducedMotion } from '../lib/prefs';
import { Link, useLocation } from '../lib/router';
import { ButtonLink } from './Button';
import { EvPreview } from './EvPreview';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

const ORDER = MENU.map((m) => m.id);
const PAD = 20; // panel padding + row padding, so panel text lines up with its trigger

function Chevron() {
  return (
    <svg className="mm-chev" viewBox="0 0 8 5" width="8" height="5" aria-hidden="true">
      <path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Panel({ group, onPick }: { group: MenuGroup; onPick: () => void }) {
  const [active, setActive] = useState(0);
  if (group.layout === 'preview') {
    return (
      <div className="mm-preview">
        <ul className="mm-list" role="list">
          {group.links.map((l, i) => (
            <li key={l.label}>
              <Link to={l.to} className={`mm-item${i === active ? ' is-active' : ''}`} onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onClick={onPick}>
                <strong>{l.label}</strong>
                <span>{l.text}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mm-media" aria-hidden="true">
          {group.links.map((l, i) => (
            <div key={l.label} className={`mm-media-item${i === active ? ' is-active' : ''}`}>{l.preview && <EvPreview kind={l.preview} />}</div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mm-rows">
      <ul className="mm-list" role="list">
        {group.links.map((l) => (
          <li key={l.label}>
            <Link to={l.to} className="mm-row" onClick={onPick}>
              <span className="mm-ico">
                <Icon name={l.icon} />
              </span>
              <span className="mm-row-text">
                <strong>{l.label}</strong>
                <span>{l.text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {group.footer && (
        <Link to={group.footer.to} className="mm-foot" onClick={onPick}>
          {group.footer.label} <Icon name="arrow-right" />
        </Link>
      )}
    </div>
  );
}

export function Nav() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false); // mobile sheet
  const [openId, setOpenId] = useState<string | null>(null); // desktop dropdown
  const navRef = useRef<HTMLElement>(null);
  const innerRef = useRef<HTMLElement>(null);
  const ddRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const wasOpen = useRef(false);
  const current = useRef<string | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const panelEl = (id: string) => ddRef.current?.querySelector<HTMLElement>(`[data-panel="${id}"]`) ?? null;
  const triggerEl = (id: string) => innerRef.current?.querySelector<HTMLElement>(`[data-menu="${id}"]`) ?? null;

  // Measure the panel and move the shared container to sit under its trigger, clamped inside the bar.
  const place = useCallback((id: string) => {
    const dd = ddRef.current;
    const panel = panelEl(id);
    const trig = triggerEl(id);
    const inner = innerRef.current;
    if (!dd || !panel || !trig || !inner) return;
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const ir = inner.getBoundingClientRect();
    const tr = trig.getBoundingClientRect();
    const minX = 12 - ir.left; // keep 12px from the viewport edges
    const maxX = window.innerWidth - 12 - w - ir.left;
    const x = Math.max(minX, Math.min(tr.left - ir.left - PAD, maxX));
    dd.style.setProperty('--x', `${Math.round(x)}px`);
    dd.style.setProperty('--w', `${w}px`);
    dd.style.setProperty('--h', `${h}px`);
  }, []);

  const close = useCallback((returnFocus = false) => {
    window.clearTimeout(closeTimer.current);
    const dd = ddRef.current;
    const id = current.current;
    if (!dd || !id) return;
    dd.classList.remove('open');
    panelEl(id)?.removeAttribute('data-state');
    current.current = null;
    setOpenId(null);
    if (returnFocus) triggerEl(id)?.focus();
  }, []);

  const openMenu = useCallback(
    (id: string) => {
      window.clearTimeout(closeTimer.current);
      const dd = ddRef.current;
      if (!dd || current.current === id) return;
      const prev = current.current;
      const next = panelEl(id);
      if (!next) return;
      const panels = dd.querySelectorAll<HTMLElement>('.mm-panel');
      if (!prev) {
        // first open: appear in place (no width/height/x animation)
        dd.classList.add('instant', 'snap');
        panels.forEach((p) => {
          p.classList.add('snap');
          p.removeAttribute('data-state');
        });
        place(id);
        void dd.offsetWidth;
        dd.classList.remove('snap');
        panels.forEach((p) => p.classList.remove('snap'));
        dd.classList.add('open');
        requestAnimationFrame(() => dd.classList.remove('instant'));
      } else {
        // switch: old content slides out in the direction of travel, new content slides in, container morphs
        const dir = ORDER.indexOf(id) > ORDER.indexOf(prev) ? 1 : -1;
        panelEl(prev)?.setAttribute('data-state', dir > 0 ? 'exit-left' : 'exit-right');
        next.classList.add('snap');
        next.setAttribute('data-state', dir > 0 ? 'exit-right' : 'exit-left');
        void next.offsetWidth;
        next.classList.remove('snap');
        place(id);
      }
      next.setAttribute('data-state', 'active');
      current.current = id;
      setOpenId(id);
    },
    [place],
  );

  const scheduleClose = useCallback(
    (ms = 140) => {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = window.setTimeout(() => close(), ms);
    },
    [close],
  );

  // global dismissal: Escape, outside pointer, resize
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && current.current) close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (current.current && !innerRef.current?.contains(e.target as Node)) close();
    };
    const onResize = () => current.current && place(current.current);
    window.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(closeTimer.current);
    };
  }, [close, place]);

  useEffect(() => close(), [pathname, close]);

  // compact capsule after the first scroll, hide while scrolling down, return on scroll up (unchanged from V1.1)
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    gsap.set(nav, { yPercent: 0 });
    const st = ScrollTrigger.create({
      start: 0,
      end: 'max',
      onUpdate: (self) => {
        const y = self.scroll();
        nav.classList.toggle('is-compact', y > 40);
        const hide = self.direction === 1 && y > 320 && !current.current;
        gsap.to(nav, { yPercent: hide ? -150 : 0, duration: 0.55, ease: 'power3.out', overwrite: true });
      },
    });
    return () => st.kill();
  }, [pathname]);

  // mobile menu: shutter slats close in, links rise through masks (unchanged motion, grouped content)
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const tl = gsap.timeline({ paused: true });
    tl.set(menu, { visibility: 'visible' })
      .fromTo(menu.querySelectorAll('.slat'), { scaleY: 0 }, { scaleY: 1, duration: 0.55, stagger: 0.05, ease: 'power4.inOut' })
      .fromTo(menu.querySelectorAll('.menu-link-inner'), { yPercent: 120 }, { yPercent: 0, duration: 0.7, stagger: 0.025, ease: 'expo.out' }, '-=0.2')
      .fromTo(menu.querySelector('.menu-foot'), { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: 0.5 }, '-=0.5');
    tlRef.current = tl;
    return () => {
      tl.kill();
    };
  }, []);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    const html = document.documentElement;
    if (open) {
      wasOpen.current = true;
      if (prefersReducedMotion()) tl.progress(1);
      else tl.timeScale(1).play();
      html.classList.add('menu-open');
      requestAnimationFrame(() => menuRef.current?.querySelector('a')?.focus());
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setOpen(false);
          btnRef.current?.focus();
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (prefersReducedMotion()) tl.progress(0);
    else tl.timeScale(1.7).reverse();
    html.classList.remove('menu-open');
  }, [open]);

  useEffect(() => setOpen(false), [pathname]);

  // One group at most is marked current: the group whose overview page this is, else the first group linking to it.
  const activeGroup = pathname === '/' ? null : (MENU.find((g) => g.footer?.to === pathname) ?? MENU.find((g) => g.links.some((l) => !/[#?]/.test(l.to) && l.to === pathname)))?.id;
  const groupActive = (g: MenuGroup) => g.id === activeGroup;

  return (
    <>
      <header className="nav" ref={navRef} data-open={open || undefined} data-mm={openId || undefined}>
        <nav
          className="nav-inner"
          aria-label="Main"
          ref={innerRef}
          onPointerLeave={(e) => e.pointerType === 'mouse' && scheduleClose()}
          onPointerEnter={() => window.clearTimeout(closeTimer.current)}
          onBlur={(e) => {
            if (!innerRef.current?.contains(e.relatedTarget as Node)) scheduleClose(0);
          }}
        >
          <Link to="/" className="nav-logo" aria-label="NEARVOLT EV home">
            <Logo decorative />
          </Link>
          <ul className="mm-links" role="list">
            {MENU.map((g) => (
              <li key={g.id}>
                <button
                  type="button"
                  className="mm-trigger"
                  data-menu={g.id}
                  data-current={groupActive(g) || undefined}
                  aria-expanded={openId === g.id}
                  aria-controls={`mm-${g.id}`}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && openMenu(g.id)}
                  onClick={() => (current.current === g.id ? close() : openMenu(g.id))}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      openMenu(g.id);
                      requestAnimationFrame(() => panelEl(g.id)?.querySelector<HTMLElement>('a')?.focus());
                    }
                  }}
                >
                  {g.label}
                  <Chevron />
                </button>
              </li>
            ))}
            <li>
              <Link to={CONTACT_LINK.to} className="mm-trigger mm-plain" aria-current={pathname === '/contact' ? 'page' : undefined} onPointerEnter={(e) => e.pointerType === 'mouse' && scheduleClose(60)}>
                {CONTACT_LINK.label}
              </Link>
            </li>
          </ul>
          <div className="mm-dd" ref={ddRef}>
            {MENU.map((g) => (
              <div className="mm-panel" data-panel={g.id} id={`mm-${g.id}`} key={g.id} role="region" aria-label={g.label} inert={openId !== g.id ? true : undefined}>
                <Panel group={g} onPick={() => close()} />
              </div>
            ))}
          </div>
          <div className="nav-actions">
            <ThemeToggle />
            <Link to="/sign-in" className="nav-signin" aria-current={pathname === '/sign-in' ? 'page' : undefined}>
              Sign in
            </Link>
            <ButtonLink to="/#download" size="sm" className="nav-cta" icon="smartphone">
              Get the App
            </ButtonLink>
            <button ref={btnRef} type="button" className="menu-btn" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen((o) => !o)}>
              <span />
              <span />
            </button>
          </div>
        </nav>
      </header>
      <div className="mobile-menu" id="mobile-menu" ref={menuRef} aria-hidden={!open} inert={!open ? true : undefined}>
        <div className="slats" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span className="slat" key={i} />
          ))}
        </div>
        <div className="menu-sheet">
          <Link to="/" className="menu-home" onClick={() => setOpen(false)} aria-current={pathname === '/' ? 'page' : undefined}>
            <span className="menu-link-inner">Home</span>
          </Link>
          {MENU.map((g) => (
            <section className="menu-group" key={g.id} aria-label={g.label}>
              <h3>
                <span className="menu-link-inner">{g.label}</span>
              </h3>
              <ul role="list">
                {g.links.map((l) => (
                  <li key={l.label}>
                    <Link to={l.to} onClick={() => setOpen(false)}>
                      <span className="menu-link-inner">
                        <Icon name={l.icon} /> {l.label}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <section className="menu-group" aria-label="Contact and account">
            <h3>
              <span className="menu-link-inner">Support</span>
            </h3>
            <ul role="list">
              <li>
                <Link to="/contact" onClick={() => setOpen(false)}>
                  <span className="menu-link-inner">
                    <Icon name="send" /> Contact
                  </span>
                </Link>
              </li>
              <li>
                <Link to="/sign-in" onClick={() => setOpen(false)}>
                  <span className="menu-link-inner">
                    <Icon name="user-check" /> Sign in
                  </span>
                </Link>
              </li>
            </ul>
          </section>
        </div>
        <div className="menu-foot">
          <ButtonLink to="/#download" icon="arrow-right">
            Get the App
          </ButtonLink>
        </div>
      </div>
    </>
  );
}
