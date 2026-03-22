import type { HTMLAttributes, ReactNode, SVGProps } from 'react';
import { cx } from './ui-utils';

export type WorkspaceViewKey = 'timer' | 'reports' | 'taxonomy' | 'settings' | 'account';

export type GlyphName =
  | 'timer'
  | 'reports'
  | 'taxonomy'
  | 'settings'
  | 'account'
  | 'overlay'
  | 'pip'
  | 'dashboard'
  | 'play'
  | 'pause'
  | 'stop'
  | 'shield'
  | 'spark'
  | 'database'
  | 'search'
  | 'arrow-right'
  | 'download'
  | 'bolt'
  | 'moon'
  | 'cloud'
  | 'keyboard'
  | 'target';

interface GlyphProps extends SVGProps<SVGSVGElement> {
  name: GlyphName;
}

export function Glyph({ name, className, ...props }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cx('h-5 w-5', className)}
      aria-hidden="true"
      {...props}
    >
      {renderGlyph(name)}
    </svg>
  );
}

function renderGlyph(name: GlyphName) {
  switch (name) {
    case 'timer':
      return (
        <>
          <circle cx="12" cy="13" r="7.5" />
          <path d="M12 13V9.5" />
          <path d="M12 13L14.5 14.5" />
          <path d="M9.5 3.5H14.5" />
          <path d="M16.5 5.5L18 4" />
        </>
      );
    case 'reports':
      return (
        <>
          <path d="M4.5 19.5V10.5" />
          <path d="M10.5 19.5V4.5" />
          <path d="M16.5 19.5V8" />
          <path d="M3 19.5H21" />
        </>
      );
    case 'taxonomy':
      return (
        <>
          <circle cx="6" cy="7" r="2.2" />
          <circle cx="18" cy="7" r="2.2" />
          <circle cx="12" cy="17" r="2.2" />
          <path d="M7.8 8.2L10.2 14.8" />
          <path d="M16.2 8.2L13.8 14.8" />
          <path d="M8.4 7H15.6" />
        </>
      );
    case 'settings':
      return (
        <>
          <path d="M4 7H10" />
          <path d="M14 7H20" />
          <circle cx="12" cy="7" r="2" />
          <path d="M4 17H7" />
          <path d="M11 17H20" />
          <circle cx="9" cy="17" r="2" />
        </>
      );
    case 'account':
      return (
        <>
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5 19C6.7 16.4 9 15 12 15C15 15 17.3 16.4 19 19" />
        </>
      );
    case 'overlay':
      return (
        <>
          <path d="M9 4.5H4.5V9" />
          <path d="M15 4.5H19.5V9" />
          <path d="M9 19.5H4.5V15" />
          <path d="M15 19.5H19.5V15" />
        </>
      );
    case 'pip':
      return (
        <>
          <rect x="3" y="4" width="18" height="14" rx="2" />
          <rect x="11" y="10" width="8" height="6" rx="1" fill="currentColor" opacity="0.35" />
        </>
      );
    case 'dashboard':
      return (
        <>
          <rect x="4" y="4" width="6.5" height="7" rx="1.2" />
          <rect x="13.5" y="4" width="6.5" height="4.5" rx="1.2" />
          <rect x="4" y="14" width="6.5" height="6" rx="1.2" />
          <rect x="13.5" y="11.5" width="6.5" height="8.5" rx="1.2" />
        </>
      );
    case 'play':
      return <path d="M9 7.5L17 12L9 16.5V7.5Z" fill="currentColor" stroke="none" />;
    case 'pause':
      return (
        <>
          <rect x="7" y="6.5" width="3.5" height="11" rx="1" fill="currentColor" stroke="none" />
          <rect x="13.5" y="6.5" width="3.5" height="11" rx="1" fill="currentColor" stroke="none" />
        </>
      );
    case 'stop':
      return <rect x="7.5" y="7.5" width="9" height="9" rx="1.2" fill="currentColor" stroke="none" />;
    case 'shield':
      return (
        <>
          <path d="M12 3.5C14.5 5.2 17.4 5.8 19 6V11.7C19 15.5 16.4 18.8 12 20.5C7.6 18.8 5 15.5 5 11.7V6C6.6 5.8 9.5 5.2 12 3.5Z" />
        </>
      );
    case 'spark':
      return (
        <>
          <path d="M12 4L13.7 8.3L18 10L13.7 11.7L12 16L10.3 11.7L6 10L10.3 8.3L12 4Z" />
        </>
      );
    case 'database':
      return (
        <>
          <ellipse cx="12" cy="6.5" rx="6.5" ry="2.8" />
          <path d="M5.5 6.5V12.5C5.5 14 8.4 15.3 12 15.3C15.6 15.3 18.5 14 18.5 12.5V6.5" />
          <path d="M5.5 12.5V17.3C5.5 18.8 8.4 20.1 12 20.1C15.6 20.1 18.5 18.8 18.5 17.3V12.5" />
        </>
      );
    case 'search':
      return (
        <>
          <circle cx="11" cy="11" r="5.5" />
          <path d="M15.5 15.5L19.5 19.5" />
        </>
      );
    case 'arrow-right':
      return (
        <>
          <path d="M5 12H19" />
          <path d="M13 6L19 12L13 18" />
        </>
      );
    case 'download':
      return (
        <>
          <path d="M12 4.5V15" />
          <path d="M7.5 10.5L12 15L16.5 10.5" />
          <path d="M5 19.5H19" />
        </>
      );
    case 'bolt':
      return <path d="M13.5 3.5L6.5 13H11.2L10.5 20.5L17.5 11H12.8L13.5 3.5Z" />;
    case 'moon':
      return <path d="M16.5 4.8C15.8 4.6 15 4.5 14.2 4.5C9.9 4.5 6.5 7.9 6.5 12.2C6.5 15.7 8.8 18.6 12 19.6C11.2 19.8 10.4 19.9 9.6 19.9C5.9 19.9 3 17 3 13.3C3 8.7 6.7 5 11.3 5C13.2 5 15 5.6 16.5 6.8V4.8Z" />;
    case 'cloud':
      return <path d="M8 18.5H17C19.5 18.5 21 16.9 21 14.8C21 12.7 19.4 11 17.3 11C17 7.9 14.7 6 11.8 6C8.8 6 6.5 8 6.2 10.9C4.3 11.2 3 12.7 3 14.6C3 16.8 4.7 18.5 7 18.5H8Z" />;
    case 'keyboard':
      return (
        <>
          <rect x="3.5" y="6.5" width="17" height="11" rx="2" />
          <path d="M6.5 10H8" />
          <path d="M10 10H11.5" />
          <path d="M13.5 10H15" />
          <path d="M17 10H18" />
          <path d="M6.5 13.5H14.5" />
          <path d="M16.5 13.5H18" />
        </>
      );
    case 'target':
      return (
        <>
          <circle cx="12" cy="12" r="7.5" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2.5V5" />
          <path d="M12 19V21.5" />
          <path d="M21.5 12H19" />
          <path d="M5 12H2.5" />
        </>
      );
    default: {
      const _exhaustive: never = name;
      return null;
    }
  }
}

