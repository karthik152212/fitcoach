import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

/**
 * FitCoach controls. All interactive surfaces use the semantic tokens.
 */

// ── Button ────────────────────────────────────────────────────────────────

export function Button({
  variant = "primary",
  size = "base",
  full = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet" | "danger" | "outline" | "ghost";
  size?: "base" | "large" | "sm";
  full?: boolean;
}) {
  const className = [
    "fc-button",
    `fc-button--${variant}`,
    size === "large" ? "fc-button--large" : size === "sm" ? "fc-button--sm" : "",
    full ? "fc-button--full" : "",
    rest.disabled ? "is-disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return <button {...rest} className={className}>{children}</button>;
}

// ── Chip ──────────────────────────────────────────────────────────────────

export function Chip({
  tone = "neutral",
  children,
  onClick,
  size = "base",
}: {
  tone?: "neutral" | "accent" | "success" | "warning" | "important" | "error";
  children: ReactNode;
  onClick?: () => void;
  size?: "base" | "sm";
}) {
  const className = [
    "fc-chip",
    `fc-chip--${tone}`,
    size === "sm" ? "fc-chip--sm" : "",
    onClick ? "fc-chip--clickable" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={className} onClick={onClick} role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined}>
      {children}
    </span>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

export function Card({
  variant = "elevated",
  children,
  ...rest
}: {
  variant?: "elevated" | "outline" | "subtle";
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  const className = ["fc-card", `fc-card--${variant}`, rest.className].filter(Boolean).join(" ");
  return <div {...rest} className={className}>{children}</div>;
}

// ── Input ─────────────────────────────────────────────────────────────────

export function Input({
  label,
  type = "text",
  multiline = false,
  rows = 3,
  leftIcon,
  rightIcon,
  style,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> &
  TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: string;
    leftIcon?: ReactNode;
    rightIcon?: ReactNode;
    multiline?: boolean;
    rows?: number;
  }) {
  const inputId = `fc-input-${Math.random().toString(36).slice(2, 9)}`;

  if (multiline) {
    return (
      <div className="fc-field" style={style}>
        {label && <label htmlFor={inputId} className="fc-field__label">{label}</label>}
        <div className="fc-field__input-wrapper">
          {leftIcon && <span className="fc-field__icon fc-field__icon--left">{leftIcon}</span>}
          <textarea
            id={inputId}
            className={`fc-input fc-input--multiline${className ? ` ${className}` : ""}`}
            rows={rows}
            {...rest}
          />
          {rightIcon && <span className="fc-field__icon fc-field__icon--right">{rightIcon}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="fc-field" style={style}>
      {label && <label htmlFor={inputId} className="fc-field__label">{label}</label>}
      <div className="fc-field__input-wrapper">
        {leftIcon && <span className="fc-field__icon fc-field__icon--left">{leftIcon}</span>}
        <input
          id={inputId}
          type={type}
          className={`fc-input${className ? ` ${className}` : ""}`}
          {...rest}
        />
        {rightIcon && <span className="fc-field__icon fc-field__icon--right">{rightIcon}</span>}
      </div>
    </div>
  );
}

// ── Select ────────────────────────────────────────────────────────────────

export function Select({
  label,
  options,
  className,
  style,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & {
  label?: string;
  options: Array<{ value: string; label: string }>;
}) {
  const selectId = `fc-select-${Math.random().toString(36).slice(2, 9)}`;

  return (
    <div className="fc-field" style={style}>
      {label && <label htmlFor={selectId} className="fc-field__label">{label}</label>}
      <div className="fc-field__input-wrapper">
        <select id={selectId} className={`fc-select${className ? ` ${className}` : ""}`} {...rest}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Text ──────────────────────────────────────────────────────────────────

export function Text({
  variant = "body",
  tone = "default",
  children,
  style,
  className,
  ...rest
}: {
  variant?: "heading" | "subtitle" | "body" | "caption" | "overline";
  tone?: "default" | "muted" | "success" | "warning" | "error" | "primary";
  children: ReactNode;
  style?: React.CSSProperties;
  className?: string;
} & React.HTMLAttributes<HTMLSpanElement>) {
  const classNameList = [
    "fc-text",
    `fc-text--${variant}`,
    tone !== "default" ? `fc-text--${tone}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const Tag = variant === "heading" || variant === "subtitle" ? "strong" : "span";

  return <Tag {...rest} className={classNameList} style={style}>{children}</Tag>;
}

// ── Title ─────────────────────────────────────────────────────────────────

export function Title({
  level = 1,
  children,
  style,
  className,
}: {
  level?: 1 | 2 | 3 | 4;
  children: ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) {
  const classNameList = ["fc-title", `fc-title--level-${level}`, className].filter(Boolean).join(" ");
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;

  return <Tag className={classNameList} style={style}>{children}</Tag>;
}

// ── Spacing ───────────────────────────────────────────────────────────────

export function Spacing({
  children,
  style,
  className,
  ...rest
}: {
  children: ReactNode;
  style?: React.CSSProperties;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const classNameList = ["fc-spacing", className].filter(Boolean).join(" ");
  return <div {...rest} className={classNameList} style={style}>{children}</div>;
}

// ── Divider ───────────────────────────────────────────────────────────────

export function Divider({
  style,
  className,
  ...rest
}: {
  style?: React.CSSProperties;
  className?: string;
} & React.HTMLAttributes<HTMLHRElement>) {
  const classNameList = ["fc-divider", className].filter(Boolean).join(" ");
  return <hr {...rest} className={classNameList} style={style} />;
}

// ── Icon ──────────────────────────────────────────────────────────────────

const ICONS: Record<string, ReactNode> = {
  home: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 11.5 12 5l8 6.5V20h-5.2v-5H9.2v5H4v-8.5Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  ),
  train: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M7 7.5v9M17 7.5v9M4 10v4M20 10v4M7 12h10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  nutrition: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z" fill="currentColor" />
    </svg>
  ),
  progress: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M4 19h16M6 16l4-6 3.5 3L18 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  you: (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle cx="12" cy="8" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M5 19.5c1.2-3 3.9-4.5 7-4.5s5.8 1.5 7 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 16l6 6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  "trash-2": (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M3 6h18M19 6v14c0 1.1-.9 2-2 2H7c-1.1 0-2-.9-2-2V6M8 6V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="6" y1="6" x2="18" y2="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  check: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  alert: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 9v4M12 17h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 16v-4M12 8h.01" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  clock: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 6v6l4 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  flame: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 1 11 12c0-1.38-.5-2.01-1-2.5A5 5 0 0 0 3.5 15c0 2.5 2 4.5 4.5 4.5a3.5 3.5 0 0 0 2.5-7.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  target: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  trending_up: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M22 18H6l4-8 4 6 4-6 4 8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trending_down: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M22 6H6l4 8 4-6 4 6 4-8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trending_flat: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M22 12H6l4-6 4 6 4-6 4 6Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  dumbbell: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="6" cy="6" r="3" fill="currentColor" />
      <circle cx="18" cy="18" r="3" fill="currentColor" />
      <path d="M9 9l6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
  bar_chart: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M3 21h18M3 21V7M3 21v-4M7 21V11M11 21V5M15 21V9M19 21V15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  trophy: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M6 9h18M8 9v7a4 4 0 0 0 8 0V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 4v2M8 16h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16 2v4M8 2v4M3 10h18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  clock_outline: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 6v6l4 2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  weight: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M12 3v6M6 9h12M6 9v12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  heart: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l7.78-7.78a5.5 5.5 0 0 0 0-7.78z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
  activity: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  ),
};

export function Icon({ name, style, className, ...rest }: { name: string; style?: React.CSSProperties; className?: string } & React.HTMLAttributes<HTMLSpanElement>) {
  const icon = ICONS[name];
  if (!icon) {
    console.warn(`Icon "${name}" not found`);
    return null;
  }
  return <span className={`fc-icon${className ? ` ${className}` : ""}`} style={style} {...rest}>{icon}</span>;
}

// ── StateBlock ────────────────────────────────────────────────────────────

/** Loading / error / empty states — designed, never a bare "Loading…". */
export function StateBlock({
  kind,
  title,
  body,
  action,
}: {
  kind: "loading" | "error" | "empty";
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`fc-state fc-state--${kind}`} role={kind === "error" ? "alert" : "status"}>
      {kind === "loading" ? <span className="fc-state__pulse" aria-hidden="true" /> : null}
      <p className="fc-state__title">{title}</p>
      {body ? <p className="fc-state__body">{body}</p> : null}
      {action ? <div className="fc-state__action">{action}</div> : null}
    </div>
  );
}

// ── Expandable ────────────────────────────────────────────────────────────

/** Summary → detail: a compact row that expands into contextual information. */
export function Expandable({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="fc-expandable" open={defaultOpen || undefined}>
      <summary className="fc-expandable__summary">
        <span className="fc-expandable__summary-text">{summary}</span>
        <span className="fc-expandable__chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      <div className="fc-expandable__body">{children}</div>
    </details>
  );
}

// ── Stepper ────────────────────────────────────────────────────────────────

/** Large touch-friendly numeric stepper used for set logging. */
export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 999,
  unit,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
}) {
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  return (
    <div className={`fc-stepper${disabled ? " is-disabled" : ""}`}>
      <span className="fc-stepper__label">{label}</span>
      <div className="fc-stepper__controls">
        <button
          type="button"
          className="fc-stepper__button"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value - step < min}
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </button>
        <span className="fc-stepper__value" aria-live="polite">
          {value}
          {unit ? <span className="fc-stepper__unit">{unit}</span> : null}
        </span>
        <button
          type="button"
          className="fc-stepper__button"
          aria-label={`Increase ${label}`}
          disabled={disabled || value + step > max}
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export { Dialog } from "./Dialog";