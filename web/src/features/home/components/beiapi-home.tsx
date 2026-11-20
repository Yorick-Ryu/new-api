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
  Agreement01Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUpRight01Icon,
  BankIcon,
  File01Icon,
  FlashIcon,
  GiftIcon,
  Key01Icon,
  Layers01Icon,
  SparklesIcon,
  Tick02Icon,
  UserGroupIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from '@tanstack/react-router'
import { useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'

import codexBeiLogo from '@/assets/brand/codexbei.svg'
import { Dialog } from '@/components/dialog'
import { FloatingSupport } from '@/components/floating-support'
import { PublicFooter } from '@/components/layout/components/public-footer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useDialogState } from '@/hooks/use-dialog'
import { useSystemConfig } from '@/hooks/use-system-config'
import { cn } from '@/lib/utils'

import '@/styles/beiapi-home.css'

import { useHomeScrollReveal } from '../hooks/use-home-scroll-reveal'
import { InstallationVideo } from './installation-video'
import { ResearchHub } from './research-hub'

const processSteps = [
  {
    num: '01',
    icon: Key01Icon,
    titleKey: 'Set up access',
    bodyKey:
      'Follow the guide to configure ChatGPT or Claude API access in your research tools.',
  },
  {
    num: '02',
    icon: FlashIcon,
    titleKey: 'Full model capabilities',
    bodyKey:
      'An uncompromised experience for long research documents, code reasoning and literature workflows.',
  },
  {
    num: '03',
    icon: Layers01Icon,
    titleKey: 'Cover research tasks',
    bodyKey:
      'One API gateway for writing, debugging, data analysis and literature workflows.',
  },
  {
    num: '04',
    icon: UserGroupIcon,
    titleKey: 'Ongoing community updates',
    bodyKey:
      'Practical AI research workflows and tips for common graduate and PhD questions.',
  },
] as const

const setupGuideSteps = [
  {
    num: '01',
    textKey: 'Install CodexBei and the ChatGPT or Claude desktop app.',
  },
  {
    num: '02',
    textKey:
      'Click “One-click setup” in the dashboard and wait for completion.',
  },
  {
    num: '03',
    textKey:
      'Restart the desktop app, start a new conversation and check the dashboard usage records.',
  },
] as const

const commissionLadderBars = [
  { id: 'tier-1', height: 0.44, opacity: 0.36 },
  { id: 'tier-2', height: 0.58, opacity: 0.52 },
  { id: 'tier-3', height: 0.72, opacity: 0.68 },
  { id: 'tier-4', height: 0.86, opacity: 0.84 },
  { id: 'tier-5', height: 1, opacity: 1 },
] as const

export function BeiAPIHome() {
  const { t } = useTranslation()
  const { systemName } = useSystemConfig()
  const mainRef = useRef<HTMLElement>(null)
  const [activeSetupStep, setActiveSetupStep] = useState(0)
  const [modal, setModal, modalHandlers] = useDialogState<
    'service' | 'community'
  >()

  useHomeScrollReveal(mainRef)

  return (
    <div>
      <link
        rel='preload'
        as='image'
        href='/beiapi-home/assets/3af3c5d013189f31.jpg'
        media='(min-width: 901px)'
      />
      <main className='beiapi-home' id='top' ref={mainRef}>
        <div className='home-scroll-progress' aria-hidden='true' />
        <section className='hero' aria-labelledby='hero-title'>
          <div className='hero-backdrop' aria-hidden='true' />
          <div className='hero-grid' aria-hidden='true' />
          <div className='wrap hero-inner'>
            <div className='hero-intro'>
              <p className='hero-eyebrow hero-enter hero-enter-1'>
                <span className='hero-beacon' aria-hidden='true'>
                  <span className='hero-beacon-ring' />
                  <span className='hero-beacon-dot' />
                </span>
                <span>{t('AI tools and access services for researchers')}</span>
              </p>
              <h1 className='hero-h1 hero-enter hero-enter-2' id='hero-title'>
                {systemName}
              </h1>
              <p className='hero-copy hero-enter hero-enter-3'>
                {t(
                  'AI tool access, setup guidance and support for graduate students, PhD students and researchers, helping with literature, academic writing, code debugging and data analysis.'
                )}
              </p>
              <ul
                className='hero-tags hero-enter hero-enter-4'
                aria-label={t('Key features')}
              >
                <li>{t('Research workflow support')}</li>
                <li>{t('Tool setup guidance')}</li>
                <li>{t('Tutorials and support')}</li>
              </ul>
              <div className='btn-row hero-enter hero-enter-5'>
                <Button
                  className='btn btn-primary btn-arrow-group'
                  variant='default'
                  role='link'
                  render={<Link to='/sign-in' />}
                >
                  {t('Get started')}
                  <HugeiconsIcon
                    icon={ArrowRight02Icon}
                    aria-hidden='true'
                    className='btn-arrow'
                  />
                </Button>
                <Button
                  className='btn btn-outline'
                  type='button'
                  aria-haspopup='dialog'
                  aria-expanded={modal === 'service'}
                  variant='outline'
                  onClick={() => setModal('service')}
                >
                  {t('About the service')}
                </Button>
              </div>
              <nav
                className='hero-shortcuts hero-enter hero-enter-6'
                aria-label={t('Guides and rewards')}
              >
                <a
                  className='hero-shortcut'
                  href='https://docs.beiapi.cn/guide/codexbei'
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <span className='shortcut-title'>
                    <span>{t('Codex installation guide')}</span>
                    <HugeiconsIcon
                      icon={ArrowUpRight01Icon}
                      aria-hidden='true'
                      className='shortcut-arrow'
                    />
                  </span>
                  <span className='shortcut-desc'>
                    {t('Installation and one-click setup')}
                  </span>
                </a>
                <a className='hero-shortcut' href='#campus-partner'>
                  <span className='shortcut-title'>
                    <span>{t('Campus partners')}</span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      aria-hidden='true'
                      className='shortcut-arrow shortcut-arrow-inline'
                    />
                  </span>
                  <span className='shortcut-desc'>
                    {t('Savings for friends. Commission for you.')}
                  </span>
                </a>
              </nav>
            </div>
            <div
              className='hero-visual hero-enter hero-enter-visual'
              aria-label={t('Codex installation video')}
            >
              <InstallationVideo />
            </div>
          </div>
          <section
            className='wrap hero-services'
            aria-labelledby='hero-services-title'
            data-reveal=''
          >
            <div className='hero-services-head'>
              <h2 className='hero-services-title' id='hero-services-title'>
                {t('Research AI access for labs and businesses')}
              </h2>
              <Button
                className='hero-consult-btn btn-arrow-group'
                type='button'
                aria-haspopup='dialog'
                aria-expanded={modal === 'community'}
                variant='ghost'
                onClick={() => setModal('community')}
              >
                {t('Discuss a partnership')}
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  aria-hidden='true'
                  className='btn-arrow'
                />
              </Button>
            </div>
            <div className='hero-services-row'>
              <Card className='hero-service-item'>
                <span className='hero-service-icon' aria-hidden='true'>
                  <HugeiconsIcon icon={BankIcon} aria-hidden='true' />
                </span>
                <span className='hero-service-copy'>
                  <strong>{t('Centralized purchasing')}</strong>
                  <span>{t('Business bank transfers supported')}</span>
                </span>
              </Card>
              <Card className='hero-service-item'>
                <span className='hero-service-icon' aria-hidden='true'>
                  <HugeiconsIcon icon={UserGroupIcon} aria-hidden='true' />
                </span>
                <span className='hero-service-copy'>
                  <strong>{t('Team access')}</strong>
                  <span>{t('Shared setup and guidance')}</span>
                </span>
              </Card>
              <Card className='hero-service-item'>
                <span className='hero-service-icon' aria-hidden='true'>
                  <HugeiconsIcon icon={Agreement01Icon} aria-hidden='true' />
                </span>
                <span className='hero-service-copy'>
                  <strong>{t('Partnership support')}</strong>
                  <span>
                    {t('For research groups, laboratories and businesses')}
                  </span>
                </span>
              </Card>
            </div>
          </section>
          <a
            className='wrap hero-referral'
            href='#campus-partner'
            aria-label={t('View the campus partner program and how to join')}
            data-reveal=''
          >
            <span className='hero-referral-copy'>
              <span className='hero-referral-icon-wrap' aria-hidden='true'>
                <HugeiconsIcon
                  icon={GiftIcon}
                  aria-hidden='true'
                  className='hero-referral-icon'
                />
              </span>
              <span>
                {t('Campus partners:')}
                <strong>
                  {t(
                    'Friends get a 5% discount coupon; you earn up to 50% commission'
                  )}
                </strong>
              </span>
            </span>
            <span className='hero-referral-link'>
              <span>{t('How to participate')}</span>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                aria-hidden='true'
                className='hero-referral-arrow'
              />
            </span>
          </a>
        </section>
        <section
          className='routing'
          id='routing'
          aria-labelledby='routing-title'
        >
          <div className='wrap routing-inner'>
            <div data-reveal=''>
              <p className='kicker'>{t('Unified model access')}</p>
              <h2 className='section-title' id='routing-title'>
                {t(
                  'Bring ChatGPT and Claude into your everyday research tasks.'
                )}
              </h2>
              <p className='section-body'>
                {t(
                  'Keep using your favorite tools with a stable, clear and reusable model gateway. Start writing, coding, reviewing literature and analyzing data with the same API setup.'
                )}
              </p>
            </div>
            <div data-reveal=''>
              <ResearchHub />
            </div>
          </div>
        </section>
        <section
          className='process'
          id='process'
          aria-labelledby='process-title'
        >
          <div className='wrap'>
            <div className='process-head' data-reveal=''>
              <p className='kicker'>{t('Getting connected')}</p>
              <h2 className='section-title' id='process-title'>
                {t(
                  'From setup to use, with fewer interruptions to your research.'
                )}
              </h2>
              <p className='section-body'>
                {t(
                  'Help AI fit naturally into your writing, coding and data workflows.'
                )}
              </p>
            </div>
            <div className='steps'>
              {processSteps.map((step, index) => (
                <Card
                  key={step.num}
                  className='step'
                  data-reveal=''
                  style={
                    { '--reveal-delay': `${index * 65}ms` } as CSSProperties
                  }
                >
                  <div className='step-head'>
                    <span className='step-num' aria-hidden='true'>
                      {step.num}
                    </span>
                    <span className='step-icon' aria-hidden='true'>
                      <HugeiconsIcon icon={step.icon} aria-hidden='true' />
                    </span>
                  </div>
                  <h3 className='step-title'>{t(step.titleKey)}</h3>
                  <p className='step-body'>{t(step.bodyKey)}</p>
                </Card>
              ))}
            </div>
          </div>
        </section>
        <section
          className='tutorial'
          id='codex-install-video'
          aria-labelledby='codex-video-title'
        >
          <div className='wrap tutorial-inner' data-reveal=''>
            <div className='tutorial-content'>
              <p className='kicker'>{t('Installation and setup')}</p>
              <h2 className='section-title' id='codex-video-title'>
                {t('Want to use ChatGPT or Claude but stuck on setup?')}
              </h2>
              <p className='section-body'>
                {t(
                  'Not sure which version to download or where to enter the API URL and key? Follow the guide to install the app, then use CodexBei for one-click setup in the dashboard. Available on Windows and macOS.'
                )}
              </p>
              <div className='tutorial-actions'>
                <Button
                  className='btn btn-primary btn-arrow-group'
                  variant='default'
                  role='link'
                  render={
                    <a
                      href='https://docs.beiapi.cn/guide/codexbei'
                      target='_blank'
                      rel='noopener noreferrer'
                    />
                  }
                >
                  <HugeiconsIcon
                    icon={File01Icon}
                    aria-hidden='true'
                    className='btn-icon'
                  />
                  {t('Read the installation docs')}
                  <HugeiconsIcon
                    icon={ArrowUpRight01Icon}
                    aria-hidden='true'
                    className='btn-arrow btn-arrow-up-right'
                  />
                </Button>
                <Button
                  className='btn btn-outline'
                  variant='outline'
                  role='link'
                  render={<Link to='/sign-in' />}
                >
                  {t('Open the dashboard')}
                </Button>
              </div>
              <div className='tutorial-meta' aria-label={t('Tutorial topics')}>
                <span>
                  <HugeiconsIcon icon={Tick02Icon} aria-hidden='true' />
                  {t('ChatGPT installation')}
                </span>
                <span>
                  <HugeiconsIcon icon={Tick02Icon} aria-hidden='true' />
                  {t('Claude installation')}
                </span>
                <span>
                  <HugeiconsIcon icon={Tick02Icon} aria-hidden='true' />
                  {t('One-click setup')}
                </span>
                <span>
                  <HugeiconsIcon icon={Tick02Icon} aria-hidden='true' />
                  {t('Connection verification')}
                </span>
              </div>
            </div>
            <Card
              className='tutorial-preview'
              aria-label={t('Codex installation guide preview')}
            >
              <div className='tutorial-video-head'>
                <span className='tutorial-brand-frame'>
                  <img
                    className='tutorial-brand-logo'
                    src={codexBeiLogo}
                    alt=''
                  />
                </span>
                <div>
                  <h3 className='tutorial-preview-title'>
                    {t('Set up Codex or Claude in one click without a VPN')}
                  </h3>
                </div>
              </div>
              <ol
                className='tutorial-checks'
                aria-label={t('Setup walkthrough steps')}
              >
                {setupGuideSteps.map((step, index) => (
                  <li
                    key={step.num}
                    className={cn(
                      'tutorial-check-item',
                      activeSetupStep === index && 'is-active'
                    )}
                  >
                    <button
                      type='button'
                      className='tutorial-check-btn'
                      aria-pressed={activeSetupStep === index}
                      onClick={() => setActiveSetupStep(index)}
                      onPointerEnter={() => setActiveSetupStep(index)}
                    >
                      <span className='tutorial-check-num' aria-hidden='true'>
                        {step.num}
                      </span>
                      <span className='tutorial-check-text'>
                        {t(step.textKey)}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </Card>
          </div>
        </section>
        <section className='trust' id='trust' aria-labelledby='trust-title'>
          <div className='wrap trust-inner'>
            <div data-reveal=''>
              <p className='kicker'>{t('About Bei')}</p>
              <h2 className='section-title' id='trust-title'>
                {t('Research AI access from a long-time research AI educator.')}
              </h2>
            </div>
            <div className='trust-panel' data-reveal=''>
              <p className='trust-quote'>
                {t(
                  'BeiAPI reaches over 100,000 followers, sharing research AI content to help graduate and PhD students apply AI to writing, code and research workflows.'
                )}
              </p>
              <div className='trust-metrics'>
                <div className='metric'>
                  <span
                    className='metric-accent'
                    data-reveal-bar=''
                    aria-hidden='true'
                  />
                  <strong className='metric-val'>{t('100K+')}</strong>
                  <span className='metric-lbl'>
                    {t('Followers and research AI audiences')}
                  </span>
                </div>
                <div className='metric'>
                  <span
                    className='metric-accent'
                    data-reveal-bar=''
                    aria-hidden='true'
                  />
                  <strong className='metric-val'>{t('Long-term')}</strong>
                  <span className='metric-lbl'>
                    {t(
                      'Content about papers, code, literature and research workflows'
                    )}
                  </span>
                </div>
                <div className='metric'>
                  <span
                    className='metric-accent'
                    data-reveal-bar=''
                    aria-hidden='true'
                  />
                  <strong className='metric-val'>{t('Focused')}</strong>
                  <span className='metric-lbl'>
                    {t(
                      'Serving graduate students, PhD students and researchers'
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>
        <section
          className='pricing'
          id='pricing'
          aria-labelledby='pricing-title'
        >
          <div className='wrap pricing-inner'>
            <div data-reveal=''>
              <p className='kicker'>{t('Flexible usage')}</p>
              <h2 className='section-title' id='pricing-title'>
                {t(
                  'Cache hits can significantly reduce your research API costs.'
                )}
              </h2>
              <p className='section-body'>
                {t(
                  'Our cache hit rate reaches 95%; cached portions cost just 10% of the original price.'
                )}
              </p>
              <div className='btn-row'>
                <Button
                  className='btn btn-primary btn-arrow-group'
                  variant='default'
                  role='link'
                  render={<Link to='/sign-in' />}
                >
                  {t('Connect now')}
                  <HugeiconsIcon
                    icon={ArrowRight02Icon}
                    aria-hidden='true'
                    className='btn-arrow'
                  />
                </Button>
                <Button
                  className='btn btn-outline'
                  variant='outline'
                  role='link'
                  render={<a href='https://pay.ldxp.cn/shop/xiaobeiapi' />}
                >
                  {t('Buy a plan')}
                </Button>
              </div>
            </div>
            <div data-reveal=''>
              <div className='price-facts' aria-label={t('Pricing advantages')}>
                <div className='price-fact'>
                  <strong>95%</strong>
                  <span className='price-fact-meter' aria-hidden='true'>
                    <span
                      className='price-fact-meter-fill'
                      data-reveal-bar=''
                      style={{ '--meter-width': '95%' } as CSSProperties}
                    />
                  </span>
                  <span>
                    {t(
                      'High cache hit rates save on repeated context and frequent tasks.'
                    )}
                  </span>
                </div>
                <div className='price-fact'>
                  <strong>{t('10% of price')}</strong>
                  <span
                    className='price-fact-meter price-fact-meter-discount'
                    aria-hidden='true'
                  >
                    <span
                      className='price-fact-meter-fill'
                      data-reveal-bar=''
                      style={{ '--meter-width': '14%' } as CSSProperties}
                    />
                  </span>
                  <span>
                    {t('Cached tokens cost one tenth of the original price.')}
                  </span>
                </div>
                <div className='price-fact'>
                  <strong>{t('Pay as needed')}</strong>
                  <span className='price-fact-segments' aria-hidden='true'>
                    <span />
                    <span />
                    <span />
                  </span>
                  <span>
                    {t('Start small and top up based on actual usage.')}
                  </span>
                </div>
              </div>
              <div className='price-list'>
                <div className='price-tier'>
                  <div>
                    <p className='price-name'>{t('Try it out')}</p>
                    <p className='price-desc'>
                      {t(
                        'Test ChatGPT / Claude API access, speed and reliability first.'
                      )}
                    </p>
                  </div>
                  <Button
                    className='price-action btn-arrow-group'
                    type='button'
                    aria-haspopup='dialog'
                    aria-expanded={modal === 'service'}
                    variant='outline'
                    onClick={() => setModal('service')}
                  >
                    <span>{t('About the research API')}</span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      aria-hidden='true'
                      className='btn-arrow'
                    />
                  </Button>
                </div>
                <div className='price-tier is-featured'>
                  <div>
                    <p className='price-name'>{t('Frequent research use')}</p>
                    <p className='price-desc'>
                      {t(
                        'For everyday writing, debugging and literature workflows.'
                      )}
                    </p>
                  </div>
                  <Badge
                    variant='secondary'
                    className='price-badge pb-rec'
                    data-static-badge='true'
                  >
                    <HugeiconsIcon
                      icon={SparklesIcon}
                      aria-hidden='true'
                      className='price-rec-icon'
                    />
                    {t('Recommended')}
                  </Badge>
                </div>
                <div className='price-tier'>
                  <div>
                    <p className='price-name'>{t('Team collaboration')}</p>
                    <p className='price-desc'>
                      {t(
                        'For research groups, labs and multiple concurrent API projects.'
                      )}
                    </p>
                  </div>
                  <Button
                    className='price-action btn-arrow-group'
                    type='button'
                    aria-haspopup='dialog'
                    aria-expanded={modal === 'community'}
                    variant='outline'
                    onClick={() => setModal('community')}
                  >
                    <span>{t('Contact us')}</span>
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      aria-hidden='true'
                      className='btn-arrow'
                    />
                  </Button>
                </div>
              </div>
              <p className='price-note'>
                {t(
                  'Actual usage varies by model, context length, cache hits and task. Start with a small top-up.'
                )}
              </p>
            </div>
          </div>
        </section>
        <section
          className='partner-section'
          id='campus-partner'
          aria-labelledby='campus-partner-title'
        >
          <div className='wrap referral'>
            <div className='reward-shell'>
              <div className='reward-intro' data-reveal=''>
                <div className='reward-intro-copy'>
                  <p className='kicker'>{t('Campus partners')}</p>
                  <h2 className='reward-heading' id='campus-partner-title'>
                    {t('Campus partners: share a useful API.')}
                  </h2>
                  <p className='reward-lead'>
                    {t(
                      'Share the research API with friends. Friends who bind your invitation receive a 5% top-up discount coupon. Earn tiered cash commissions from 30% up to 50% on their pay-as-you-go top-ups.'
                    )}
                  </p>
                </div>
                <Button
                  className='btn btn-primary btn-arrow-group'
                  variant='default'
                  role='link'
                  render={<Link to='/campus-partner' />}
                >
                  {t('Join campus partners')}
                  <HugeiconsIcon
                    icon={ArrowRight02Icon}
                    aria-hidden='true'
                    className='btn-arrow'
                  />
                </Button>
              </div>
              <Card
                className='signup-reward'
                aria-labelledby='partner-invitation-title'
                data-reveal=''
              >
                <div className='signup-reward-main'>
                  <span className='signup-reward-num' aria-hidden='true'>
                    01
                  </span>
                  <div>
                    <h3
                      className='signup-reward-title'
                      id='partner-invitation-title'
                    >
                      {t('You share, your friends save.')}
                    </h3>
                    <p className='signup-reward-copy'>
                      {t(
                        'Sign in and join Campus Partners to get your invitation link or code. Friends receive a coupon after binding your invitation. Track invitations, commissions and tiers on the program page.'
                      )}
                    </p>
                  </div>
                  <div
                    className='signup-reward-flow'
                    aria-label={t('Three steps to join campus partners')}
                  >
                    <div className='signup-reward-step'>
                      <span>01</span>
                      <strong>
                        {t('Join and share your invitation link')}
                      </strong>
                    </div>
                    <div className='signup-reward-step'>
                      <span>02</span>
                      <strong>{t('Friends bind and receive a coupon')}</strong>
                    </div>
                    <div className='signup-reward-step'>
                      <span>03</span>
                      <strong>{t('Friends top up, you earn cash')}</strong>
                    </div>
                  </div>
                </div>
                <div className='signup-reward-value'>
                  <span className='signup-reward-value-label'>
                    {t('Friends who bind an invitation receive')}
                  </span>
                  <strong>{t('5% off')}</strong>
                  <em>{t('Pay-as-you-go top-up coupon · Single use')}</em>
                  <Button
                    className='btn btn-primary btn-arrow-group'
                    variant='default'
                    role='link'
                    render={<Link to='/campus-partner' />}
                  >
                    {t('Get my invitation link')}
                    <HugeiconsIcon
                      icon={ArrowRight02Icon}
                      aria-hidden='true'
                      className='btn-arrow'
                    />
                  </Button>
                </div>
              </Card>
              <div
                className='reward-grid'
                aria-label={t('Campus partner commission details')}
                data-reveal=''
                style={{ '--reveal-delay': '80ms' } as CSSProperties}
              >
                <Card
                  className='reward-path'
                  aria-labelledby='partner-commission-title'
                >
                  <div className='reward-path-head'>
                    <span className='reward-path-num' aria-hidden='true'>
                      02
                    </span>
                    <div>
                      <h3
                        className='reward-path-title'
                        id='partner-commission-title'
                      >
                        {t(
                          'Earn by sharing. Commissions grow with your results.'
                        )}
                      </h3>
                      <p className='reward-path-subtitle'>
                        {t(
                          'Eligible friend spending counts toward your tier. Pay-as-you-go top-ups earn commission in marginal tiers.'
                        )}
                      </p>
                    </div>
                  </div>
                  <div
                    className='commission-metrics'
                    aria-label={t('Tiered pay-as-you-go commission rates')}
                  >
                    <div className='commission-metric'>
                      <span>{t('Pay-as-you-go commission')}</span>
                      <strong>
                        30%<em>{t('and up')}</em>
                      </strong>
                    </div>
                    <div className='commission-metric is-peak'>
                      <span>{t('Highest commission tier')}</span>
                      <strong>50%</strong>
                    </div>
                  </div>
                  <div className='commission-ladder' aria-hidden='true'>
                    {commissionLadderBars.map((bar) => (
                      <span
                        key={bar.id}
                        className='commission-ladder-bar'
                        style={
                          {
                            '--bar-scale': bar.height,
                            '--bar-opacity': bar.opacity,
                          } as CSSProperties
                        }
                      />
                    ))}
                  </div>
                  <div className='reward-extra reward-extra-neutral'>
                    <span>{t('Top-ups spanning multiple tiers')}</span>
                    <strong>{t('Calculated separately for each tier')}</strong>
                  </div>
                  <div className='reward-extra reward-extra-neutral'>
                    <span>{t('Participating monthly plans')}</span>
                    <strong>{t('Commission rates set per plan')}</strong>
                  </div>
                </Card>
                <Card className='reward-contact'>
                  <div>
                    <p className='reward-contact-copy'>
                      {t(
                        'Sign in to join and get your invitation link. See the program page for all commission tiers, monthly plan rates and withdrawal rules.'
                      )}
                    </p>
                  </div>
                  <div className='reward-contact-actions'>
                    <Button
                      className='btn btn-outline'
                      variant='outline'
                      role='link'
                      render={<Link to='/campus-partner' hash='campus-rules' />}
                    >
                      {t('Read the full rules')}
                    </Button>
                    <Button
                      className='btn btn-primary btn-arrow-group'
                      variant='default'
                      role='link'
                      render={<Link to='/campus-partner' />}
                    >
                      {t('Open partner center')}
                      <HugeiconsIcon
                        icon={ArrowRight02Icon}
                        aria-hidden='true'
                        className='btn-arrow'
                      />
                    </Button>
                  </div>
                </Card>
              </div>
              <p className='reward-rules-note'>
                {t(
                  'The 5% coupon is for your own pay-as-you-go top-ups only, single use, and excludes monthly plans. Commissions are calculated marginally across tiers, rather than applying the highest rate to the entire top-up. Current program rules govern tiers, monthly plan commissions, settlement and withdrawals.'
                )}
              </p>
            </div>
          </div>
        </section>
        <section
          className='final-cta'
          id='access'
          aria-labelledby='final-title'
        >
          <div className='wrap final-cta-frame' data-reveal=''>
            <div className='final-cta-backdrop' aria-hidden='true' />
            <div className='final-cta-content'>
              <p className='kicker'>{t('Get started')}</p>
              <h2 className='section-title' id='final-title'>
                {t(
                  'Make ChatGPT and Claude part of your research productivity.'
                )}
              </h2>
              <p className='section-body'>
                {t(
                  'Connect and configure your AI tools, then bring writing, coding, data analysis and literature workflows into everyday research.'
                )}
              </p>
              <div className='btn-row'>
                <Button
                  className='btn btn-primary btn-arrow-group'
                  variant='default'
                  role='link'
                  render={<Link to='/sign-in' />}
                >
                  {t('Connect now')}
                  <HugeiconsIcon
                    icon={ArrowRight02Icon}
                    aria-hidden='true'
                    className='btn-arrow'
                  />
                </Button>
                <Button
                  className='btn btn-outline'
                  type='button'
                  aria-haspopup='dialog'
                  aria-expanded={modal === 'service'}
                  variant='outline'
                  onClick={() => setModal('service')}
                >
                  {t('About the research API')}
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
      <PublicFooter />
      <FloatingSupport
        open={modal === 'community'}
        onOpenChange={(open) =>
          open ? setModal('community') : modalHandlers.reset()
        }
      />
      <Dialog
        open={modal === 'service'}
        onOpenChange={(open) => {
          if (!open) modalHandlers.reset()
        }}
        title={t('Service scope and usage guidelines')}
        description={t('Audience, research uses and service boundaries.')}
        contentClassName='beiapi-home beiapi-home-dialog'
        titleClassName='pr-6'
        bodyClassName='space-y-4'
        footer={
          <>
            <span className='text-muted-foreground mr-auto text-xs'>
              {t('Use AI thoughtfully · Respect academic standards')}
            </span>
            <Button onClick={modalHandlers.reset}>{t('Got it')}</Button>
          </>
        }
      >
        <div className='service-body'>
          <section
            className='service-region'
            aria-labelledby='service-region-title'
          >
            <div className='service-region-heading'>
              <h3 id='service-region-title'>
                {t('Service region and audience')}
              </h3>
            </div>
            <p>
              {t('This service is')}
              <strong>{t('only for users outside mainland China')}</strong>
              {t('and provides research and learning assistance.')}
            </p>
            <p className='service-region-note'>
              {t(
                'Before use, confirm that local laws and the relevant model service terms permit the service.'
              )}
            </p>
          </section>
          <div className='service-principles'>
            <section className='service-principle'>
              <span className='service-index' aria-hidden='true'>
                01
              </span>
              <div>
                <h3>{t('For research and learning assistance')}</h3>
                <p>
                  {t(
                    'Supports literature organization, academic expression, debugging and data analysis. Follow academic standards. Do not use it for ghostwriting, data fabrication or illegal activities.'
                  )}
                </p>
              </div>
            </section>
            <section className='service-principle'>
              <span className='service-index' aria-hidden='true'>
                02
              </span>
              <div>
                <h3>{t('Verify output independently')}</h3>
                <p>
                  {t(
                    'AI output may contain errors, omissions or fabricated citations. It is not professional advice or a research conclusion. Verify facts, citations, code and data, and take responsibility for your final use and publications.'
                  )}
                </p>
              </div>
            </section>
            <section className='service-principle'>
              <span className='service-index' aria-hidden='true'>
                03
              </span>
              <div>
                <h3>{t('Protect research materials')}</h3>
                <p>
                  {t(
                    'Do not submit state secrets, unauthorized personal information, confidential research or other material you are not entitled to process. Obtain permission and anonymize material before uploading.'
                  )}
                </p>
              </div>
            </section>
          </div>
          <div className='service-disclaimer'>
            <h3>{t('Responsibility statement')}</h3>
            <p>
              {t(
                'We provide AI tool access, setup guidance and support, without guaranteeing output accuracy, completeness or specific research outcomes. This notice does not exclude or limit our legal responsibilities.'
              )}
            </p>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
