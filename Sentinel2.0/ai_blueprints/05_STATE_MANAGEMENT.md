## 5. Angular Frontend Application

This section specifies every module, component, service, routing rule, and data flow in the Angular frontend application. The Angular app replaces the source React/Vite/TypeScript SPA (`Sentinel.UI/src/`) and serves as the sole presentation layer and local state manager. It runs inside the Photino WebView (→ §2) and communicates with the C# shell exclusively via IPC messages (→ §3).

**Critical migration principle:** In the source architecture, the React app delegated most data operations (report queries, session logging, taxonomy mutations, export) to the C# shell via IPC→SQLite. In the target architecture, the Angular app writes directly to Firestore for all persistent data. The C# shell has no database. The only IPC messages Angular sends to the C# shell are: window management commands (`TOGGLE_COMPACT`, `OVERLAY_MINIMIZE`, `OVERLAY_CLOSE`, `PLAY_SOUND`), settings persistence (`SAVE_SETTINGS`, `GET_SETTINGS`), and the idle-response handshake (`AUDITOR_CLEARED`). All session events, distraction logs, taxonomy changes, report queries, and planner operations are performed by Angular directly against Firebase.

**Source files mapped:**

| Source File | Target Equivalent | Migration Status |
|---|---|---|
| `Sentinel.UI/src/App.tsx` | `src/app/app.component.ts` + feature modules | **REWRITTEN** — monolithic component split into Angular modules |
| `Sentinel.UI/src/views.tsx` | Feature components across modules | **REWRITTEN** — each exported function component → Angular component |
| `Sentinel.UI/src/utils.ts` | `src/app/core/timer.utils.ts` | **PORTED** — pure functions carried forward |
| `Sentinel.UI/src/taxonomy.ts` | `src/app/core/taxonomy.utils.ts` | **PORTED** — pure functions carried forward |
| `Sentinel.UI/src/app-types.ts` | `src/app/core/models.ts` | **PORTED** with modifications for Event Ledger |
| `Sentinel.UI/src/ui.tsx` | `src/app/shared/` components | **REWRITTEN** — React components → Angular components |
| `Sentinel.UI/src/ui-utils.ts` | `src/app/shared/ui-utils.ts` | **PORTED** verbatim |
| `Sentinel.UI/src/firebase.ts` | `src/app/core/firebase.service.ts` | **REWRITTEN** — uses Angular Fire / modular SDK |
| `Sentinel.UI/src/index.css` | `src/styles.css` | **PORTED** with Tailwind v4 migration |
| *(no source)* | `src/app/planner/` module | **NEW** — Teams-style planner (→ §5.6) |

---

### 5.1. Project Scaffold & Tooling

#### 5.1.1. Angular CLI Configuration (Strict TypeScript Mode)

The Angular project is created with `ng new sentinel-ui --strict --style=css --routing --ssr=false`. The `--strict` flag enables:

- `strict: true` in `tsconfig.json` (enables `strictNullChecks`, `strictPropertyInitialization`, `noImplicitAny`, `noImplicitReturns`, `noFallthroughCasesInSwitch`).
- `strictTemplates: true` and `strictInjectionParameters: true` in `angularCompilerOptions`.

**`tsconfig.json` excerpt:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "experimentalDecorators": true,
    "moduleResolution": "bundler",
    "importHelpers": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "declaration": false,
    "downlevelIteration": true,
    "paths": {
      "@core/*": ["src/app/core/*"],
      "@shared/*": ["src/app/shared/*"],
      "@features/*": ["src/app/features/*"]
    }
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  }
}
```

**`angular.json` build configuration (relevant excerpts):**

```json
{
  "projects": {
    "sentinel-ui": {
      "architect": {
        "build": {
          "builder": "@angular-devkit/build-angular:application",
          "options": {
            "outputPath": "dist/sentinel-ui",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.app.json",
            "assets": [
              { "glob": "**/*", "input": "src/assets" }
            ],
            "styles": ["src/styles.css"],
            "budgets": [
              { "type": "initial", "maximumWarning": "500kB", "maximumError": "1MB" },
              { "type": "anyComponentStyle", "maximumWarning": "4kB", "maximumError": "8kB" }
            ]
          },
          "configurations": {
            "production": {
              "optimization": true,
              "outputHashing": "all",
              "sourceMap": false,
              "namedChunks": false
            }
          }
        }
      }
    }
  }
}
```

#### 5.1.2. Build Output Path → Photino Embedded Resources

The Angular production build output (`dist/sentinel-ui/browser/`) is embedded into the Photino C# project as static resources. The Photino shell loads the Angular app from the local file system.

**Build integration:**

1. Angular production build:  `ng build --configuration=production`
2. Output lands in: `Sentinel.UI/dist/sentinel-ui/browser/` (contains `index.html`, JS chunks, CSS, and assets).
3. The C# `.csproj` includes a post-build step or MSBuild target that copies the Angular output into `wwwroot/` under the shell project.
4. Photino loads the app via: `new PhotinoWindow().Load("wwwroot/index.html")`.

**`index.html` base href:** `<base href="./">` — the relative base href ensures the app works when loaded from a file path rather than an HTTP origin.

#### 5.1.3. Tailwind CSS / Design System Integration

The source uses Tailwind CSS v4 (imported via `@import "tailwindcss";` in `index.css`). The target maintains this approach.

**Source design system tokens** (from `Sentinel.UI/src/index.css` and `stitch_exports/Sentinel2.0/metadata/design-system-theme.json`):

The "Obsidian Sanctuary" design system defines the following CSS custom properties, which are carried forward verbatim:

```css
:root {
  color-scheme: dark;
  font-family: 'Inter Variable', 'Inter', sans-serif;
  --font-display: 'Manrope Variable', 'Manrope', sans-serif;
  --font-body: 'Inter Variable', 'Inter', sans-serif;
  --app-bg: #131313;
  --surface-lowest: #0e0e0e;
  --surface-low: #1c1b1b;
  --surface: #201f1f;
  --surface-high: #2a2a2a;
  --surface-highest: #353534;
  --outline: rgba(73, 68, 85, 0.32);
  --outline-strong: rgba(148, 142, 161, 0.28);
  --primary: #cdbdff;
  --primary-strong: #7c4dff;
  --secondary: #8dcdff;
  --tertiary: #3ce36a;
  --text-primary: #e5e2e1;
  --text-secondary: #cac3d8;
  --text-muted: #948ea1;
  --page-padding: clamp(1.1rem, 2.3vw, 1.8rem);
  --section-gap: clamp(1.75rem, 3vw, 2.25rem);
  --card-padding: clamp(1.15rem, 2vw, 1.65rem);
  --card-radius: 1.45rem;
  --control-height: 3rem;
  --shell-max: 54rem;
  --shell-max-wide: 78rem;
  --modal-max: 34rem;
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.3);
  --shadow-soft: 0 4px 16px rgba(0, 0, 0, 0.2);
  --nav-collapsed: 4.75rem;
  --nav-expanded: 15.5rem;
  --topbar-height: 3.2rem;
}
```

**Font hosting:** Self-hosted via `@fontsource-variable/inter` and `@fontsource-variable/manrope`. No external font requests (GDPR compliant).

**Accent color constants** (used across timer modes, charts, and metric cards):

```typescript
// File: src/app/core/design-tokens.ts

export const ACCENT_COLORS = {
  primary: '#7c4dff',
  secondary: '#00affe',
  tertiary: '#3ce36a',
  warning: '#f59e0b',
  danger: '#ef4444',
  pink: '#ec4899',
} as const;

export const CHART_COLORS = ['#7c4dff', '#00affe', '#3ce36a', '#f59e0b', '#ec4899', '#ef4444'] as const;

export const MODE_META: Record<TimerMode, {
  label: string;
  accent: string;
  accentSoft: string;
  accentText: string;
  topbarLabel: string;
}> = {
  pomodoro: {
    label: 'Focus',
    accent: '#7c4dff',
    accentSoft: 'rgba(124, 77, 255, 0.18)',
    accentText: '#cdbdff',
    topbarLabel: 'Focus Active',
  },
  shortBreak: {
    label: 'Short Break',
    accent: '#3ce36a',
    accentSoft: 'rgba(60, 227, 106, 0.16)',
    accentText: '#a8f4bc',
    topbarLabel: 'Short Break',
  },
  longBreak: {
    label: 'Long Break',
    accent: '#00affe',
    accentSoft: 'rgba(0, 175, 254, 0.16)',
    accentText: '#b7e8ff',
    topbarLabel: 'Long Break',
  },
};
```

#### 5.1.4. Code-Splitting Strategy (Lazy-Load Charts & Firebase Modules)

Angular lazy-loads feature modules to keep the initial bundle under the 500 kB budget:

| Module | Route Path | Lazy-Loaded | Rationale |
|---|---|---|---|
| `TimerModule` | `/` (default) | No — eagerly loaded | Primary view, must render instantly |
| `ReportsModule` | `/reports` | Yes | Contains chart libraries (ng2-charts or similar) |
| `HistoryModule` | `/history` | Yes | Large session list rendering |
| `TaxonomyModule` | `/taxonomy` | Yes | Infrequently used |
| `SettingsModule` | `/settings` | Yes | Infrequently used |
| `AccountModule` | `/account` | Yes | Firebase Auth SDK is heavy |
| `PlannerModule` | `/planner` | Yes | **NEW** — calendar grid is heavy |
| `OnboardingModule` | (overlay, no route) | Yes | One-time modal |

**Firebase SDK:** Use the modular/tree-shakable Firebase JS SDK v10+ (`firebase/app`, `firebase/auth`, `firebase/firestore`). Do NOT use `@angular/fire` compatibility layer — use direct imports with Angular `inject()` for services. This produces smaller bundles than the compat namespace imports.

---

### 5.2. Design System & Shared Components

The shared component library is located at `src/app/shared/` and provides the reusable building blocks for every feature module. These components are direct Angular ports of the React components in `Sentinel.UI/src/ui.tsx`.

#### 5.2.1. Icon System (Lucide-Style Glyph Component)

**Source:** `Sentinel.UI/src/ui.tsx` — `Glyph` React component with inline SVG paths.

The source defines a `Glyph` component that renders inline SVGs for 24 icon names. Each icon is a 24×24 viewBox SVG with `stroke-width: 1.8`, `stroke-linecap: round`, `stroke-linejoin: round`.

**Target: `GlyphComponent`**

```typescript
// File: src/app/shared/glyph/glyph.component.ts

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export type GlyphName =
  | 'timer' | 'reports' | 'taxonomy' | 'settings' | 'account'
  | 'overlay' | 'pip' | 'dashboard' | 'play' | 'pause' | 'stop'
  | 'shield' | 'spark' | 'database' | 'search' | 'arrow-right'
  | 'download' | 'bolt' | 'moon' | 'cloud' | 'keyboard' | 'target'
  | 'history' | 'planner';