interface AppSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function AppSurface({ children, className, ...props }: AppSurfaceProps) {
  return (
    <div className={cx('sentinel-app', className)} {...props}>
      {children}
    </div>
  );
}

interface ScreenShellProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  wide?: boolean;
}

export function ScreenShell({ children, className, wide = false, ...props }: ScreenShellProps) {
  return (
    <div
      className={cx('sentinel-screen-shell', wide && 'sentinel-screen-shell--wide', className)}
      data-ui="screen-shell"
      {...props}
    >
      {children}
    </div>
  );
}

interface WorkspaceLayoutProps extends HTMLAttributes<HTMLDivElement> {
  activeView: WorkspaceViewKey;
  children: ReactNode;
  navigation?: Partial<Record<WorkspaceViewKey, () => void>>;

  statusLabel?: string;
  statusDetail?: string;
  topbarMeta?: ReactNode;
}

export function WorkspaceLayout({
  activeView,
  children,
  navigation = {},
  statusLabel,
  statusDetail,
  topbarMeta,
  className,
  ...props
}: WorkspaceLayoutProps) {
  const primaryNavigation: Array<{ key: WorkspaceViewKey; label: string; icon: GlyphName }> = [
    { key: 'timer', label: 'Timer', icon: 'timer' },
    { key: 'reports', label: 'Reports', icon: 'reports' },
    { key: 'taxonomy', label: 'Taxonomy', icon: 'taxonomy' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ];

  return (
    <AppSurface className={cx('sentinel-app--workspace', className)} {...props}>
      <div className="sentinel-workspace">
        <aside className="sentinel-sidebar" aria-label="Primary">
          <div className="sentinel-sidebar__brand">
            <div className="sentinel-sidebar__brand-mark">
              <Glyph name="shield" className="h-4 w-4" />
            </div>
            <div className="sentinel-sidebar__brand-copy">
              <p className="sentinel-sidebar__brand-title">Sentinel</p>
              <p className="sentinel-sidebar__brand-subtitle">Obsidian Sanctuary</p>
            </div>
          </div>

          <nav className="sentinel-sidebar__nav">
            {primaryNavigation.map((item) => (
              <SidebarButton
                key={item.key}
                label={item.label}
                icon={item.icon}
                active={activeView === item.key}
                onClick={navigation[item.key]}
              />
            ))}
          </nav>

          <div className="sentinel-sidebar__footer">
            {(statusLabel || statusDetail) && (
              <div className="sentinel-sidebar__status">
                {statusLabel && <p className="sentinel-sidebar__status-title">{statusLabel}</p>}
                {statusDetail && <p className="sentinel-sidebar__status-copy">{statusDetail}</p>}
              </div>
            )}
            <SidebarButton
              label="Account"
              icon="account"
              active={activeView === 'account'}
              onClick={navigation.account}
            />
          </div>
        </aside>

        <div className="sentinel-workspace__main">
          <div className="sentinel-topbar">
            <div className="sentinel-topbar__brand">
              <span className="sentinel-topbar__brand-mark" />
              <span>Sentinel</span>
            </div>
            <div className="sentinel-topbar__meta">
              {topbarMeta}
            </div>
          </div>

          <div className="sentinel-workspace__content">{children}</div>
        </div>
      </div>
    </AppSurface>
  );
}

interface SidebarButtonProps {
  label: string;
  icon: GlyphName;
  active: boolean;
  onClick?: () => void;
}

function SidebarButton({ label, icon, active, onClick }: SidebarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="sentinel-sidebar__button"
      aria-current={active ? 'page' : undefined}
      disabled={!onClick}
      title={label}
    >
      <span className="sentinel-sidebar__icon">
        <Glyph name={icon} className="h-5 w-5" />
      </span>
      <span className="sentinel-sidebar__label">{label}</span>
    </button>
  );
}

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  onBack?: () => void;
  backLabel?: string;
  backAriaLabel?: string;
  actions?: ReactNode;
}

