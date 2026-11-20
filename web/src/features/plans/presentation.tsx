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
import {
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  Calendar03Icon,
  Chat01Icon,
  FlashIcon,
  GiftIcon,
  InformationCircleIcon,
  Layers01Icon,
  SparklesIcon,
  Tick02Icon,
  Wallet01Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
import { ErrorState } from '@/components/error-state'
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { parseQuotaWindows } from '@/features/subscriptions/lib'
import { useSystemConfig } from '@/hooks/use-system-config'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import { DEFAULT_CURRENCY_CONFIG } from '@/stores/system-config-store'

import { getPlansCatalog } from './api'
import { usePlansMotion } from './hooks/use-plans-motion'
import { creditPlans, monthlyPlans as approvedMonthlyPlans } from './offers'

interface PlansPresentationProps {
  onCredit: (amount: number) => void
  onMonthly: (id: number) => void
  loading?: boolean
}

const CREDIT_SKELETON_KEYS = [
  'credit-sk-1',
  'credit-sk-2',
  'credit-sk-3',
  'credit-sk-4',
  'credit-sk-5',
  'credit-sk-6',
] as const

const MONTHLY_SKELETON_KEYS = ['monthly-sk-1', 'monthly-sk-2'] as const

const FAQ_ITEMS = [
  [
    'How do payment amounts and credits work?',
    'Each recharge card shows the current payment in CNY and credits received in USD. Prices follow the latest top-up settings. See the model square for usage pricing.',
  ],
  [
    'Do monthly plans have a five-hour limit?',
    'Plus and Ultra have no five-hour limit and use the same model multipliers as wallet credits. Plus includes $125 weekly and $500 monthly; Ultra includes $800 weekly and $3,200 monthly.',
  ],
  [
    'Can I buy another monthly plan or renew?',
    'Each monthly plan is limited to one per user, with renewals supported.',
  ],
  [
    'How do I request an invoice and academic Skills?',
    'Payments of ¥500 or more include invoicing and the full academic Skill collection. Contact support to request an invoice and claim the benefits.',
  ],
] as const

export function PublicCatalog(props: PlansPresentationProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const amount = (value: number) => formatNumber(value, locale)
  const yuan = (value: number) => value.toFixed(2)
  const [supportOpen, setSupportOpen] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  const { currency } = useSystemConfig()
  const quotaPerUnit =
    currency?.quotaPerUnit || DEFAULT_CURRENCY_CONFIG.quotaPerUnit
  const userId = useAuthStore((state) => state.auth.user?.id)
  const query = useQuery({
    queryKey: ['plans-page-catalog', userId ?? 'public'],
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    queryFn: async () => requireServerSuccess(await getPlansCatalog()).data,
  })
  const topupOptions = (query.data?.topup_options || []).map(
    (option, index) => {
      const presentation = creditPlans[index]
      return {
        ...option,
        title: presentation
          ? t(presentation.title)
          : t('Top-up option {{amount}}', { amount: amount(option.credits) }),
        description: presentation ? t(presentation.description) : '',
        tag: presentation?.tag ? t(presentation.tag) : '',
        featured: presentation?.featured || false,
      }
    }
  )
  const monthlyPlans = (query.data?.subscriptions || []).map((plan) => {
    const approved = approvedMonthlyPlans.find((item) => item.id === plan.id)
    const monthly =
      parseQuotaWindows(plan).find((window) => window.period_unit === 'month')
        ?.amount_total || 0
    return {
      id: plan.id,
      title: approved?.title || plan.title,
      money: plan.price_amount,
      description: approved?.description || plan.subtitle,
      weekly: plan.total_amount / quotaPerUnit,
      monthly: monthly / quotaPerUnit,
    }
  })

  const { activeSection, selectSection } = usePlansMotion(
    mainRef,
    topupOptions.length + monthlyPlans.length
  )

  return (
    <>
      <main id='top' className='page' ref={mainRef}>
        <section className='hero' aria-labelledby='page-title'>
          <p className='eyebrow plans-enter plans-enter-1'>
            <span className='eyebrow-dot' aria-hidden='true' />
            {t('For your next discovery')}
          </p>
          <h1 id='page-title' className='plans-enter plans-enter-2'>
            {t('Choose your credits.')} <span>{t('Focus on research.')}</span>
          </h1>
          <p className='hero-lead plans-enter plans-enter-3'>
            {t(
              'Find the right AI credits, from first experiments to everyday research.'
            )}
          </p>
          <nav
            className='section-switch plans-enter plans-enter-4'
            aria-label={t('Choose a plan type')}
          >
            <Button
              variant='ghost'
              role='link'
              aria-current={
                activeSection === 'recharge' ? 'location' : undefined
              }
              onClick={() => selectSection('recharge')}
              render={<a href='#recharge' />}
            >
              <HugeiconsIcon icon={Wallet01Icon} size={15} aria-hidden='true' />
              {t('Balance top-up')}
            </Button>
            <Button
              variant='ghost'
              role='link'
              aria-current={
                activeSection === 'subscriptions' ? 'location' : undefined
              }
              onClick={() => selectSection('subscriptions')}
              render={<a href='#subscriptions' />}
            >
              <HugeiconsIcon
                icon={Calendar03Icon}
                size={15}
                aria-hidden='true'
              />
              {t('Monthly subscriptions')}
            </Button>
          </nav>
        </section>

        <section
          id='recharge'
          className='content-section'
          aria-labelledby='credit-heading'
        >
          <div className='section-heading'>
            <div>
              <h2 id='credit-heading'>
                {t('Balance top-up')}
                <Badge variant='outline' className='plan-count-badge'>
                  {t('{{count}} plans', { count: topupOptions.length })}
                </Badge>
              </h2>
              <p>{t('Choose your credits and make room for every request.')}</p>
            </div>
            <Button
              variant='link'
              className='text-link model-link h-auto p-0'
              render={<a href='/pricing' />}
            >
              {t('View model pricing')}
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                size={15}
                className='link-arrow'
                aria-hidden='true'
              />
            </Button>
          </div>
          {query.isError && (
            <div role='status' className='payment-status-panel'>
              <ErrorState
                title={t('Failed to load plans. Please try again.')}
                onRetry={() => void query.refetch()}
                className='min-h-0 py-8'
              />
            </div>
          )}
          {query.isPending && (
            <div aria-label={t('Loading...')} className='credit-grid'>
              {CREDIT_SKELETON_KEYS.map((key) => (
                <Card key={key} className='credit-card-skeleton'>
                  <div className='card-top'>
                    <Skeleton className='h-5 w-20' />
                    <Skeleton className='h-5 w-12 rounded-full' />
                  </div>
                  <Skeleton className='mt-2 h-3.5 w-36' />
                  <Skeleton className='mt-6 mb-5 h-10 w-28' />
                  <div className='border-border mt-auto border-t pt-4'>
                    <Skeleton className='mb-4 h-5 w-full' />
                    <Skeleton className='h-10 w-full rounded-lg' />
                  </div>
                </Card>
              ))}
            </div>
          )}
          {!query.isPending && !query.isError && topupOptions.length === 0 && (
            <EmptyState title={t('No top-up options available')} />
          )}
          {topupOptions.length > 0 && (
            <div className='credit-grid'>
              {topupOptions.map((plan, i) => (
                <Card
                  role='article'
                  key={plan.amount}
                  className={cn('credit-card', plan.featured && 'featured')}
                  style={{ '--plan-index': i } as CSSProperties}
                  aria-labelledby={`credit-${i}`}
                >
                  <div className='card-top'>
                    <h3 id={`credit-${i}`}>{plan.title}</h3>
                    {plan.tag && (
                      <Badge
                        variant={plan.featured ? 'default' : 'secondary'}
                        className='plan-tag-badge'
                      >
                        {plan.featured && (
                          <HugeiconsIcon
                            icon={SparklesIcon}
                            size={11}
                            aria-hidden='true'
                          />
                        )}
                        {plan.tag}
                      </Badge>
                    )}
                  </div>
                  <p className='card-description'>{plan.description}</p>
                  <div className='price'>
                    <span className='currency'>¥</span>
                    <strong>{amount(Number(plan.money.split('.')[0]))}</strong>
                    <span className='price-suffix'>
                      .{plan.money.split('.')[1] || '00'}
                    </span>
                    <span className='price-caption'>{t('Actual payment')}</span>
                  </div>
                  <div className='credit-footer'>
                    <div className='credit-amount'>
                      <span>
                        <HugeiconsIcon
                          icon={Layers01Icon}
                          size={14}
                          aria-hidden='true'
                        />
                        {t('Credits received')}
                      </span>
                      <strong>
                        <small>$</small>
                        {amount(plan.credits)}
                      </strong>
                    </div>
                    <Button
                      variant={plan.featured ? 'default' : 'outline'}
                      className='purchase-button'
                      data-pay={plan.money}
                      data-amount={plan.amount}
                      disabled={props.loading}
                      onClick={() => props.onCredit(plan.amount)}
                      aria-label={t(
                        'Buy {{title}}, pay {{money}} yuan for {{amount}} USD credits',
                        {
                          title: plan.title,
                          money: plan.money,
                          amount: plan.credits,
                        }
                      )}
                    >
                      {props.loading ? t('Opening checkout…') : t('Buy now')}
                      <HugeiconsIcon
                        icon={ArrowRight02Icon}
                        size={15}
                        className='cta-arrow'
                        aria-hidden='true'
                      />
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <div className='benefit-banner' data-reveal=''>
            <div className='benefit-icon' aria-hidden='true'>
              <HugeiconsIcon icon={GiftIcon} size={18} />
            </div>
            <div className='benefit-copy'>
              <h3>{t('Get more from every purchase')}</h3>
              <p>
                {t('Actual payment')} <strong>¥500</strong>{' '}
                {t(
                  'or more includes invoicing and the full academic Skill collection.'
                )}
              </p>
            </div>
            <Button
              variant='link'
              className='text-link h-auto p-0'
              onClick={() => setSupportOpen(true)}
            >
              {t('Contact support to claim')}
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                size={15}
                className='link-arrow'
                aria-hidden='true'
              />
            </Button>
          </div>
        </section>

        <section
          id='subscriptions'
          className='content-section subscriptions'
          aria-labelledby='monthly-heading'
        >
          <div className='section-heading' data-reveal=''>
            <div>
              <h2 id='monthly-heading'>{t('A plan for everyday use')}</h2>
              <p>
                {t(
                  'Two monthly plans for different development and research workflows.'
                )}
              </p>
            </div>
            <span className='section-label'>
              <HugeiconsIcon
                icon={Calendar03Icon}
                size={14}
                aria-hidden='true'
              />
              {t('Billed monthly')}
            </span>
          </div>
          {query.isPending && (
            <div aria-hidden='true' className='monthly-grid'>
              {MONTHLY_SKELETON_KEYS.map((key) => (
                <Card key={key} className='monthly-card-skeleton'>
                  <div className='monthly-top'>
                    <Skeleton className='size-10 rounded-lg' />
                    <Skeleton className='h-5 w-20 rounded-full' />
                  </div>
                  <Skeleton className='mt-5 h-7 w-28' />
                  <Skeleton className='mt-2 h-4 w-52' />
                  <Skeleton className='mt-6 mb-6 h-11 w-36' />
                  <Skeleton className='h-16 w-full rounded-lg' />
                  <Skeleton className='mt-6 h-10 w-full rounded-lg' />
                </Card>
              ))}
            </div>
          )}
          <div className='monthly-grid'>
            {monthlyPlans.map((plan, index) => {
              const isUltra = plan.title.startsWith('Ultra')
              return (
                <Card
                  role='article'
                  className={cn('monthly-card', isUltra && 'ultra')}
                  style={
                    {
                      '--reveal-delay': `${index * 48}ms`,
                    } as CSSProperties
                  }
                  data-reveal=''
                  key={plan.id}
                >
                  <div className='monthly-top'>
                    <span className='monthly-symbol' aria-hidden='true'>
                      {!isUltra ? (
                        <HugeiconsIcon icon={FlashIcon} size={19} />
                      ) : (
                        <HugeiconsIcon icon={Layers01Icon} size={19} />
                      )}
                    </span>
                    <Badge variant='secondary'>{t('One per person')}</Badge>
                  </div>
                  <h3>{t(plan.title)}</h3>
                  <p className='card-description'>{t(plan.description)}</p>
                  <div className='price monthly-price'>
                    <span className='currency'>¥</span>
                    <strong>{amount(plan.money)}</strong>
                    <span className='price-suffix'>.00</span>
                    <span className='price-caption'>{t('/ month')}</span>
                  </div>
                  <div className='monthly-metrics'>
                    <div className='monthly-metric'>
                      <span>{t('Weekly credits')}</span>
                      <strong>
                        <small>$</small>
                        {amount(plan.weekly)}
                      </strong>
                    </div>
                    <div className='monthly-metric'>
                      <span>{t('Monthly credits')}</span>
                      <strong>
                        <small>$</small>
                        {amount(plan.monthly)}
                      </strong>
                    </div>
                  </div>
                  <ul className='features'>
                    <li>
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={15}
                        aria-hidden='true'
                      />
                      {t('No five-hour limit')}
                    </li>
                    <li>
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={15}
                        aria-hidden='true'
                      />
                      {t('Same model usage multipliers as wallet credits')}
                    </li>
                    <li>
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        size={15}
                        aria-hidden='true'
                      />
                      {t('Renewal supported')}
                    </li>
                  </ul>
                  <Button
                    variant={isUltra ? 'default' : 'outline'}
                    className='purchase-button'
                    data-subscribe={plan.id}
                    data-title={t(plan.title)}
                    data-price={`¥${yuan(plan.money)}`}
                    disabled={props.loading}
                    onClick={() => props.onMonthly(plan.id)}
                  >
                    {props.loading
                      ? t('Opening checkout…')
                      : t('Subscribe to {{plan}}', {
                          plan: plan.title.split(' ')[0],
                        })}
                    <HugeiconsIcon
                      icon={ArrowRight02Icon}
                      size={15}
                      className='cta-arrow'
                      aria-hidden='true'
                    />
                  </Button>
                </Card>
              )
            })}
          </div>
          <p className='subscription-note' data-reveal=''>
            <HugeiconsIcon
              icon={InformationCircleIcon}
              size={14}
              aria-hidden='true'
            />
            {t(
              'Each monthly plan is limited to one per user, with renewals supported.'
            )}
          </p>
        </section>

        <section
          className='questions content-section'
          aria-labelledby='questions-heading'
        >
          <div className='questions-intro' data-reveal=''>
            <h2 id='questions-heading'>{t('Before you choose')}</h2>
            <p>{t('About credits, monthly plans and invoicing.')}</p>
            <Button
              variant='link'
              className='text-link h-auto p-0'
              onClick={() => setSupportOpen(true)}
            >
              <HugeiconsIcon icon={Chat01Icon} size={15} aria-hidden='true' />
              {t('Contact Bei support')}
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                size={14}
                className='link-arrow'
                aria-hidden='true'
              />
            </Button>
          </div>
          <Accordion className='faq' multiple data-reveal=''>
            {FAQ_ITEMS.map(([q, a]) => (
              <AccordionItem key={q} className='faq-item'>
                <AccordionTrigger className='faq-trigger'>
                  {t(q)}
                </AccordionTrigger>

                <AccordionContent className='faq-panel'>
                  <p>{t(a)}</p>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>
      </main>

      <Dialog
        open={supportOpen}
        onOpenChange={setSupportOpen}
        title={t('Contact Bei support')}
        description={t('Scan to ask about plans, invoices or academic Skills.')}
        contentClassName='sm:max-w-[420px]'
      >
        <div className='border-border bg-muted/40 rounded-xl border p-3'>
          <img
            src='/beiapi-assets/wechat-community.png'
            className='w-full rounded-lg'
            alt={t('Bei support WeChat QR code')}
          />
        </div>
        <p className='text-muted-foreground mt-4 text-center text-xs'>
          {t('Scan with WeChat for support')}
        </p>
      </Dialog>
    </>
  )
}