@Component({
  selector: 'app-glyph',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 24 24'"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      [class]="'h-5 w-5 ' + className"
      aria-hidden="true">
      <ng-container [ngSwitch]="name">
        <!-- Timer -->
        <ng-container *ngSwitchCase="'timer'">
          <circle cx="12" cy="13" r="7.5"/>
          <path d="M12 13V9.5"/>
          <path d="M12 13L14.5 14.5"/>
          <path d="M9.5 3.5H14.5"/>
          <path d="M16.5 5.5L18 4"/>
        </ng-container>
        <!-- ... one ngSwitchCase per GlyphName, carrying forward all SVG paths from source verbatim -->
      </ng-container>
    </svg>
  `,
})
export class GlyphComponent {
  @Input({ required: true }) name!: GlyphName;
  @Input() className = '';
}
```

**Complete glyph SVG path registry** — each icon's SVG path data is carried forward verbatim from the source `renderGlyph()` switch statement in `Sentinel.UI/src/ui.tsx`. The full set of 23 icons (timer, reports, taxonomy, settings, account, overlay, pip, dashboard, play, pause, stop, shield, spark, database, search, arrow-right, download, bolt, moon, cloud, keyboard, target, history) plus 1 new icon (`planner` — for the Planner module, → §5.6) must be implemented.

#### 5.2.2. WorkspaceLayout — App Shell with Navigation

**Source:** `Sentinel.UI/src/ui.tsx` — `WorkspaceLayout` React component.

The WorkspaceLayout provides the persistent sidebar navigation and top bar that wraps every non-modal view. It uses a CSS grid with two columns: collapsed sidebar (`var(--nav-collapsed)` = 4.75rem) and main content area.

**Target: `WorkspaceLayoutComponent`**

```typescript
// File: src/app/shared/workspace-layout/workspace-layout.component.ts

import { Component, Input, ChangeDetectionStrategy } from '@angular/core';

export type WorkspaceViewKey = 'timer' | 'planner' | 'reports' | 'history' | 'taxonomy' | 'settings' | 'account';

@Component({
  selector: 'app-workspace-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-app sentinel-app--workspace">
      <div class="sentinel-workspace">
        <!-- Sidebar -->
        <nav class="sentinel-sidebar" role="navigation" aria-label="Main navigation">
          <div class="sentinel-sidebar__brand">
            <span class="sentinel-sidebar__brand-mark">
              <app-glyph name="shield" className="h-5 w-5"/>
            </span>
          </div>
          <div class="sentinel-sidebar__nav">
            <!-- Navigation items for each WorkspaceViewKey -->
            <button *ngFor="let item of navItems"
              (click)="navigate(item.key)"
              [class.sentinel-sidebar__item--active]="activeView === item.key"
              class="sentinel-sidebar__item"
              [attr.aria-label]="item.label">
              <app-glyph [name]="item.icon" className="h-5 w-5"/>
            </button>
          </div>
        </nav>

        <!-- Main area -->
        <div class="sentinel-main">
          <!-- Top bar -->
          <header class="sentinel-topbar">
            <div class="sentinel-topbar__status">
              <span class="sentinel-topbar__label">{{ statusLabel }}</span>
              <span class="sentinel-topbar__detail">{{ statusDetail }}</span>
            </div>
            <div class="sentinel-topbar__meta">
              <ng-content select="[topbar-meta]"></ng-content>
            </div>
          </header>
          <!-- Page content -->
          <main class="sentinel-page-content" [attr.role]="role" [attr.aria-label]="ariaLabel">
            <ng-content></ng-content>
          </main>
        </div>
      </div>
    </div>
  `,
})
export class WorkspaceLayoutComponent {
  @Input({ required: true }) activeView!: WorkspaceViewKey;
  @Input() statusLabel = '';
  @Input() statusDetail = '';
  @Input() userEmail: string | null = null;
  @Input() role = 'main';
  @Input() ariaLabel = '';

  navItems: { key: WorkspaceViewKey; icon: GlyphName; label: string }[] = [
    { key: 'timer', icon: 'timer', label: 'Timer' },
    { key: 'planner', icon: 'planner', label: 'Planner' },
    { key: 'reports', icon: 'reports', label: 'Reports' },
    { key: 'history', icon: 'history', label: 'History' },
    { key: 'taxonomy', icon: 'taxonomy', label: 'Taxonomy' },
    { key: 'settings', icon: 'settings', label: 'Settings' },
    { key: 'account', icon: 'account', label: 'Account' },
  ];

  navigate(key: WorkspaceViewKey): void {
    // Emits via Router.navigate or event output — feature modules handle this
  }
}
```

**Change from source:** The source navigation has 6 items (timer, reports, history, taxonomy, settings, account). The target adds a 7th: `planner` (→ §5.6), positioned second in the navigation list.

#### 5.2.3. SectionCard — Content Container Component

**Source:** `Sentinel.UI/src/ui.tsx` — `SectionCard` React component.

`SectionCard` is the primary content container used throughout the app. It implements the "Obsidian Sanctuary" design principle: no hard borders, tonal depth via nested `surface` backgrounds, `card-radius` rounding.

```typescript
// File: src/app/shared/section-card/section-card.component.ts

@Component({
  selector: 'app-section-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-panel sentinel-card" [class]="className">
      <div class="sentinel-card__header" *ngIf="title">
        <div class="sentinel-card__header-text">
          <app-glyph *ngIf="icon" [name]="icon" className="h-4 w-4 text-[var(--text-muted)]"/>
          <div>
            <h3 class="sentinel-card__title">{{ title }}</h3>
            <p *ngIf="description" class="sentinel-card__description">{{ description }}</p>
          </div>
        </div>
        <ng-content select="[card-actions]"></ng-content>
      </div>
      <div class="sentinel-card__body" [class]="bodyClassName">
        <ng-content></ng-content>
      </div>
    </div>
  `,
})
export class SectionCardComponent {
  @Input() title?: string;
  @Input() description?: string;
  @Input() icon?: GlyphName;
  @Input() className = '';
  @Input() bodyClassName = '';
}
```

#### 5.2.4. ModalLayout — Overlay Modal Wrapper

**Source:** `Sentinel.UI/src/ui.tsx` — `ModalLayout` and `ModalCard` React components.

The `ModalLayout` renders a full-screen overlay backdrop with a centered `ModalCard`. Used by: intervention modal, onboarding wizard, session complete screen, resume prompt, confirm dialogs.

```typescript
// File: src/app/shared/modal/modal-layout.component.ts

@Component({
  selector: 'app-modal-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-modal-backdrop" [attr.role]="role" [attr.aria-label]="ariaLabel">
      <ng-content></ng-content>
    </div>
  `,
})
export class ModalLayoutComponent {
  @Input() role = 'dialog';
  @Input() ariaLabel = '';
}