export function ScreenHeader({
  title,
  subtitle,
  eyebrow,
  onBack,
  backLabel = 'Back',
  backAriaLabel = 'Back',
  actions,
}: ScreenHeaderProps) {
  return (
    <header className="sentinel-screen-header">
      <div className="min-w-0 space-y-3">
        {eyebrow && <p className="sentinel-eyebrow">{eyebrow}</p>}
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold tracking-tight text-(--text-primary) sm:text-4xl">
            {title}
          </h1>
          {subtitle && <p className="max-w-2xl text-sm leading-7 text-(--text-secondary)">{subtitle}</p>}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {actions}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="sentinel-inline-button"
            aria-label={backAriaLabel}
          >
            {backLabel}
          </button>
        )}
      </div>
    </header>
  );
}

interface SectionCardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  title?: string;
  description?: string;
  eyebrow?: string;
  icon?: GlyphName;
  actions?: ReactNode;
  bodyClassName?: string;
}

export function SectionCard({
  children,
  className,
  title,
  description,
  eyebrow,
  icon,
  actions,
  bodyClassName,
  ...props
}: SectionCardProps) {
  return (
    <section className={cx('sentinel-panel sentinel-card', className)} data-ui="section-card" {...props}>
      {(title || description || actions || eyebrow) && (
        <div className="sentinel-section-header">
          <div className="min-w-0 space-y-2">
            {eyebrow && <p className="sentinel-eyebrow">{eyebrow}</p>}
            {(title || description) && (
              <div className="space-y-1.5">
                {title && (
                  <div className="flex items-center gap-3">
                    {icon && (
                      <span className="sentinel-section-icon">
                        <Glyph name={icon} className="h-4 w-4" />
                      </span>
                    )}
                    <h2 className="text-lg font-bold tracking-tight text-(--text-primary)">{title}</h2>
                  </div>
                )}
                {description && <p className="text-sm leading-7 text-(--text-secondary)">{description}</p>}
              </div>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cx('flex flex-col gap-4', bodyClassName)}>{children}</div>
    </section>
  );
}

interface FieldBlockProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  label: string;
  description?: string;
}

export function FieldBlock({ children, className, label, description, ...props }: FieldBlockProps) {
  return (
    <div className={cx('flex flex-col gap-3', className)} {...props}>
      <div className="space-y-1.5">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-(--text-muted)">{label}</p>
        {description && <p className="text-sm leading-7 text-(--text-secondary)">{description}</p>}
      </div>
      {children}
    </div>
  );
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}

export function ToggleRow({ label, description, checked, onToggle }: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="sentinel-toggle-row"
      role="switch"
      aria-checked={checked}
    >
      <span className="min-w-0 space-y-1.5 text-left">
        <span className="block text-sm font-semibold text-(--text-primary)">{label}</span>
        <span className="block text-sm leading-6 text-(--text-secondary)">{description}</span>
      </span>
      <span className={cx('sentinel-toggle', checked && 'sentinel-toggle--checked')} aria-hidden="true">
        <span className="sentinel-toggle-thumb" />
      </span>
    </button>
  );
}

interface ActionGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ActionGrid({ children, className, ...props }: ActionGridProps) {
  return (
    <div className={cx('grid gap-3 sm:grid-cols-2', className)} {...props}>
      {children}
    </div>
  );
}

interface ModalLayoutProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ModalLayout({ children, className, ...props }: ModalLayoutProps) {
  return (
    <AppSurface className={cx('flex min-h-full items-center justify-center overflow-y-auto p-(--page-padding)', className)} {...props}>
      {children}
    </AppSurface>
  );
}

interface ModalCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function ModalCard({ children, className, ...props }: ModalCardProps) {
  return (
    <div className={cx('sentinel-panel sentinel-modal-card', className)} {...props}>
      {children}
    </div>
  );
}


