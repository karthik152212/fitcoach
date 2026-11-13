import { useEffect, useRef } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useSession } from "../session/SessionContext";

/**
 * Product shell: quiet frame, bottom navigation on mobile, side rail on
 * desktop. Navigation reflects the actual product flow — Home, Train,
 * Progress, You — not a copied five-tab fitness app.
 */

const NAV_ITEMS: readonly { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: "/", label: "Home", icon: "home", end: true },
  { to: "/train", label: "Train", icon: "train" },
  { to: "/nutrition", label: "Nutrition", icon: "nutrition" },
  { to: "/progress", label: "Progress", icon: "progress" },
  { to: "/you", label: "You", icon: "you" },
  { to: "/coach", label: "Coach", icon: "coach" },
];

function NavGlyph({ icon }: { icon: string }) {
  switch (icon) {
    case "home":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M4 11.5 12 5l8 6.5V20h-5.2v-5H9.2v5H4v-8.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    case "train":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M7 7.5v9M17 7.5v9M4 10v4M20 10v4M7 12h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "nutrition":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="currentColor" />
        </svg>
      );
    case "progress":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M4 19h16M6 16l4-6 3.5 3L18 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "coach":
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M20 16a4 4 0 0 1-4 4h0a4 4 0 0 1-4-4h0a4 4 0 0 1 4-4h0a4 4 0 0 1 4 4Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M5 19.5c1.2-3 3.9-4.5 7-4.5s5.8 1.5 7 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
  }
}

export function AppShell() {
  const { userId } = useSession();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  // Single-page navigation replaces the document without moving focus; a
  // keyboard or screen-reader user would otherwise stay on the old control.
  //
  // Compared against the pathname focus was last moved for, not a "first run"
  // flag: StrictMode double-invokes effects in development, and a flag would
  // be spent on the first invocation — stealing focus into `main` on load and
  // skipping the skip link for the first Tab.
  const focusedPathname = useRef(pathname);
  useEffect(() => {
    if (focusedPathname.current === pathname) return;
    focusedPathname.current = pathname;
    mainRef.current?.focus({ preventScroll: true });
  }, [pathname]);

  // Exercise detail and performance are part of training, not new sections:
  // the Train tab stays lit while the user is inside a workout.
  const inTraining = pathname.startsWith("/exercise");

  return (
    <div className="fc-shell">
      {/* Keyboard users should be able to jump the four-item rail/bottom bar. */}
      <a className="fc-skip" href="#main">
        Skip to content
      </a>
      <div className="fc-shell__frame">
        <main className="fc-shell__main" id="main" ref={mainRef} tabIndex={-1}>
          <Outlet />
        </main>
      </div>
      {userId ? (
        <nav className="fc-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `fc-nav__item${isActive || (inTraining && item.to === "/train") ? " is-active" : ""}`
              }
            >
              <NavGlyph icon={item.icon} />
              <span className="fc-nav__label">{item.label}</span>
            </NavLink>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