@Component({
  selector: 'app-modal-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sentinel-modal-card" [class]="className">
      <ng-content></ng-content>
    </div>
  `,
})
export class ModalCardComponent {
  @Input() className = '';
}
```

#### 5.2.5. Theme & Color Palette Constants

All theme constants are defined as CSS custom properties (→ §5.1.3). TypeScript-side constants for programmatic use:

```typescript
// File: src/app/core/design-tokens.ts

export type TimerMode = 'pomodoro' | 'shortBreak' | 'longBreak';
export type OverlayStyle = 'pill' | 'compact' | 'monitoring';
```

The `MODE_META` constant (defined in §5.1.3) maps each `TimerMode` to its accent colors and labels. This is the TypeScript equivalent of the source `MODE_META` object in `Sentinel.UI/src/views.tsx`.

#### 5.2.6. Responsive Breakpoints for Compact vs. Full Mode

The app operates in two layout modes controlled by the C# shell:

| Mode | Window Size | Trigger | CSS Class |
|---|---|---|---|
| **Full mode** | ~1100×780 px (default) | Normal window state | `.sentinel-app--workspace` |
| **Compact mode** | ~340×160 px | User clicks PiP button or C# sends `COMPACT_MODE_CHANGED` | `.sentinel-glass-overlay` |

**Compact mode detection:** The Angular `AppComponent` listens for the `COMPACT_MODE_CHANGED` IPC message (→ §3.2.9) and toggles a `isCompactMode` signal. When `true`, the router is bypassed and the `CompactTimerComponent` is rendered directly.

**Overlay styles in compact mode:**

The source defines three overlay styles selectable via `settings.overlayStyle`:

1. **`pill`** — Minimal: drag bar, timer display, progress bar. Single-click ↔ start/pause.
2. **`compact`** — Functional: drag bar, timer display, play/pause button, progress bar.
3. **`monitoring`** — Monitoring: drag bar, timer display, status text ("In deep work" / distraction count), play/pause button, progress bar.

All three overlay styles share the `.sentinel-glass-overlay` class (glassmorphism backdrop with `backdrop-filter: blur(20px)`).

---

### 5.3. Routing & Navigation

#### 5.3.1. Route Definitions (Timer, Planner, Reports, History, Settings, Account)

```typescript
// File: src/app/app.routes.ts

import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./features/timer/timer.component').then(m => m.TimerComponent),
  },
  {
    path: 'planner',
    loadComponent: () =>
      import('./features/planner/planner.component').then(m => m.PlannerComponent),
  },
  {
    path: 'reports',
    loadComponent: () =>
      import('./features/reports/reports.component').then(m => m.ReportsComponent),
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./features/history/history.component').then(m => m.HistoryComponent),
  },
  {
    path: 'taxonomy',
    loadComponent: () =>
      import('./features/taxonomy/taxonomy.component').then(m => m.TaxonomyComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./features/settings/settings.component').then(m => m.SettingsComponent),
  },
  {
    path: 'account',
    loadComponent: () =>
      import('./features/account/account.component').then(m => m.AccountComponent),
  },
  { path: '**', redirectTo: '' },
];
```

**Note:** All feature routes use standalone component lazy loading (`loadComponent`) rather than `loadChildren` with NgModules. This produces finer-grained code-splitting.

#### 5.3.2. Lazy-Loaded Feature Modules

Every route except the default (`''` → `TimerComponent`) is lazy-loaded. The `TimerComponent` is eagerly loaded because it is the landing view and must render instantly without a loading state.

#### 5.3.3. Route Guards (Auth-Required for Account/Cloud Features)

```typescript
// File: src/app/core/auth.guard.ts

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { map, take } from 'rxjs';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);
  return authService.user$.pipe(
    take(1),
    map(user => {
      if (user) return true;
      return router.createUrlTree(['/account']);
    }),
  );
};
```

**Usage:** The `authGuard` is optionally applied to feature routes that require cloud access. Currently no routes are guard-protected because the app is designed to work in local-only mode. The guard is available for future use when server-exclusive features (e.g., leaderboards) are added.

#### 5.3.4. Deep-Link Support from IPC Messages

The C# shell does not navigate the Angular app via URL changes. Instead, Angular listens for IPC messages that imply a view change. The source uses `setView('reports')` etc. in response to various user actions; the target uses `Router.navigate()`:

| IPC Message / User Action | Source Behavior | Target Behavior |
|---|---|---|
| `IDLE_DETECTED` received | `setShowIntervention(true)` (overlay, no route change) | Angular `InterventionService.show()` (overlay, no route change) |
| User clicks "Reports" in sidebar | `setView('reports')` | `Router.navigate(['/reports'])` |
| `COMPACT_MODE_CHANGED` | `setIsCompactMode(data.isCompact)` | `AppComponent.isCompactMode.set(data.isCompact)` — bypasses router |

---

### 5.4. Core Timer Module

The timer module is the heart of the Sentinel frontend. It implements a drift-free countdown engine, manages the Pomodoro work/break cycle, and surfaces session progress to the user. This module is eagerly loaded.

**Source:** The entire timer logic in the source lives in `App.tsx` as React hooks and refs. In the target, it is extracted into a dedicated `TimerService` (singleton, provided in `root`) and a `TimerComponent` (presentation layer).

#### 5.4.1. Drift-Free Anchor-Based Timer Engine

##### 5.4.1.1. `timerAnchor` — `Date.now()` Snapshot at Start

**Source implementation** (`Sentinel.UI/src/App.tsx`, lines 122–126):

```typescript
const timerAnchorRef = useRef<{ startedAt: number; startTimeLeft: number } | null>(null);
```

When the timer starts (or resumes from pause), an anchor object is captured:

```typescript
if (!timerAnchorRef.current) {
  const now = Date.now();
  timerAnchorRef.current = { startedAt: now, startTimeLeft: timeLeft };
}
```

**Target implementation:**

```typescript
// File: src/app/core/timer.service.ts

interface TimerAnchor {
  startedAt: number;    // Date.now() at the moment the timer was started/resumed
  startTimeLeft: number; // seconds remaining at that moment
}

@Injectable({ providedIn: 'root' })
export class TimerService {
  private timerAnchor: TimerAnchor | null = null;
  private sessionStartedAt: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  // Signals (Angular signals for reactive UI binding)
  readonly timeLeft = signal<number>(25 * 60);
  readonly isRunning = signal<boolean>(false);
  readonly isComplete = signal<boolean>(false);
  readonly timerMode = signal<TimerMode>('pomodoro');
  readonly sessionName = signal<string>('');
  readonly isPausedByIntervention = signal<boolean>(false);
  readonly distractions = signal<DistractionRecord[]>([]);
  readonly sessionsCompletedToday = signal<number>(0);
  readonly todayFocusSeconds = signal<number>(0);

  // ...
}
```

##### 5.4.1.2. `setInterval` Tick: Remaining = Anchor + Duration − Now

**Source implementation** (`Sentinel.UI/src/App.tsx`, lines 270–295):

The source uses `setInterval(fn, 250)` (4 ticks per second) for responsive display. On each tick:

```typescript
const elapsed = Math.floor((Date.now() - anchor.startedAt) / 1000);
const remaining = Math.max(0, anchor.startTimeLeft - elapsed);
```

If `remaining <= 0`, the timer is complete: the interval is cleared, the session is logged, and the session-complete screen is shown.

**Target implementation:**

```typescript
// File: src/app/core/timer.service.ts (continued)

startTimer(): void {
  if (this.isRunning()) return;

  const mode = this.timerMode();
  const settings = this.settingsService.settings();

  if (this.isComplete()) {
    this.timeLeft.set(getTimerDuration(mode, settings));
    this.isComplete.set(false);
    this.distractions.set([]);
    this.sessionStartedAt = null;
  }

  const now = Date.now();
  this.timerAnchor = { startedAt: now, startTimeLeft: this.timeLeft() };

  if (this.sessionStartedAt === null) {
    const alreadyElapsed = getTimerDuration(mode, settings) - this.timeLeft();
    this.sessionStartedAt = now - alreadyElapsed * 1000;
  }

  this.isRunning.set(true);
  this.isPausedByIntervention.set(false);

  this.intervalId = setInterval(() => this.tick(), 250);

  this.bridgeService.send('TIMER_RUNNING', { running: true });
}

pauseTimer(): void {
  this.clearInterval();
  this.timerAnchor = null;
  this.isRunning.set(false);
  this.bridgeService.send('TIMER_RUNNING', { running: false });
}

private tick(): void {
  if (!this.timerAnchor) return;

  const elapsed = Math.floor((Date.now() - this.timerAnchor.startedAt) / 1000);
  const remaining = Math.max(0, this.timerAnchor.startTimeLeft - elapsed);

  if (remaining <= 0) {
    this.clearInterval();
    this.timerAnchor = null;
    this.timeLeft.set(0);
    this.isRunning.set(false);
    this.isComplete.set(true);

    if (this.timerMode() === 'pomodoro') {
      this.completeSession(false); // endedEarly = false
    }
  } else {
    this.timeLeft.set(remaining);
  }
}

private clearInterval(): void {
  if (this.intervalId !== null) {
    clearInterval(this.intervalId);
    this.intervalId = null;
  }
}
```

##### 5.4.1.3. Drift Correction vs. Naïve Decrement

**Why the anchor pattern:** A naïve `timeLeft -= 1` every 1000ms drifts by ~50–200ms per minute because `setInterval` does not guarantee exact timing and the callback may be delayed by UI thread work. The anchor pattern eliminates all drift:

$$\text{remaining} = \text{startTimeLeft} - \lfloor (\text{now} - \text{startedAt}) / 1000 \rfloor$$

The 250ms poll interval means the displayed time updates at most 250ms after each second boundary, which is imperceptible to users. The anchor is recaptured on every pause/resume to prevent stale offsets.

#### 5.4.2. Timer States: Stopped → Running → Paused → Completed

```
         startTimer()        tick() remaining=0
STOPPED ────────────► RUNNING ──────────────► COMPLETED
  ▲                     │    ▲                     │
  │                     │    │                     │
  │    pauseTimer() ◄───┘    │ resumeTimer()       │
  │                          │                     │
  │    PAUSED ───────────────┘                     │
  │      │                                         │
  │      │  IDLE_DETECTED                          │
  │      ▼                                         │
  │    PAUSED_BY_INTERVENTION                      │
  │      │                                         │
  │      │  dismissIntervention()                  │
  │      ▼                                         │
  │    RUNNING ◄───────────────────────────────────┘
  │                                        (Start Again)
  └────────────────────────────────────────────────┘
                       reset()
```

**State signals:**

| Signal | Type | States |
|---|---|---|
| `isRunning` | `boolean` | `true` → RUNNING; `false` → STOPPED, PAUSED, COMPLETED, or PAUSED_BY_INTERVENTION |
| `isComplete` | `boolean` | `true` → COMPLETED screen shown |
| `isPausedByIntervention` | `boolean` | `true` → paused because `IDLE_DETECTED` was received |

#### 5.4.3. Pomodoro / Break Duration Presets

##### 5.4.3.1. Default Presets (25/5, 50/10, Custom)

**Source** (`Sentinel.UI/src/utils.ts`, lines 1–6):

```typescript
export const PRESETS: TimerPreset[] = [
  { name: 'Classic', focus: 25, shortBreak: 5, longBreak: 15 },
  { name: 'Deep Work', focus: 50, shortBreak: 10, longBreak: 20 },
  { name: 'Sprint', focus: 15, shortBreak: 3, longBreak: 10 },
];
```

**Target:** Carried forward verbatim.

```typescript
// File: src/app/core/timer.utils.ts

export interface TimerPreset {
  name: string;
  focus: number;     // minutes
  shortBreak: number; // minutes
  longBreak: number;  // minutes
}

export const PRESETS: readonly TimerPreset[] = [
  { name: 'Classic', focus: 25, shortBreak: 5, longBreak: 15 },
  { name: 'Deep Work', focus: 50, shortBreak: 10, longBreak: 20 },
  { name: 'Sprint', focus: 15, shortBreak: 3, longBreak: 10 },
] as const;
```

##### 5.4.3.2. Custom Presets Persistence via Settings

Users can save their current timer durations as a named custom preset. Custom presets are stored in `AppSettings.customPresets` (→ §6.1.3.8) and persisted via `SAVE_SETTINGS` IPC → `settings.json` on the C# side, and to Firestore `users/{uid}/settings` when cloud sync is enabled.

**Source flow** (`Sentinel.UI/src/views.tsx`, SettingsScreen):
1. User sets custom durations and clicks "Save Current as Preset".
2. A name input appears. User enters a name and presses Enter or clicks Save.
3. The new preset is appended to `settings.customPresets[]`.
4. `onSaveSettings({ ...settings, customPresets: [...settings.customPresets, newPreset] })` is called.
5. The C# shell persists the full settings object.

**Target:** Same flow, but `saveSettings()` also writes to Firestore via `SettingsService`.

#### 5.4.4. Timer Screen UI

The `TimerComponent` renders the main timer view inside the `WorkspaceLayout`. It displays the circular progress ring, mode selector tabs, session name input, timer controls, preset panel, and session snapshot sidebar.

##### 5.4.4.1. Circular Progress Ring

**Source:** `ProgressRing` function component in `Sentinel.UI/src/views.tsx`.

An SVG circle with `radius=120`, `viewBox="0 0 280 280"`, rotating from 12-o'clock position (`-rotate-90`). The progress is visualized via `strokeDasharray` and `strokeDashoffset`:

```typescript
const circumference = 2 * Math.PI * radius; // 2π × 120 ≈ 753.98
const offset = circumference * (1 - progress / 100);
```

The accent color changes per timer mode:
- **Pomodoro:** `#7c4dff` (primary purple)
- **Short Break:** `#3ce36a` (tertiary green)
- **Long Break:** `#00affe` (secondary blue)

A `drop-shadow` filter (`0 0 16px ${accent}55`) creates a glow effect on the progress arc.

**Target:** Port as `ProgressRingComponent` in `src/app/shared/progress-ring/`. Same SVG structure, using `@Input() progress: number` (0–100) and `@Input() accent: string`.

##### 5.4.4.2. Start / Pause / Reset Controls

**Source:** Three control buttons rendered conditionally in `TimerScreen`:

- **Start Focus / Pause Session** — primary button, toggles between start and pause. Minimum width 10rem.
- **Reset** — secondary button, visible when `isRunning || isPausedByIntervention || timerProgress > 0`. If timer is running, shows a `ConfirmModal` before resetting.
- **End Session** — inline text button, visible when `timerMode === 'pomodoro' && (isRunning || timerProgress > 0)`. Triggers the early-end session flow (→ §5.4.5.2).

##### 5.4.4.3. Session Name Input

**Source:** `<input>` with `placeholder="Name this focus session..."` and CSS class `sentinel-input--subtle` (no visible border, transparent background, bottom accent on focus).

The session name is stored in `sessionName` state and passed to the session record on completion. It is optional — sessions can be unnamed.

##### 5.4.4.4. Daily Focus Goal Progress Indicator

**Source:** `calculateGoalProgress()` function (`Sentinel.UI/src/utils.ts`, lines 84–88):

```typescript
export function calculateGoalProgress(todayFocusSeconds: number, settings: Settings): number {
  if (settings.dailyFocusGoalMinutes <= 0) return 0;
  return Math.min(100, Math.round((todayFocusSeconds / (settings.dailyFocusGoalMinutes * 60)) * 100));
}
```

**Target:** Port verbatim to `src/app/core/timer.utils.ts`. The `todayFocusSeconds` value is computed by reading the Firestore daily aggregate document `users/{uid}/stats/daily/{YYYY-MM-DD}` (→ §6.2.3.1) on app startup and after each session completion. In the source, this value came from the C# shell via `SETTINGS_LOADED.todayFocusSeconds` (computed from SQLite). In the target, Angular reads it directly from Firestore.

**Sidebar display:** The "Progress Today" section card in the timer view shows: sessions completed, distraction count, and goal % as `InsightRow` components.

#### 5.4.5. Session Completion Flow

##### 5.4.5.1. Auto-Trigger on Timer Reaching Zero

When `remaining <= 0` in the tick loop:

1. Timer is stopped (`isRunning = false`, `isComplete = true`).
2. If `timerMode === 'pomodoro'`, a session completion record is created.
3. `PLAY_SOUND` IPC message is sent to the C# shell (→ §3.3.10).
4. The `SessionCompleteComponent` is rendered (modal overlay).

##### 5.4.5.2. Manual Early-End (`endedEarly` Flag)

**Source:** `handleEndSession()` in `App.tsx` — only available during pomodoro mode. Shows a `ConfirmModal` with the elapsed time before committing.

The source calculates:
```typescript
const totalDuration = getTimerDuration('pomodoro', settings);
const elapsed = totalDuration - timeLeft;
```

If `elapsed < 1`, the end-session button is a no-op (prevents zero-length sessions).

**Target:** Same logic. The `endedEarly` flag is set to `true` in the session event.

##### 5.4.5.3. Session Record Construction (Duration, StartedAt, CompletedAt, Name, EndedEarly)

**Source flow** (normal completion, `App.tsx` lines 282–293):

```typescript
const startedAt = new Date(sessionStartedAtRef.current ?? Date.now()).toISOString();
const duration = getTimerDuration('pomodoro', settingsRef.current);
postMessage({
  type: 'LOG_SESSION',
  durationSeconds: duration,
  sessionName: sessionNameRef.current || undefined,
  startedAt,
});
```

**Source flow** (early end, `App.tsx` lines 603–615):

```typescript
const startedAt = new Date(sessionStartedAtRef.current ?? Date.now()).toISOString();
postMessage({
  type: 'LOG_SESSION',
  durationSeconds: elapsed,
  sessionName: sessionName || undefined,
  startedAt,
  endedEarly: true,
});
```

**Target flow:**

In the target, the `LOG_SESSION` IPC message is **DROPPED** (→ §3.3.3). Instead, Angular writes session events directly to the Firestore Event Ledger:

```typescript
// File: src/app/core/timer.service.ts

private async completeSession(endedEarly: boolean): Promise<void> {
  const settings = this.settingsService.settings();
  const totalDuration = getTimerDuration('pomodoro', settings);
  const elapsed = endedEarly ? (totalDuration - this.timeLeft()) : totalDuration;
  const startedAt = this.sessionStartedAt
    ? new Date(this.sessionStartedAt).toISOString()
    : new Date().toISOString();
  const completedAt = new Date().toISOString();
  const sessionId = this.currentSessionId; // UUID generated at timer start

  // Update local counters
  this.sessionsCompletedToday.update(n => n + 1);
  this.todayFocusSeconds.update(n => n + elapsed);

  // Write Event Ledger entries to Firestore
  await this.eventLedgerService.writeEvent({
    type: endedEarly ? 'TimerEndedEarly' : 'TimerCompleted',
    sessionId,
    timestamp: completedAt,
    payload: {
      durationSeconds: elapsed,
      sessionName: this.sessionName() || null,
      startedAt,
      completedAt,
      endedEarly,
    },
  });

  // Play completion sound
  this.bridgeService.send('PLAY_SOUND', {});

  this.sessionStartedAt = null;
}
```

##### 5.4.5.4. Session Event Ledger Records (Replaces IPC `LOG_SESSION`)

Instead of sending `LOG_SESSION` to the C# shell (which would write to SQLite), Angular writes directly to `users/{uid}/session_events/{eventId}`. The event types for session lifecycle:

| Event Type | Payload | Trigger |
|---|---|---|
| `TimerStarted` | `{ sessionId, durationSeconds, sessionName, startedAt }` | User clicks Start |
| `TimerPaused` | `{ sessionId, pausedAt, timeLeftSeconds }` | User clicks Pause |
| `TimerCompleted` | `{ sessionId, durationSeconds, sessionName, startedAt, completedAt, endedEarly: false }` | Timer reaches zero |
| `TimerEndedEarly` | `{ sessionId, durationSeconds, sessionName, startedAt, completedAt, endedEarly: true }` | User ends session early |

See → §6.2.2 for the complete Event Ledger schema.

---

### 5.5. Distraction Intervention Flow (Captured Intervention)

The intervention flow is the defining UX feature of Sentinel. When the C# shell detects user idleness during a running timer, it sends `IDLE_DETECTED` via IPC. Angular freezes the timer, overlays a forced modal, and requires the user to categorize the distraction before resuming work.

**Source:** The entire flow is orchestrated in `App.tsx` via React state (`showIntervention`, `isPausedByIntervention`, `distractionInput`, `categorySelection`, etc.) and rendered by the `InterventionModal` component in `views.tsx`.

#### 5.5.1. Trigger: `IDLE_DETECTED` IPC Message Received

**Source** (`App.tsx` lines 197–204):

```typescript
case 'IDLE_DETECTED':
  if (isRunning) {
    wasRunningRef.current = true;
    setIsRunning(false);
    setIsPausedByIntervention(true);
    setShowIntervention(true);
    postMessage({ type: 'GET_TAXONOMY_DATA' });
  }
  break;
```

**Target:**

```typescript
// File: src/app/core/bridge.service.ts (message handler)

case 'IDLE_DETECTED':
  if (this.timerService.isRunning()) {
    this.timerService.pauseForIntervention();
    this.interventionService.show();
  }
  break;
```

**Key difference from source:** The source sends `GET_TAXONOMY_DATA` IPC to request fresh taxonomy data from the C# shell (SQLite). The target does NOT send this message — taxonomy data is loaded from Firestore snapshot listeners and is always current in memory.

**Hotkey trigger:** The source also triggers the intervention flow on `HOTKEY_DISTRACTION` (Ctrl+Shift+D). The target handles this identically — the C# shell sends `HOTKEY_DISTRACTION` via IPC, and Angular treats it the same as `IDLE_DETECTED`.

#### 5.5.2. Timer Freeze: Pause Timer State on Intervention

When `IDLE_DETECTED` arrives:

1. `timerService.pauseForIntervention()` is called.
2. This sets `isPausedByIntervention = true`, `isRunning = false`.
3. The `timerAnchor` is cleared (same as pause).
4. The `sessionStartedAt` is NOT cleared — the session clock continues for duration tracking.

```typescript
// File: src/app/core/timer.service.ts

pauseForIntervention(): void {
  this.clearInterval();
  this.timerAnchor = null;
  this.isRunning.set(false);
  this.isPausedByIntervention.set(true);
  this.bridgeService.send('TIMER_RUNNING', { running: false });
}
```

#### 5.5.3. Forced Overlay Modal (Non-Dismissible Without Input)

The `InterventionModalComponent` renders on top of all content. Per TARGET_ARCHITECTURE.md §4: "The user cannot dismiss this modal without categorizing the distraction via the Distraction Taxonomy."

**Source enforcement:** The source actually allows dismissal without input — clicking "False Alarm" or pressing Escape dismisses the modal. This is carried forward because "False Alarm" is itself a categorization (it writes a `FalseAlarmMarked` event). The Escape key also dismisses (calls `dismissIntervention()` which sends `INTERVENTION_DISMISSED` → target: `AUDITOR_CLEARED`).

**Target: `InterventionModalComponent` inputs and outputs:**

```typescript
// File: src/app/features/intervention/intervention-modal.component.ts

@Component({
  selector: 'app-intervention-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // template renders the intervention UI
})
export class InterventionModalComponent {
  // Injected services
  private taxonomyService = inject(TaxonomyService);
  private interventionService = inject(InterventionService);

  // Local state
  distractionInput = signal('');
  categorySelection = signal<string>('__auto__');
  newCategoryName = signal('');

  // Computed
  inferredCategory = computed(() => {
    const note = this.distractionInput().trim();
    if (!note) return null;
    return getMappedCategoryForNote(this.taxonomyService.groups(), note);
  });

  quickSuggestions = computed(() =>
    buildQuickSuggestions(this.taxonomyService.taxonomyData())
  );

  categoryOptions = computed(() =>
    this.taxonomyService.categories()
  );
}
```

##### 5.5.3.1. Distraction Note Text Input

An `<input type="text">` with `placeholder="What pulled you away?"`, `autofocus`. The value is bound to `distractionInput()`.

##### 5.5.3.2. Category Selection / Auto-Suggest

A `<select>` dropdown rendered when `distractionInput().trim()` is non-empty:

| Option Value | Display Text | Behavior |
|---|---|---|
| `__auto__` | `Suggested: {inferredCategoryName}` or `No category` | Uses `getMappedCategoryForNote()` result |
| `__none__` | `Keep uncategorized` | Forces `categoryName = null` |
| `{existing category}` | `{category name}` | Assigns the selected category |
| `__new__` | `Create new category` | Shows a secondary text input for the new category name |

##### 5.5.3.3. "False Alarm" Toggle (`IsFalseAlarm` Flag)

The "False Alarm" button dismisses the intervention without logging a distraction. In the target, this writes a `FalseAlarmMarked` event to the Event Ledger:

```typescript
async handleFalseAlarm(): Promise<void> {
  await this.eventLedgerService.writeEvent({
    type: 'FalseAlarmMarked',
    sessionId: this.timerService.currentSessionId,
    timestamp: new Date().toISOString(),
    payload: {},
  });
  this.interventionService.dismiss();
}
```

**Source:** The source sends `{ type: 'FALSE_ALARM' }` IPC to the C# shell, which increments a counter in SQLite. The target writes directly to Firestore.

##### 5.5.3.4. Quick Suggestion Pills (2 Recent + 3 Frequent)

**Source:** `buildQuickSuggestions()` in `Sentinel.UI/src/taxonomy.ts`. Returns up to 5 suggestions:

1. First 2: most recent distinct distraction notes from `taxonomyData.recentEntries`.
2. Next 3: most frequent distraction notes from `taxonomyData.groups`, sorted by `count` descending, then by `lastSeenAt` descending.
3. Deduplication: uses a `Set<string>` of normalized notes to prevent overlap.

**Target:** Carried forward verbatim. The `TaxonomyService` maintains `taxonomyData()` signal fed by Firestore snapshot listener on `users/{uid}/taxonomy/{categoryId}` and `users/{uid}/session_events` (for recent entries).

#### 5.5.4. Distraction Taxonomy Engine

##### 5.5.4.1. `normalizeDistractionNote()` — Lowercase, Trim, Collapse Whitespace

**Source** (`Sentinel.UI/src/taxonomy.ts`, lines 11–13):

```typescript
export function normalizeDistractionNote(note: string): string {
  return note.trim().toLowerCase();
}
```

**Target:** Carried forward verbatim to `src/app/core/taxonomy.utils.ts`.

##### 5.5.4.2. `getMappedCategoryForNote()` — Lookup Against Taxonomy Map

**Source** (`Sentinel.UI/src/taxonomy.ts`, lines 15–23):

```typescript
export function getMappedCategoryForNote(
  groups: DistractionGroup[],
  note: string,
): string | null {
  const normalized = normalizeDistractionNote(note);
  if (!normalized) return null;
  return groups.find((group) => group.normalizedNote === normalized)?.categoryName ?? null;
}
```

**Target:** Carried forward verbatim. The `groups` array comes from the `TaxonomyService` which reads Firestore `users/{uid}/taxonomy/{categoryId}` documents.

##### 5.5.4.3. `buildQuickSuggestions()` — Frequency + Recency Algorithm

**Source** (`Sentinel.UI/src/taxonomy.ts`, lines 25–66):

```typescript
export function buildQuickSuggestions(taxonomyData: TaxonomyData): QuickSuggestion[] {
  const suggestions: QuickSuggestion[] = [];
  const seen = new Set<string>();

  // Phase 1: 2 most recent distinct entries
  for (const entry of taxonomyData.recentEntries) {
    if (!entry.normalizedNote || seen.has(entry.normalizedNote)) continue;
    suggestions.push({
      note: entry.note,
      categoryName: entry.categoryName,
      source: 'Recent',
    });
    seen.add(entry.normalizedNote);
    if (suggestions.length >= 2) break;
  }

  // Phase 2: Most frequent groups
  const frequentGroups = [...taxonomyData.groups].sort((left, right) => right.count - left.count);
  for (const group of frequentGroups) {
    if (!group.normalizedNote || seen.has(group.normalizedNote)) continue;
    suggestions.push({
      note: group.note,
      categoryName: group.categoryName,
      source: 'Frequent',
    });
    seen.add(group.normalizedNote);
    if (suggestions.length >= 5) return suggestions;
  }

  // Phase 3: Fill remaining from most-recent groups
  const recentGroups = [...taxonomyData.groups].sort(
    (left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime(),
  );
  for (const group of recentGroups) {
    if (!group.normalizedNote || seen.has(group.normalizedNote)) continue;
    suggestions.push({
      note: group.note,
      categoryName: group.categoryName,
      source: 'Frequent',
    });
    seen.add(group.normalizedNote);
    if (suggestions.length >= 5) break;
  }

  return suggestions;
}
```

**Target:** Carried forward verbatim to `src/app/core/taxonomy.utils.ts`.

**Data source change:** In the source, `taxonomyData` comes from the C# shell via `TAXONOMY_DATA` IPC message (C# queries SQLite). In the target, the `TaxonomyService` maintains taxonomy data from Firestore snapshot listeners. The `TaxonomyData` interface is unchanged:

```typescript
// File: src/app/core/models.ts

export interface DistractionEntry {
  id: string; // Changed from number (SQLite auto-increment) to string (Firestore doc ID)
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  timestamp: string; // ISO 8601
}

export interface DistractionGroup {
  note: string;
  normalizedNote: string;
  categoryName: string | null;
  count: number;
  lastSeenAt: string; // ISO 8601
}

export interface TaxonomyData {
  recentEntries: DistractionEntry[];
  groups: DistractionGroup[];
  categories: string[];
}
```

#### 5.5.5. Submission: Firestore Event Ledger Write (Replaces IPC `LOG_DISTRACTION`)

**Source** (`App.tsx` lines 469–492):

```typescript
postMessage({
  type: 'LOG_DISTRACTION',
  note: cleanNote,
  categoryName: resolvedCategoryName,
  forceUncategorized,
});
```

The source sends the distraction to the C# shell, which writes to SQLite. It also optionally writes a separate Firestore document (`distractions` collection) if cloud sync is enabled.

**Target:**

```typescript
// File: src/app/features/intervention/intervention-modal.component.ts

async submitDistraction(note: string, categoryName: string | null): Promise<void> {
  const cleanNote = note.trim();
  if (!cleanNote) return;

  const normalizedNote = normalizeDistractionNote(cleanNote);
  const sessionId = this.timerService.currentSessionId;

  // Write to Event Ledger
  await this.eventLedgerService.writeEvent({
    type: 'DistractionLogged',
    sessionId,
    timestamp: new Date().toISOString(),
    payload: {
      note: cleanNote,
      normalizedNote,
      categoryName,
    },
  });

  // Update local distractions array for in-session display
  this.timerService.distractions.update(list => [...list, {
    note: cleanNote,
    categoryName,
    timestamp: new Date(),
  }]);

  // Update taxonomy in Firestore (note → category mapping)
  await this.taxonomyService.upsertMapping(normalizedNote, cleanNote, categoryName);

  this.interventionService.dismiss();
}
```

**Key differences from source:**
1. No IPC message to C# shell — Angular writes directly to Firestore.
2. No separate `distractions` flat collection — the distraction is recorded as a `DistractionLogged` event in the Event Ledger (`users/{uid}/session_events/{eventId}`).
3. The taxonomy mapping (`note → category`) is updated in Firestore `users/{uid}/taxonomy/{categoryId}` — not via IPC to C# SQLite.

#### 5.5.6. Timer Resume After Distraction Logged

After the distraction is logged (or a false alarm is recorded), the intervention modal is dismissed and the timer resumes automatically:

```typescript
// File: src/app/core/intervention.service.ts

dismiss(): void {
  this.isVisible.set(false);
  this.bridgeService.send('AUDITOR_CLEARED', {});

  if (this.timerService.isPausedByIntervention()) {
    this.timerService.resumeAfterIntervention();
  }
}
```

```typescript
// File: src/app/core/timer.service.ts

resumeAfterIntervention(): void {
  this.isPausedByIntervention.set(false);
  this.startTimer(); // Re-captures anchor, re-starts interval
}
```

**IPC message:** `AUDITOR_CLEARED` is sent to the C# shell (→ §3.3.2). This replaces the source's `INTERVENTION_DISMISSED`. The C# shell does nothing with this message except log it — it does not control the idle monitor lifecycle (the monitor is always running when the timer runs; it just re-fires if idle resumes).

---

### 5.6. Teams-Style Planner Module (New — Target Architecture)

**This is a NEW feature with no source equivalent.** The Planner module provides a Teams-style calendar grid where users schedule focus blocks in advance. It is specified in TARGET_ARCHITECTURE.md §4 ("Core Modules: Timer, Planner (Teams-style calendar), History, Reports, Settings, and Account").

#### 5.6.1. Calendar Grid Component (Day / Week / Month Views)

The `PlannerComponent` renders a multi-view calendar:

- **Day view:** Vertical time axis (00:00–23:59) with hourly gridlines. Focus blocks are rendered as positioned rectangles.
- **Week view:** 7-column grid with shared vertical time axis. Default view.
- **Month view:** Traditional 7×5/6 grid showing colored dots for days with scheduled blocks.

The calendar component should use an Angular-compatible library (e.g., `angular-calendar` or custom-built) that supports drag interactions.

#### 5.6.2. Focus Block Scheduling (Drag-to-Create, Resize, Move)

Users interact with the calendar via:

1. **Drag-to-create:** Click and drag on an empty time slot to create a new focus block.
2. **Resize:** Drag the bottom edge of an existing block to extend or shorten it.
3. **Move:** Drag the body of a block to a different time slot.
4. **Click to edit:** Click a block to open an inline editor (label, color, repeat rule).

#### 5.6.3. Planner Data Model (PlannedBlock)

```typescript
// File: src/app/core/models.ts

export interface PlannedBlock {
  id: string;            // Firestore doc ID
  userId: string;        // From Firebase Auth
  label: string;         // User-defined label, e.g., "Deep Work", "Writing"
  color: string;         // Hex color from a curated palette
  startTime: string;     // ISO 8601 datetime
  endTime: string;       // ISO 8601 datetime
  durationMinutes: number; // Cached for display, computed from start/end
  repeat: RepeatRule | null; // null = one-time block
  createdAt: string;     // ISO 8601
  updatedAt: string;     // ISO 8601
}

export interface RepeatRule {
  frequency: 'daily' | 'weekdays' | 'custom';
  customDays?: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
  until?: string;        // ISO 8601 date — end of recurrence (optional, null = indefinite)
}
```

#### 5.6.4. Recurring Block Rules (Daily, Weekday, Custom)

| Rule | Behavior |
|---|---|
| `daily` | Block repeats every day at the same time |
| `weekdays` | Block repeats Monday–Friday |
| `custom` | Block repeats on specific days of the week (e.g., Mon/Wed/Fri) |

Recurring blocks are expanded client-side for display. The Firestore document stores the base block with its repeat rule. The calendar component generates virtual instances for the display range.

#### 5.6.5. Planner ↔ Timer Integration (Auto-Start from Scheduled Block)

When the current time matches the `startTime` of a `PlannedBlock`, the Planner module can optionally auto-start the timer:

1. A notification banner appears: "Scheduled focus block: {label} — Start now?"
2. User confirms → `TimerService.startTimer()` is called with the block's `durationMinutes`.
3. The `sessionName` is pre-filled with the block's `label`.

This is an optional enhancement and may be deferred to a later release.

#### 5.6.6. Firestore Standard Persistence for Planner Documents

Planner blocks use Firestore's **Standard Persistence** path (not the Event Ledger). Angular writes directly to `users/{uid}/planner_blocks/{blockId}` using `setDoc`/`updateDoc`/`deleteDoc`.

```typescript
// Firestore path: users/{uid}/planner_blocks/{blockId}

// Example document:
{
  "label": "Deep Work",
  "color": "#7c4dff",
  "startTime": "2026-04-03T09:00:00.000Z",
  "endTime": "2026-04-03T10:30:00.000Z",
  "durationMinutes": 90,
  "repeat": {
    "frequency": "weekdays",
    "customDays": null,
    "until": null
  },
  "createdAt": "2026-04-01T12:00:00.000Z",
  "updatedAt": "2026-04-01T12:00:00.000Z"
}
```

**Firestore security rule** (→ §10):

```
match /users/{uid}/planner_blocks/{blockId} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

---

### 5.7. Reports & Analytics Module

The Reports module displays aggregated focus data: total focus time, session counts, distraction breakdowns by category, daily history timelines, and intervention accuracy metrics.

**Source:** `ReportsScreen` component in `Sentinel.UI/src/views.tsx`. Uses Recharts (`BarChart`, `PieChart`) for visualizations.

**Critical migration change:** In the source, report data comes from the C# shell via IPC `GET_REPORT_DATA` → SQLite query → `REPORT_DATA` response. In the target, all report data comes from Firestore. Angular reads server-computed aggregate documents (→ §6.2.3) and raw Event Ledger entries for detailed views.

#### 5.7.1. Report Data Source (Firestore Direct — No IPC)

**Source flow:**

```
Angular → IPC GET_REPORT_DATA { range } → C# ReportingService → SQLite Query → IPC REPORT_DATA { data } → Angular
```

**Target flow:**

```
Angular → Firestore query on users/{uid}/stats/daily/{date} + users/{uid}/session_events → Local aggregation → Display
```

The `ReportService` in Angular queries:

1. **Daily aggregates:** `users/{uid}/stats/daily/{YYYY-MM-DD}` — server-computed documents containing `{ totalFocusSeconds, sessionsCompleted, distractionsLogged, falseAlarms }`. These are written by Cloud Functions (→ §8).
2. **Session history:** `users/{uid}/session_events` where `type in ['TimerCompleted', 'TimerEndedEarly']`, ordered by `timestamp desc`, limited to the selected date range.
3. **Distraction breakdown:** `users/{uid}/session_events` where `type == 'DistractionLogged'`, grouped client-side by `payload.categoryName`.

**Fallback for offline/first-use:** If daily aggregate documents don't exist yet (e.g., Cloud Functions haven't processed events yet, or user is offline without prior sync), Angular falls back to client-side aggregation from cached Event Ledger entries in Firestore's IndexedDB persistence.

#### 5.7.2. Focus Time Summary (Total Hours, Session Count)

**Source `ReportData` interface** (`Sentinel.UI/src/app-types.ts`, lines 7–18):

```typescript
export interface ReportData {
  totalFocusSeconds: number;
  sessionsCompleted: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  dailyFocus: { date: string; focusSeconds: number; sessions: number; distractions: number }[];
  topCategories: ReportBreakdownItem[];
  topDistractions: ReportBreakdownItem[];
  recentSessions: SessionHistoryEntry[];
}
```

**Target** — same interface structure, but computed from Firestore data:

```typescript
// File: src/app/core/models.ts

export interface ReportData {
  totalFocusSeconds: number;
  sessionsCompleted: number;
  distractionsLogged: number;
  falseAlarms: number;
  avgSessionSeconds: number;
  dailyFocus: DailyFocusEntry[];
  topCategories: ReportBreakdownItem[];
  topDistractions: ReportBreakdownItem[];
  recentSessions: SessionHistoryEntry[];
}

export interface DailyFocusEntry {
  date: string; // YYYY-MM-DD
  focusSeconds: number;
  sessions: number;
  distractions: number;
}

export interface ReportBreakdownItem {
  name: string;
  count: number;
  categoryName?: string | null;
}

export interface SessionHistoryEntry {
  sessionId: string;
  startedAt: string;    // ISO 8601
  completedAt: string | null;
  durationSeconds: number;
  completed: boolean;
  endedEarly: boolean;
  sessionName: string | null;
  distractionsCount: number;
  falseAlarmCount: number;
}
```

Metric cards rendered in a 4-column grid: Focus Time, Sessions, Categories, Distractions.

#### 5.7.3. Distraction Breakdown (Category Pie Chart, Frequency Bar Chart)

**Source:** `ReportsScreen` renders a Recharts `PieChart` for top categories with the `COLORS` palette (`['#7c4dff', '#00affe', '#3ce36a', '#f59e0b', '#ec4899', '#ef4444']`). Below it, an `InsightRow` list with color-coded bars.

**Target:** Replace Recharts with an Angular charting library (e.g., `ng2-charts` wrapping Chart.js, or `ngx-echarts`). The chart configuration:

- **Pie chart:** Inner radius 42, outer radius 68, data from `reportData.topCategories`.
- **Colors:** Same `CHART_COLORS` array.
- **Tooltip:** Dark-themed (`background: '#201f1f'`, `border: '1px solid rgba(73, 68, 85, 0.25)'`, `borderRadius: 16px`).

#### 5.7.4. Daily History Timeline (Bar Chart)

**Source:** `ReportsScreen` renders a Recharts `BarChart` with focus minutes per day. X-axis shows date strings, Y-axis is hidden, bars use `#7c4dff` fill with `radius: [10, 10, 0, 0]` (rounded top corners).

**Target:** Same configuration with the Angular charting library.

#### 5.7.5. Date Range Selector (Since Date Filter)

**Source range options:**

```typescript
const RANGE_OPTIONS: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'all', label: 'All' },
];
```

**Target:** Carried forward verbatim. The `ReportRange` type: `'today' | 'week' | 'month' | 'all'`.

**Date calculation:**

```typescript
const since =
  range === 'today'  ? startOfToday()
  : range === 'week' ? new Date(Date.now() - 7 * 86_400_000)
  : range === 'month'? new Date(Date.now() - 30 * 86_400_000)
  : new Date(0); // 'all' — epoch
```

#### 5.7.6. Daily Focus Goal vs. Actual Visualization

The daily focus goal is displayed in the "Progress Today" sidebar card on the timer screen and as Intervention Accuracy metrics on the reports screen. The goal percentage is computed by `calculateGoalProgress()` (→ §5.4.4.4).

The reports screen additionally shows an "Intervention Accuracy" section card:

```typescript
const total = distractionsLogged + falseAlarms;
const accuracy = total === 0 ? 100 : Math.round(((total - falseAlarms) / total) * 100);
```

Displayed as a large percentage with explanatory text.

---

### 5.8. Session History Module

The Session History module provides a dedicated paginated list of all completed focus sessions with detail cards.

**Source:** `SessionHistoryScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.8.1. Paginated Session List (Firestore Query — No IPC)

**Source:** The source requests session history via `GET_REPORT_DATA` IPC (same as reports). The `reportData.recentSessions` array is displayed.

**Target:** The `HistoryComponent` queries Firestore directly:

```typescript
// Firestore query:
// users/{uid}/session_events
// where type in ['TimerCompleted', 'TimerEndedEarly']
// orderBy timestamp desc
// limit pageSize

const sessionsQuery = query(
  collection(db, `users/${uid}/session_events`),
  where('type', 'in', ['TimerCompleted', 'TimerEndedEarly']),
  orderBy('timestamp', 'desc'),
  limit(PAGE_SIZE),
);
```

**Pagination:** Client-side pagination using `startAfter()` cursor-based Firestore pagination for subsequent pages.

**Page size:** 10 items per page (matching source `PAGE_SIZE = 10`).

#### 5.8.2. Session Detail Card (Name, Duration, Start/End, EarlyEnd Badge)

Each session card renders:

| Field | Source | Display |
|---|---|---|
| Session name | `payload.sessionName` or fallback to date | Bold title |
| Start time | `payload.startedAt` | `toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})` |
| End time | `payload.completedAt` | Same format, separated by "—" |
| Duration | `payload.durationSeconds` | `formatDuration()` (e.g., "25m", "1h 30m") |
| Ended early | `type === 'TimerEndedEarly'` | Amber badge "Ended early" |
| Distraction count | Count of `DistractionLogged` events with same `sessionId` | "{n} distraction(s)" |
| False alarm count | Count of `FalseAlarmMarked` events with same `sessionId` | "{n} false alarm(s)" |
| Clean session | No distractions, no false alarms, not ended early | "Clean session" |

**Summary strip:** Above the session list, three `MetricCard` components show Total Focus, Sessions count, and Total Distractions for the selected range.

#### 5.8.3. Distraction Log Per Session

For the target, the distraction log per session is derived from Event Ledger queries:

```typescript
// For a given sessionId, get all DistractionLogged and FalseAlarmMarked events:
const distractionsQuery = query(
  collection(db, `users/${uid}/session_events`),
  where('sessionId', '==', sessionId),
  where('type', 'in', ['DistractionLogged', 'FalseAlarmMarked']),
  orderBy('timestamp', 'asc'),
);
```

This replaces the source's `distractionsCount` and `falseAlarmCount` fields which were pre-computed by the C# `ReportingService` from SQLite.

---

### 5.9. Taxonomy Manager Module

The Taxonomy Manager allows users to organize, rename, and re-categorize their logged distraction labels. It provides a searchable, paginated list of distraction groups and a category editor.

**Source:** `TaxonomyManagerScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.9.1. Full Taxonomy Tree View

