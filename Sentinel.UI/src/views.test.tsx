import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  AuthScreen,
  InterventionModal,
  ReportsScreen,
  SettingsScreen,
  TaxonomyManagerScreen,
} from './views';
import { defaultSettings } from './utils';

describe('SettingsScreen', () => {
  it('renders grouped settings sections inside the shared shell', () => {
    const { container } = render(
      <SettingsScreen
        settings={defaultSettings}
        exportStatus={null}
        updateInfo={null}
        userEmail={null}
        onBack={vi.fn()}
        onSaveSettings={vi.fn()}
        onApplyPreset={vi.fn()}
        onExport={vi.fn()}
        onOpenAuth={vi.fn()}
        onOpenTaxonomy={vi.fn()}
        onDismissUpdate={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByLabelText('Back to timer')).toBeInTheDocument();
    expect(container.querySelector('[data-ui="screen-shell"]')).toBeInTheDocument();
    expect(screen.getByText('Timer & Presets')).toBeInTheDocument();
    expect(screen.getByText('Idle & Behavior')).toBeInTheDocument();
    expect(screen.getByText('Goals & Export')).toBeInTheDocument();
    expect(screen.getByText('Account & Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Data Organization')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Manage Categories' }).length).toBeGreaterThan(0);
  });
});

describe('ReportsScreen', () => {
  it('renders the shared report shell with filters and empty state', () => {
    const { container } = render(
      <ReportsScreen
        reportRange="week"
        reportLoading={false}
        reportData={null}
        onBack={vi.fn()}
        onSelectRange={vi.fn()}
        onOpenTaxonomy={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByLabelText('Back to timer')).toBeInTheDocument();
    expect(container.querySelector('[data-ui="screen-shell"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Week' })).toBeInTheDocument();
    expect(screen.getByText('No data available')).toBeInTheDocument();
  });
});

describe('InterventionModal', () => {
  it('renders quick pills and category controls for faster logging', () => {
    render(
      <InterventionModal
        distractionInput="twitter"
        categorySelection="__auto__"
        newCategoryName=""
        inferredCategoryName="Social Media"
        categoryOptions={['Social Media', 'Messaging']}
        quickSuggestions={[
          { note: 'twitter', categoryName: 'Social Media', source: 'Recent' },
          { note: 'instagram', categoryName: 'Social Media', source: 'Frequent' },
        ]}
        onDistractionChange={vi.fn()}
        onCategorySelectionChange={vi.fn()}
        onNewCategoryChange={vi.fn()}
        onSubmit={vi.fn()}
        onQuickLog={vi.fn()}
        onFalseAlarm={vi.fn()}
        onSnooze={vi.fn()}
        onWatchingContent={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Quick distraction suggestions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /twitter/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Distraction category')).toBeInTheDocument();
    expect(screen.getByText('Current category: Social Media')).toBeInTheDocument();
  });
});

describe('TaxonomyManagerScreen', () => {
  it('renders taxonomy editing controls and recent history', () => {
    render(
      <TaxonomyManagerScreen
        taxonomyData={{
          recentEntries: [
            {
              id: 1,
              note: 'twitter',
              normalizedNote: 'twitter',
              categoryName: 'Social Media',
              timestamp: new Date().toISOString(),
            },
          ],
          groups: [
            {
              note: 'twitter',
              normalizedNote: 'twitter',
              categoryName: 'Social Media',
              count: 4,
              lastSeenAt: new Date().toISOString(),
            },
          ],
          categories: ['Social Media'],
        }}
        onBack={vi.fn()}
        onSaveGroup={vi.fn()}
        onRenameCategory={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Distraction Taxonomy' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search distraction labels or categories')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });
});

describe('AuthScreen', () => {
  it('renders account auth controls inside the shared shell', () => {
    const { container } = render(
      <AuthScreen
        userEmail={null}
        authEmail=""
        authPassword=""
        authError=""
        onAuthEmailChange={vi.fn()}
        onAuthPasswordChange={vi.fn()}
        onLogin={vi.fn()}
        onSignup={vi.fn()}
        onLogout={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByLabelText('Back to timer')).toBeInTheDocument();
    expect(container.querySelector('[data-ui="screen-shell"]')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Up' })).toBeInTheDocument();
  });
});
