/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { Link } from '@tanstack/react-router'
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  CreditCard,
  Download,
  FileText,
  KeyRound,
  ListChecks,
  RadioTower,
  TerminalSquare,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  CardStaggerContainer,
  CardStaggerItem,
} from '@/components/page-transition'
import { Button } from '@/components/ui/button'
import { ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import {
  useApiInfo,
  useDashboardContentVisibility,
} from '../../hooks/use-status-data'
import { AnnouncementsPanel } from './announcements-panel'
import { ApiInfoPanel } from './api-info-panel'
import { DesktopSetupCard } from './desktop-setup-card'
import { DesktopSetupDialog } from './desktop-setup-dialog'
import { FAQPanel } from './faq-panel'
import { PerformanceHealthPanel } from './performance-health-panel'
import { SummaryCards } from './summary-cards'
import { UptimePanel } from './uptime-panel'

const SETUP_GUIDE_VISIBILITY_STORAGE_KEY =
  'dashboard_overview_setup_guide_expanded'

const SETUP_GUIDE_CODE_PATTERN = [
  'const request = await client.responses.create({',
  "  model: 'gpt-4.1-mini',",
  "  input: 'Start routing traffic',",
  '})',
  '',
  'if (request.output_text) {',
  '  console.log(request.output_text)',
  '}',
].join('\n')

type DashboardActionPath =
  | '/keys'
  | '/wallet'
  | '/playground'
  | '/channels'
  | '/usage-logs'
  | '/pricing'

interface StartStep {
  title: string
  description: string
  to?: DashboardActionPath
  onClick?: () => void
  icon: LucideIcon
  completed: boolean
}

interface QuickAction {
  title: string
  description: string
  to: DashboardActionPath
  icon: LucideIcon
  adminOnly?: boolean
}

function getSavedSetupGuideExpanded(): boolean | null {
  if (typeof window === 'undefined') return null
  const saved = window.localStorage.getItem(SETUP_GUIDE_VISIBILITY_STORAGE_KEY)
  if (saved === 'expanded') return true
  if (saved === 'collapsed') return false
  return null
}

function saveSetupGuideExpanded(expanded: boolean): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(
    SETUP_GUIDE_VISIBILITY_STORAGE_KEY,
    expanded ? 'expanded' : 'collapsed'
  )
}

function getCurrentOrigin(): string {
  if (typeof window === 'undefined') return ''
  return window.location.origin
}

function normalizeEndpoint(sourceUrl?: string): string {
  const fallback = `${getCurrentOrigin()}/v1/chat/completions`
  const trimmed = sourceUrl?.trim()
  if (!trimmed) return fallback

  const withoutTrailingSlash = trimmed.replace(/\/+$/, '')
  if (withoutTrailingSlash.endsWith('/v1/chat/completions')) {
    return withoutTrailingSlash
  }
  if (withoutTrailingSlash.endsWith('/v1')) {
    return `${withoutTrailingSlash}/chat/completions`
  }
  return `${withoutTrailingSlash}/v1/chat/completions`
}

function SetupGuideBackdrop(props: { compact?: boolean }) {
  return (
    <>
      <div
        className={cn(
          'pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_48%_120%_at_78%_0%,color-mix(in_oklch,var(--overview-accent-1)_14%,transparent)_0%,transparent_62%),linear-gradient(112deg,color-mix(in_oklch,var(--card)_94%,var(--overview-accent-2)_6%)_0%,color-mix(in_oklch,var(--card)_94%,var(--overview-accent-3)_6%)_48%,color-mix(in_oklch,var(--background)_90%,var(--overview-accent-1)_10%)_100%)] dark:opacity-60',
          props.compact
            ? '[mask-image:linear-gradient(90deg,black_0%,black_48%,transparent_74%)] opacity-55'
            : 'opacity-85'
        )}
        aria-hidden='true'
      />
      <div
        className={cn(
          'text-foreground/5 dark:text-foreground/8 pointer-events-none absolute inset-y-0 right-0 hidden overflow-hidden font-mono sm:block',
          props.compact ? 'w-1/2 opacity-45' : 'w-[58%] opacity-75'
        )}
        aria-hidden='true'
      >
        <pre
          className={cn(
            'absolute right-3 [mask-image:linear-gradient(90deg,transparent_0%,black_30%,black_82%,transparent_100%)] text-right tracking-[0.38em] whitespace-pre',
            props.compact
              ? '-top-6 text-[9px] leading-4'
              : 'top-1 text-[11px] leading-5'
          )}
        >
          {SETUP_GUIDE_CODE_PATTERN}
        </pre>
      </div>
      <div
        className='from-background/35 to-background/70 dark:from-background/20 dark:to-background/80 pointer-events-none absolute inset-0 bg-linear-to-b via-transparent'
        aria-hidden='true'
      />
    </>
  )
}