The taxonomy view is a two-column layout:

- **Left column (60%):** "Manage Labels" — searchable, filterable list of `DistractionGroup` entries. Each group shows the distraction note, its current category (or "Uncategorized"), occurrence count, and an expandable editor.
- **Right column (40%):** "Categories" list + "Recent Logs" list.

**Summary strip:** Four `MetricCard` components: Labels count, Categorized %, Categories count, Total Logs count.

**Filters:**
- Search input: filters by note text or category name (case-insensitive).
- "All" / "Uncategorized" toggle pills: filters to show only uncategorized entries.

#### 5.9.2. Category Rename Operation (Firestore Direct — No IPC)

**Source:** Sends `RENAME_CATEGORY` IPC to C# shell, which runs a SQLite UPDATE on all distractions with the old category name.

**Target:** Angular updates the Firestore taxonomy documents directly:

```typescript
// File: src/app/core/taxonomy.service.ts

async renameCategory(oldName: string, newName: string): Promise<void> {
  // Query all taxonomy docs with categoryName === oldName
  const snap = await getDocs(
    query(
      collection(db, `users/${uid}/taxonomy`),
      where('categoryName', '==', oldName),
    ),
  );

  const batch = writeBatch(db);
  snap.docs.forEach(doc => {
    batch.update(doc.ref, { categoryName: newName.trim() });
  });
  await batch.commit();
}
```

