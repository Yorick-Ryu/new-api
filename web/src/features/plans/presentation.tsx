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
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Wallet,
  CalendarDays,
  Gift,
  MessageCircle,
  Sparkles,
  ArrowDown,
  Layers,
  Zap,
  Info,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { EmptyState } from '@/components/empty-state'
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
import { creditPlans, monthlyPlans as approvedMonthlyPlans } from './offers'

interface PlansPresentationProps {
  onCredit: (amount: number) => void
  onMonthly: (id: number) => void
  loading?: boolean
}

export function PublicCatalog(props: PlansPresentationProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const amount = (value: number) => formatNumber(value, locale)
  const yuan = (value: number) => value.toFixed(2)
  const [supportOpen, setSupportOpen] = useState(false)
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
  return (
    <>
      <main id='top' className='page'>
        <section className='hero' aria-labelledby='page-title'>
          <div className='eyebrow'>
            <span />
            {t('For your next discovery')}
          </div>
          <h1 id='page-title'>
            {t('Choose your credits.')} <span>{t('Focus on research.')}</span>
          </h1>
          <p>
            {t(
              'Find the right AI credits, from first experiments to everyday research.'
            )}
          </p>
          <div className='section-switch' aria-label={t('Choose a plan type')}>
            <a href='#recharge'>
              <Wallet size={16} />
              {t('Balance top-up')}
              <span>{t('On demand')}</span>
            </a>
            <a href='#subscriptions'>
              <CalendarDays size={16} />
              {t('Monthly subscriptions')}
              <ArrowDown size={14} />
            </a>
          </div>
        </section>
        <section
          id='recharge'
          className='content-section'
          aria-labelledby='credit-heading'
        >
          <div className='section-heading'>
            <div>
              <div className='section-kicker'>PAY AS YOU GO</div>
              <h2 id='credit-heading'>
                {t('Balance top-up')}
                <Badge variant='outline'>
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
              <ArrowUpRight size={16} />
            </Button>
          </div>
          {query.isError && (
            <div role='status' className='payment-status error'>
              <Info size={16} />
              {t('Failed to load plans. Please try again.')}
            </div>
          )}
          {query.isPending && (
            <div aria-label={t('Loading...')} className='credit-grid'>
              <Skeleton className='h-64' />
              <Skeleton className='h-64' />
              <Skeleton className='h-64' />
            </div>
          )}
          {!query.isPending && !query.isError && topupOptions.length === 0 && (
            <EmptyState title={t('No top-up options available')} />
          )}
          <div className='credit-grid'>
            {topupOptions.map((plan, i) => (
              <Card
                role='article'
                key={plan.amount}
                className={cn('credit-card', plan.featured && 'featured')}
                aria-labelledby={`credit-${i}`}
              >
                <div className='card-top'>
                  <h3 id={`credit-${i}`}>{plan.title}</h3>
                  {plan.tag && (
                    <Badge variant={plan.featured ? 'default' : 'secondary'}>
                      {plan.featured && <Sparkles size={11} />} {plan.tag}
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
                <div className='credit-amount'>
                  <span>
                    <Layers size={15} />
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
                  <ArrowRight size={16} />
                </Button>
              </Card>
            ))}
          </div>
          <div className='benefit-banner'>
            <div className='benefit-icon'>
              <Gift size={20} />
            </div>
            <div>
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
              <ArrowUpRight size={16} />
            </Button>
          </div>
        </section>
        <section
          id='subscriptions'
          className='content-section subscriptions'
          aria-labelledby='monthly-heading'
        >
          <div className='section-heading'>
            <div>
              <div className='section-kicker'>MONTHLY MEMBERSHIP</div>
              <h2 id='monthly-heading'>{t('A plan for everyday use')}</h2>
              <p>
                {t(
                  'Two monthly plans for different development and research workflows.'
                )}
              </p>
            </div>
            <span className='section-label'>
              <CalendarDays size={15} />
              {t('Billed monthly')}
            </span>
          </div>
          <div className='monthly-grid'>
            {monthlyPlans.map((plan) => (
              <Card
                role='article'
                className={cn(
                  'monthly-card',
                  plan.title.startsWith('Ultra') && 'ultra'
                )}
                key={plan.id}
              >
                <div className='monthly-top'>
                  <span className='monthly-symbol'>
                    {!plan.title.startsWith('Ultra') ? (
                      <Zap size={23} />
                    ) : (
                      <Layers size={23} />
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
                  <div>
                    <span>{t('Weekly credits')}</span>
                    <strong>
                      <small>$</small>
                      {amount(plan.weekly)}
                    </strong>
                  </div>
                  <div>
                    <span>{t('Monthly credits')}</span>
                    <strong>
                      <small>$</small>
                      {amount(plan.monthly)}
                    </strong>
                  </div>
                </div>
                <ul className='features'>
                  <li>
                    <Check size={16} />
                    {t('No five-hour limit')}
                  </li>
                  <li>
                    <Check size={16} />
                    {t('Same model usage multipliers as wallet credits')}
                  </li>
                  <li>
                    <Check size={16} />
                    {t('Renewal supported')}
                  </li>
                </ul>
                <Button
                  variant={
                    plan.title.startsWith('Ultra') ? 'default' : 'outline'
                  }
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
                  <ArrowRight size={16} />
                </Button>
              </Card>
            ))}
          </div>
          <p className='subscription-note'>
            <Info size={15} />
            {t(
              'Each monthly plan is limited to one per user, with renewals supported.'
            )}
          </p>
        </section>
        <section
          className='questions content-section'
          aria-labelledby='questions-heading'
        >
          <div className='questions-intro'>
            <div className='section-kicker'>GOOD TO KNOW</div>
            <h2 id='questions-heading'>{t('Before you choose')}</h2>
            <p>{t('About credits, monthly plans and invoicing.')}</p>
            <Button
              variant='link'
              className='text-link h-auto p-0'
              onClick={() => setSupportOpen(true)}
            >
              <MessageCircle size={16} />
              {t('Contact Bei support')}
              <ArrowUpRight size={15} />
            </Button>
          </div>
          <Accordion className='faq' multiple>
            {[
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
            ].map(([q, a]) => (
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
        <img
          src='/beiapi-assets/wechat-community.png'
          className='w-full rounded-xl'
          alt={t('Bei support WeChat QR code')}
        />
        <p className='text-muted-foreground mt-4 text-center text-xs'>
          {t('Scan with WeChat for support')}
        </p>
      </Dialog>
    </>
  )
}