export function StartStepItem(props: {
  step: StartStep
  index: number
  isLast: boolean
}) {
  const Icon = props.step.icon
  const StatusIcon = props.step.completed ? Check : Circle

  return (
    <li className='relative flex items-center gap-3 pb-2.5 last:pb-0'>
      <span
        className='relative flex w-8 shrink-0 items-center justify-center self-stretch'
        data-slot='step-track'
      >
        {props.index > 0 && (
          <span
            className='bg-border absolute top-0 bottom-[calc(50%+1.25rem)] left-1/2 w-px -translate-x-1/2'
            aria-hidden='true'
          />
        )}
        {!props.isLast && (
          <span
            className='bg-border absolute top-[calc(50%+1.25rem)] -bottom-2.5 left-1/2 w-px -translate-x-1/2'
            aria-hidden='true'
          />
        )}
        <span
          data-slot='step-marker'
          className={cn(
            'bg-background relative z-10 flex size-8 shrink-0 items-center justify-center rounded-lg border shadow-xs',
            props.step.completed && 'border-success/30 bg-success/10'
          )}
        >
          <StatusIcon
            className={props.step.completed ? 'text-success size-4' : 'size-4'}
            aria-hidden='true'
          />
        </span>
      </span>

      <Button
        variant='ghost'
        render={props.step.to ? <Link to={props.step.to} /> : undefined}
        role={props.step.to ? 'link' : undefined}
        onClick={props.step.onClick}
        className='bg-background/70 hover:bg-muted/50 focus-visible:ring-ring flex h-auto min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left shadow-xs transition-colors outline-none focus-visible:ring-2'
      >
        <span className='flex min-w-0 items-start gap-2.5'>
          <span className='bg-muted mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg'>
            <Icon className='size-3.5' aria-hidden='true' />
          </span>
          <span className='flex min-w-0 flex-col gap-0.5'>
            <span className='flex items-center gap-2 text-sm font-medium'>
              <span className='text-muted-foreground font-mono text-xs tabular-nums'>
                {props.index + 1}.
              </span>
              <span className='truncate'>{props.step.title}</span>
            </span>
            <span className='text-muted-foreground line-clamp-1 text-xs'>
              {props.step.description}
            </span>
          </span>
        </span>
        <ArrowRight
          className='text-muted-foreground size-4 shrink-0'
          aria-hidden='true'
        />
      </Button>
    </li>
  )
}

function CompactQuickAction(props: { action: QuickAction }) {
  const Icon = props.action.icon

  return (
    <Button
      variant='outline'
      size='sm'
      className='bg-background/70 h-8 min-w-24 gap-1.5 px-2.5'
      render={<Link to={props.action.to} />}
    >
      <Icon data-icon='inline-start' />
      <span>{props.action.title}</span>
    </Button>
  )
}