#### 5.9.3. Note → Category Remap Operation

The `TaxonomyGroupEditor` component allows the user to change the category assigned to a distraction note group:

1. User expands a group row.
2. Selects a different category from the dropdown (or creates a new one).
3. Clicks "Save".
4. Angular calls `taxonomyService.upsertMapping(normalizedNote, note, newCategoryName)`.

**Source:** Sends `UPDATE_DISTRACTION_GROUP` IPC with `{ normalizedNote, note, categoryName }` to C# shell.

**Target:** Angular writes directly to Firestore taxonomy collection.

#### 5.9.4. Uncategorized Distraction Triage Workflow

The "Uncategorized" filter pill shows only distraction groups where `categoryName === null`. This is the primary triage workflow: users review their uncategorized distractions and assign categories to improve reporting accuracy.

**Metric tracking:** The "Categorized %" metric card shows:

```typescript
const categorizedPct = groups.length
  ? Math.round(((groups.length - uncategorizedCount) / groups.length) * 100)
  : 0;
```

---

### 5.10. Settings Module

The Settings module provides controls for all user-configurable parameters. Settings are persisted to both the C# shell (`settings.json` via IPC `SAVE_SETTINGS`) and Firestore (`users/{uid}/settings` via direct write when cloud sync is enabled).

