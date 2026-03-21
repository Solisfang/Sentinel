import type { HTMLAttributes, ReactNode } from 'react';

export function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
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

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  backLabel?: string;
  backAriaLabel?: string;
  actions?: ReactNode;
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  backAriaLabel = 'Back',
  actions,
}: ScreenHeaderProps) {
  return (
    <header className="sentinel-screen-header">
      <div className="min-w-0 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {subtitle && <p className="text-sm leading-relaxed text-zinc-400">{subtitle}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
  bodyClassName?: string;
}

export function SectionCard({
  children,
  className,
  title,
  description,
  bodyClassName,
  ...props
}: SectionCardProps) {
  return (
    <section className={cx('sentinel-panel sentinel-card', className)} data-ui="section-card" {...props}>
      {(title || description) && (
        <div className="mb-4 space-y-1.5">
          {title && <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-zinc-300">{title}</h2>}
          {description && <p className="text-sm leading-relaxed text-zinc-400">{description}</p>}
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
    <div className={cx('flex flex-col gap-2.5', className)} {...props}>
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">{label}</p>
        {description && <p className="text-sm leading-relaxed text-zinc-400">{description}</p>}
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
      <span className="min-w-0 space-y-1 text-left">
        <span className="block text-sm font-medium text-zinc-200">{label}</span>
        <span className="block text-sm leading-relaxed text-zinc-400">{description}</span>
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
    <AppSurface className={cx('flex items-center justify-center p-[var(--page-padding)]', className)} {...props}>
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

export const inputClasses = {
  base: 'sentinel-input',
  centered: 'sentinel-input text-center',
  subtle: 'sentinel-input sentinel-input--subtle',
};

export const buttonClasses = {
  primary: 'sentinel-button sentinel-button--primary',
  secondary: 'sentinel-button sentinel-button--secondary',
  ghost: 'sentinel-button sentinel-button--ghost',
  danger: 'sentinel-button sentinel-button--danger',
  compact: 'sentinel-button sentinel-button--compact',
  inline: 'sentinel-inline-button',
  chip: 'sentinel-chip',
};