export function OverviewDashboard() {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const { items: apiInfoItems } = useApiInfo()
  const {
    apiInfo: showApiInfoPanel,
    announcements: showAnnouncementsPanel,
    faq: showFAQPanel,
    uptimeKuma: showUptimePanel,
  } = useDashboardContentVisibility()
  const [manualSetupGuideExpanded, setManualSetupGuideExpanded] = useState<
    boolean | null
  >(() => getSavedSetupGuideExpanded())

  const [desktopSetupView, setDesktopSetupView] = useState<
    'setup' | 'download' | null
  >(null)
  const [confirmedUser, setConfirmedUser] = useState<number | null>(null)
  const desktopConfigured = Boolean(
    user &&
    (confirmedUser === user.id ||
      window.localStorage.getItem(`beiapi-desktop-setup:${user.id}`) ===
        'confirmed')
  )
  const remainQuota = Number(user?.quota ?? 0)
  const usedQuota = Number(user?.used_quota ?? 0)
  const isAdmin = Boolean(user?.role && user.role >= ROLE.ADMIN)

  const startSteps = useMemo<StartStep[]>(
    () => [
      {
        title: t('Add credits'),
        description: t('Keep sufficient balance before use'),
        to: '/wallet',
        icon: CreditCard,
        completed: remainQuota > 0 || usedQuota > 0,
      },
      {
        title: t('Download setup tool'),
        description: t('Download the one-click setup tool CodexBei'),
        onClick: () => setDesktopSetupView('download'),
        icon: Download,
        completed: desktopConfigured,
      },
      {
        title: t('One-click setup'),
        description: t('Choose an agent and model to get started'),
        onClick: () => setDesktopSetupView('setup'),
        icon: TerminalSquare,
        completed: desktopConfigured,
      },
    ],
    [remainQuota, desktopConfigured, t, usedQuota]
  )

  const quickActions = useMemo<QuickAction[]>(
    () => [
      {
        title: t('API Keys'),
        description: t('Create a key for your app or service'),
        to: '/keys',
        icon: KeyRound,
      },
      {
        title: t('Channels'),
        description: t('Configure upstream providers and routing.'),
        to: '/channels',
        icon: RadioTower,
        adminOnly: true,
      },
      {
        title: t('Usage Logs'),
        description: t('Inspect requests, errors, and billing details'),
        to: '/usage-logs',
        icon: FileText,
      },
      {
        title: t('Pricing'),
        description: t('Review model rates before scaling traffic'),
        to: '/pricing',
        icon: BookOpen,
      },
    ],
    [t]
  )

  const visibleQuickActions = useMemo(
    () => quickActions.filter((action) => !action.adminOnly || isAdmin),
    [isAdmin, quickActions]
  )

  const completedStepCount = startSteps.filter((step) => step.completed).length
  const setupComplete = completedStepCount === startSteps.length
  const setupStatusReady = Boolean(user)
  const setupGuideExpanded =
    manualSetupGuideExpanded ?? (setupStatusReady && !setupComplete)
  const showLeftContentPanels =
    isAdmin || showApiInfoPanel || showAnnouncementsPanel || showFAQPanel
  const showContentPanels = showLeftContentPanels || showUptimePanel

  const handleSetupGuideToggle = () => {
    const nextExpanded = !setupGuideExpanded
    setManualSetupGuideExpanded(nextExpanded)
    saveSetupGuideExpanded(nextExpanded)
  }

  return (
    <div className='flex flex-col gap-4'>
      <DesktopSetupDialog
        open={desktopSetupView !== null}
        showDownloads={desktopSetupView === 'download'}
        onOpenChange={(open) => {
          if (!open) setDesktopSetupView(null)
        }}
        key={user?.id}
        userId={user?.id ?? 0}
        baseUrl={
          apiInfoItems[0]?.url?.trim()
            ? normalizeEndpoint(apiInfoItems[0].url).replace(
                /\/chat\/completions$/,
                ''
              )
            : ''
        }
        hasCredits={remainQuota > 0}
        onConfirmed={() => {
          if (user) {
            window.localStorage.setItem(
              `beiapi-desktop-setup:${user.id}`,
              'confirmed'
            )
            setConfirmedUser(user.id)
          }
          setDesktopSetupView(null)
        }}
      />
      {setupGuideExpanded ? (
        <CardStaggerContainer className='grid grid-cols-1 gap-4'>
          <CardStaggerItem className='bg-card h-full overflow-hidden rounded-2xl border shadow-xs'>
            <div className='relative h-full overflow-hidden p-4 sm:p-5'>
              <SetupGuideBackdrop />
              <div className='relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]'>
                <div className='flex min-w-0 flex-col gap-5'>
                  <div className='flex flex-wrap items-start justify-between gap-3'>
                    <div className='flex max-w-2xl flex-col gap-1'>
                      <div className='text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wider uppercase'>
                        <ListChecks className='size-3.5' aria-hidden='true' />
                        {t('Get started')}
                      </div>
                      <h3 className='text-xl font-semibold tracking-tight sm:text-2xl'>
                        {t('Build on your API gateway in minutes')}
                      </h3>
                      <p className='text-muted-foreground max-w-xl text-sm leading-relaxed'>
                        {t(
                          'A focused home for keys, balance, routing, and service health.'
                        )}
                      </p>
                    </div>
                    <div className='flex flex-wrap items-center gap-2'>
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={handleSetupGuideToggle}
                      >
                        <ChevronUp data-icon='inline-start' />
                        {t('Hide setup guide')}
                      </Button>
                    </div>
                  </div>

                  <ol className='bg-background/45 rounded-2xl border p-2 backdrop-blur'>
                    {startSteps.map((step, index) => (
                      <StartStepItem
                        key={step.title}
                        step={step}
                        index={index}
                        isLast={index === startSteps.length - 1}
                      />
                    ))}
                  </ol>
                </div>

                <DesktopSetupCard />
              </div>
            </div>
          </CardStaggerItem>
        </CardStaggerContainer>
      ) : (
        <CardStaggerContainer>
          <CardStaggerItem className='bg-card overflow-hidden rounded-2xl border shadow-xs'>
            <div className='relative overflow-hidden px-4 py-3 sm:px-5'>
              <SetupGuideBackdrop compact />
              <div className='relative flex flex-wrap items-center justify-between gap-3'>
                <div className='flex min-w-0 items-center gap-3'>
                  <span className='bg-background/70 flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-xs'>
                    <Check className='text-success size-4' aria-hidden='true' />
                  </span>
                  <div className='min-w-0'>
                    <div className='flex items-center gap-2'>
                      <h3 className='truncate text-sm font-semibold'>
                        {setupComplete
                          ? t('Setup guide complete')
                          : t('Setup guide')}
                      </h3>
                      <span className='text-muted-foreground bg-background/60 rounded-md border px-2 py-0.5 text-xs'>
                        {t('Setup progress: {{completed}}/{{total}}', {
                          completed: completedStepCount,
                          total: startSteps.length,
                        })}
                      </span>
                    </div>
                    <p className='text-muted-foreground line-clamp-1 text-xs'>
                      {setupComplete
                        ? t(
                            'Your setup guide is collapsed so usage stays in focus.'
                          )
                        : t('Setup guide is collapsed. Expand it anytime.')}
                    </p>
                  </div>
                </div>

                <div className='flex flex-wrap items-center gap-2'>
                  {visibleQuickActions.map((action) => (
                    <CompactQuickAction key={action.title} action={action} />
                  ))}
                  <Button
                    variant='outline'
                    size='sm'
                    className='bg-background/70 h-8 min-w-28'
                    onClick={handleSetupGuideToggle}
                  >
                    <ChevronDown data-icon='inline-start' />
                    {t('Show setup guide')}
                  </Button>
                </div>
              </div>
            </div>
          </CardStaggerItem>
        </CardStaggerContainer>
      )}

      <SummaryCards />

      {showContentPanels && (
        <CardStaggerContainer
          className={cn(
            'grid grid-cols-1 gap-4',
            showLeftContentPanels &&
              showUptimePanel &&
              'xl:grid-cols-[minmax(0,1fr)_22rem]'
          )}
        >
          {showLeftContentPanels && (
            <div
              className={cn(
                'grid min-w-0 grid-cols-1 gap-4',
                (showApiInfoPanel || showAnnouncementsPanel || showFAQPanel) &&
                  'lg:grid-cols-2'
              )}
            >
              {isAdmin && (
                <CardStaggerItem className='lg:col-span-2'>
                  <PerformanceHealthPanel />
                </CardStaggerItem>
              )}
              {showApiInfoPanel && (
                <CardStaggerItem>
                  <ApiInfoPanel />
                </CardStaggerItem>
              )}
              {showAnnouncementsPanel && (
                <CardStaggerItem>
                  <AnnouncementsPanel />
                </CardStaggerItem>
              )}
              {showFAQPanel && (
                <CardStaggerItem>
                  <FAQPanel />
                </CardStaggerItem>
              )}
            </div>
          )}
          {showUptimePanel && (
            <CardStaggerItem>
              <UptimePanel />
            </CardStaggerItem>
          )}
        </CardStaggerContainer>
      )}
    </div>
  )
}