**Source:** `SettingsScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.10.1. Pomodoro Duration Settings

**Input:** Three `NumberField` inputs in a 3-column grid:
- Focus: `settings.pomodoroMinutes`, range `[1, 120]`
- Short Break: `settings.shortBreakMinutes`, range `[1, 30]`
- Long Break: `settings.longBreakMinutes`, range `[1, 60]`

Each change calls `updateSetting(key, value)` → `onSaveSettings({...settings, [key]: value})` → IPC `SAVE_SETTINGS`.

#### 5.10.2. Break Duration Settings

Handled by the same fields as §5.10.1 (Short Break and Long Break columns).

#### 5.10.3. Idle Threshold Adjustment (Seconds Slider)

**Source:** `<input type="range" min={10} max={300} step={5}>` bound to `settings.idleThresholdSeconds`.

**Dynamic hint text:**

```typescript
settings.idleThresholdSeconds <= 30
  ? 'Very sensitive — triggers quickly after you stop moving.'
  : settings.idleThresholdSeconds <= 60
    ? 'Balanced — gives you a moment to think before flagging.'
    : settings.idleThresholdSeconds <= 120
      ? 'Relaxed — ideal if you read or study between sessions.'
      : 'Very relaxed — long pauses are allowed before intervention.';
```

#### 5.10.4. Always-On-Top Toggle

A `sentinel-toggle-row` switch button bound to `settings.alwaysOnTop`. When toggled, the IPC `SAVE_SETTINGS` message carries the new value. The C# shell reads `settings.AlwaysOnTop` and calls `_window.SetTopMost(value)`.

#### 5.10.5. Suppress During Media Toggle

A toggle switch bound to `settings.suppressDuringMedia`. Labels: "Active" / "Disabled". Description dynamically changes to explain the current behavior.

#### 5.10.6. Daily Focus Goal (Minutes)

**Input:** Single `NumberField` for `settings.dailyFocusGoalMinutes`, range `[0, 1440]`. `0` disables the goal indicator.

#### 5.10.7. Overlay Style Preference

**Source:** Not exposed in the settings UI in the current source (the `overlayStyle` property exists on `Settings` but the UI dropdown was not implemented in `SettingsScreen`).

**Target:** Add a dropdown or segmented control to select between `'pill'`, `'compact'`, and `'monitoring'` overlay styles. Persisted in `settings.overlayStyle`.

#### 5.10.8. Cloud Sync Enable/Disable Toggle

An inline toggle switch with a custom-styled track (purple when enabled, gray when disabled). Labels: "Enabled" / "Disabled". Sub-text dynamically indicates whether data syncs to the cloud or stays local.

#### 5.10.9. Custom Preset Management (Add / Edit / Delete)

Three operations:

1. **Add:** When current timer durations don't match any built-in preset, a "Save Current as Preset" button appears. Clicking it reveals a name input. The new preset is appended to `settings.customPresets[]`.
2. **Delete:** Each custom preset has a small `×` button in the top-right corner. Clicking it shows a `ConfirmModal`: "Delete '{name}'? This cannot be undone." Confirmed → preset is removed from the array.
3. **Apply:** Clicking any preset (built-in or custom) immediately updates the timer durations and calls `saveSettings()`.

**Duplicate name prevention:** The source checks `settings.customPresets.some(p => p.name.toLowerCase() === newName.toLowerCase())` to disable the Save button if the name already exists.

#### 5.10.10. Active Window Whitelist Editor (New — Target Architecture)

**This is a NEW feature introduced in §4.4.** The settings UI must include an editor for the `activeWindowWhitelist` setting.

**UI design:**

```
┌───────────────────────────────────────────────┐
│ Active Window Whitelist                       │
│ Apps that prevent idle detection when focused.│
│                                               │
│ ┌───────────────────┐  ┌─────┐               │
│ │ code.exe          │  │ Add │               │
│ └───────────────────┘  └─────┘               │
│                                               │
│ ┌────────────────────────────────────┐        │
│ │ code                          [×]  │        │
│ │ devenv                        [×]  │        │
│ │ chrome                        [×]  │        │
│ └────────────────────────────────────┘        │
└───────────────────────────────────────────────┘
```

- A text input for entering process names.
- An "Add" button to append to the list.
- Each entry has a `×` button to remove it.
- The `.exe` extension is stripped on display (normalization is done by the C# `ActiveWindowMonitor.SetWhitelist()` method, → §4.4.3).
- Changes are persisted via `saveSettings()` → IPC `SAVE_SETTINGS` + Firestore write.

---

### 5.11. Account & Auth Module

The Account module provides Firebase Authentication integration for optional cloud sync.

**Source:** `AuthScreen` component in `Sentinel.UI/src/views.tsx`.

#### 5.11.1. Firebase Auth Integration (Email/Password, Google Sign-In)

**Source** (`Sentinel.UI/src/firebase.ts`):

```typescript
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
```

**Target:**

```typescript
// File: src/app/core/auth.service.ts

import { Injectable, signal } from '@angular/core';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { firebaseApp } from './firebase.config';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private auth = getAuth(firebaseApp);
  private googleProvider = new GoogleAuthProvider();

  readonly user = signal<User | null>(null);
  readonly user$ = new Observable<User | null>(subscriber => {
    return onAuthStateChanged(this.auth, user => subscriber.next(user));
  });

  constructor() {
    onAuthStateChanged(this.auth, user => this.user.set(user));
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.auth, email, password);
  }

  async signUpWithEmail(email: string, password: string): Promise<void> {
    await createUserWithEmailAndPassword(this.auth, email, password);
  }

  async signInWithGoogle(): Promise<void> {
    try {
      await signInWithPopup(this.auth, this.googleProvider);
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' || code === 'auth/user-cancelled') {
        await signInWithRedirect(this.auth, this.googleProvider);
      } else {
        throw err;
      }
    }
  }

  async signOut(): Promise<void> {
    await signOut(this.auth);
  }

  get uid(): string | null {
    return this.user()?.uid ?? null;
  }

  get email(): string | null {
    return this.user()?.email ?? null;
  }
}
```

**Error mapping** (carried forward from source `App.tsx`):

| Firebase Error Code | User-Facing Message |
|---|---|
| `auth/user-not-found`, `auth/invalid-credential`, `auth/invalid-login-credentials` | "No account found with this email. Please sign up first." |
| `auth/wrong-password` | "Incorrect password. Please try again." |
| `auth/too-many-requests` | "Too many failed attempts. Please try again later." |
| `auth/invalid-email` | "Invalid email address." |
| `auth/email-already-in-use` | "An account with this email already exists. Please log in instead." |
| `auth/weak-password` | "Password is too weak. Use at least 6 characters." |
| *(default)* | `error.message` or "Login failed. Please try again." |

#### 5.11.2. Auth State Listener & User Context Provider

**Source** (`App.tsx` lines 164–172):

```typescript
useEffect(() => {
  const unsubscribe = onAuthStateChanged(auth, (user) => {
    setUser(user);
    if (!user) {
      setReportData(null);
      setExportStatus(null);
    }
  });
  return () => unsubscribe();
}, []);
```

**Target:** The `AuthService.user` signal is reactive. Components inject `AuthService` and read `authService.user()` or `authService.email` in templates.

When the user signs out (`user` becomes `null`):
1. Firestore snapshot listeners are detached.
2. Local cached data is cleared.
3. The app continues to function in local-only mode.

#### 5.11.3. Sign-In / Sign-Up / Sign-Out Screens

The `AccountComponent` renders two states:

**Signed out:**
- Email input field
- Password input field
- Login button (primary)
- Sign Up button (secondary)
- "or" divider
- "Continue with Google" button (styled with Google favicon)
- Error message area

**Signed in:**
- "Signed In As" card showing email
- Logout button (danger style)
- Contextual info cards: "Zero-friction local mode" and "Optional universal sync"

#### 5.11.4. Account Profile Display

When signed in, the user's email is displayed in:
1. The Account screen ("Signed In As: {email}")
2. The sidebar bottom area (truncated email)
3. The Settings screen's Account field ("Manage {username}")

No profile photo or display name is shown — Sentinel uses email-only identity.

---

### 5.12. Onboarding Flow

The onboarding flow is a one-time modal wizard shown on first launch.

**Source:** `OnboardingModal` component in `Sentinel.UI/src/views.tsx`, triggered by `localStorage.getItem('sentinel_onboarded') !== 'true'`.

#### 5.12.1. First-Launch Detection

**Source:**

```typescript
const [showOnboarding, setShowOnboarding] = useState(() => {
  return localStorage.getItem('sentinel_onboarded') !== 'true';
});
```

**Target:** The Angular app uses the same `localStorage` check in the `AppComponent`:

```typescript
readonly showOnboarding = signal(localStorage.getItem('sentinel_onboarded') !== 'true');
```

When running inside Photino's WebView, `localStorage` is persisted via the Chromium profile directory. This persists across app restarts.

#### 5.12.2. Onboarding Modal Wizard (Welcome, Preset Selection, Goal Setting)

**Source step definitions** (`App.tsx` lines 873–886):

```typescript
const onboardingSteps = [
  {
    title: 'Welcome to Sentinel',
    body: 'A privacy-first focus timer that gently nudges you back when you drift.',
  },
  {
    title: 'How It Works',
    body: 'Sentinel detects when you stop interacting with your PC and pauses to ask what distracted you.',
  },
  {
    title: 'Keyboard Shortcuts',
    body: 'Ctrl+Shift+S to start/pause. Ctrl+Shift+D to log a distraction. Space to toggle timer. Esc to go back.',
  },
  {
    title: 'Your Data Stays Local',
    body: 'Everything is stored on your machine. Cloud sync is opt-in via Settings.',
  },
];
```

**Target:** Carried forward verbatim as the step array.

**Modal UI:** Step indicator dots (circles, active = `#7c4dff`, inactive = `rgba(148, 142, 161, 0.32)`), "Skip intro" ghost button, "Back" secondary button (hidden on first step), "Next" / "Enter Sentinel" (last step) primary button.

#### 5.12.3. Initial Settings Persistence on Completion

**Source:**

```typescript
const completeOnboarding = () => {
  localStorage.setItem('sentinel_onboarded', 'true');
  setShowOnboarding(false);
};
```

**Target:** Same implementation. The onboarding does not currently persist any settings (no preset selection or goal setting happens during onboarding in the source). Future enhancement: the onboarding wizard could include a step for choosing a default preset and setting the daily focus goal.

---

### 5.13. Core Services Summary

| Service | File | Scope | Responsibility |
|---|---|---|---|
| `BridgeService` | `src/app/core/bridge.service.ts` | `providedIn: 'root'` | IPC send/receive with C# shell (→ §3) |
| `TimerService` | `src/app/core/timer.service.ts` | `providedIn: 'root'` | Drift-free timer engine, session lifecycle |
| `SettingsService` | `src/app/core/settings.service.ts` | `providedIn: 'root'` | Load/save settings via IPC + Firestore |
| `AuthService` | `src/app/core/auth.service.ts` | `providedIn: 'root'` | Firebase Auth state management |
| `InterventionService` | `src/app/core/intervention.service.ts` | `providedIn: 'root'` | Intervention modal visibility and state |
| `TaxonomyService` | `src/app/core/taxonomy.service.ts` | `providedIn: 'root'` | Firestore taxonomy CRUD + quick suggestions |
| `EventLedgerService` | `src/app/core/event-ledger.service.ts` | `providedIn: 'root'` | Append-only writes to `session_events` |
| `ReportService` | `src/app/core/report.service.ts` | `providedIn: 'root'` | Firestore aggregate queries for reports |
| `PlannerService` | `src/app/core/planner.service.ts` | `providedIn: 'root'` | Firestore CRUD for planner blocks |

### 5.14. Keyboard Shortcuts

**Source shortcuts** (displayed in settings, handled in `App.tsx` keydown listener and C# `WndProc` hotkeys):

| Shortcut | Source Handler | Target Handler | Behavior |
|---|---|---|---|
| `Ctrl+Shift+S` | C# `WndProc` sends `HOTKEY_START_PAUSE` IPC | Same — C# sends IPC, Angular calls `timerService.toggleStartPause()` | Start or pause the timer |
| `Ctrl+Shift+D` | C# `WndProc` sends `HOTKEY_DISTRACTION` IPC | Same — Angular triggers intervention flow | Log a distraction immediately |
| `Space` | Angular `keydown` listener on `view === 'timer'` | Same — `timerService.toggleStartPause()` | Toggle the active timer |
| `Escape` | Angular `keydown` listener | Same | Go back or dismiss current surface |
| `Enter` | Angular `keydown` listener on resume prompt | Same — resumes timer after sleep | Confirm resume |

### 5.15. IPC Message Handling — Angular `BridgeService` Inbound Dispatch

Complete dispatch table for messages received from the C# shell, with the Angular handler for each:

| IPC Message | Angular Handler |
|---|---|
| `SETTINGS_LOADED` | `settingsService.applySettings(payload.settings)` |
| `IDLE_DETECTED` | `if (timerService.isRunning()) { timerService.pauseForIntervention(); interventionService.show(); }` |
| `USER_ACTIVE` | No-op (reserved for future UX hint) |
| `SNOOZE_STATUS` | `timerService.updateSnoozeState(payload.isSnoozed, payload.secondsRemaining)` |
| `HOTKEY_START_PAUSE` | `timerService.toggleStartPause()` |
| `HOTKEY_DISTRACTION` | Same as `IDLE_DETECTED` |
| `SYSTEM_SUSPEND` | `if (timerService.isRunning()) { timerService.pauseTimer(); showResumePrompt = true; }` |
| `SYSTEM_RESUME` | `if (wasPausedBySuspend) { showResumePrompt = true; }` |
| `UPDATE_AVAILABLE` | `settingsService.updateInfo.set(payload)` |
| `COMPACT_MODE_CHANGED` | `appComponent.isCompactMode.set(payload.isCompact)` |

**Dropped inbound handlers** (these exist in the source but are removed because Angular no longer receives data from C#):

| Source IPC Message | Reason Dropped |
|---|---|
| `REPORT_DATA` | Angular reads reports from Firestore directly |
| `TAXONOMY_DATA` | Angular reads taxonomy from Firestore directly |
| `SESSION_LIST` | Angular reads session history from Firestore directly |
| `EXPORT_COMPLETE` | Export feature is handled by Angular (CSV/JSON from Firestore data) |
| `SEED_COMPLETE` | Database seeding is removed (no SQLite) |

### 5.16. Cross-Reference Table

| Section | Source File | Target File/Module | Status |
|---|---|---|---|
| §5.1 | `Sentinel.UI/package.json`, `vite.config.ts`, `tsconfig.json` | `angular.json`, `tsconfig.json` | REWRITTEN |
| §5.2 | `Sentinel.UI/src/ui.tsx`, `ui-utils.ts` | `src/app/shared/` components | REWRITTEN |
| §5.3 | `App.tsx` (view state + conditional rendering) | `src/app/app.routes.ts` | REWRITTEN |
| §5.4 | `App.tsx` (timer hooks + refs) | `src/app/core/timer.service.ts`, `src/app/features/timer/` | REWRITTEN |
| §5.5 | `App.tsx` (intervention handlers), `views.tsx` (InterventionModal), `taxonomy.ts` | `src/app/features/intervention/`, `src/app/core/taxonomy.utils.ts` | REWRITTEN + PORTED |
| §5.6 | *(no source)* | `src/app/features/planner/` | NEW |
| §5.7 | `App.tsx` (report handlers), `views.tsx` (ReportsScreen) | `src/app/features/reports/` | REWRITTEN |
| §5.8 | `views.tsx` (SessionHistoryScreen) | `src/app/features/history/` | REWRITTEN |
| §5.9 | `views.tsx` (TaxonomyManagerScreen) | `src/app/features/taxonomy/` | REWRITTEN |
| §5.10 | `views.tsx` (SettingsScreen) | `src/app/features/settings/` | REWRITTEN + NEW (§5.10.10) |
| §5.11 | `App.tsx` (auth handlers), `views.tsx` (AuthScreen), `firebase.ts` | `src/app/features/account/`, `src/app/core/auth.service.ts` | REWRITTEN |
| §5.12 | `views.tsx` (OnboardingModal), `App.tsx` (onboarding state) | `src/app/features/onboarding/` | REWRITTEN |
| §5.13 | `App.tsx` (all business logic) | `src/app/core/` services | REWRITTEN |
| §5.14 | `App.tsx` (keydown listener), `MainWindow.xaml.cs` (WndProc) | `src/app/core/keyboard.service.ts` + C# shell | PORTED |
| §5.15 | `App.tsx` (`handleMessage` switch) | `src/app/core/bridge.service.ts` | REWRITTEN |
