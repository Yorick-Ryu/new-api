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
  Check,
  ChevronRight,
  FileText,
  Gift,
  Handshake,
  Headset,
  Landmark,
  Users,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Footer } from '@/components/layout/components/footer'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useDialogState } from '@/hooks/use-dialog'

import '@/styles/beiapi-home.css'

import { InstallationVideo } from './installation-video'

export function BeiAPIHome() {
  const { t } = useTranslation()
  const [modal, setModal, modalHandlers] = useDialogState<
    'service' | 'community'
  >()
  const [qrError, setQrError] = useState(false)
  return (
    <>
      <link
        rel='preload'
        as='image'
        href='/beiapi-home/assets/3af3c5d013189f31.jpg'
        media='(min-width: 901px)'
      />
      <main className='beiapi-home' id='top'>
        <Button
          className='support-float'
          type='button'
          aria-haspopup='dialog'
          aria-expanded={modal === 'community'}
          aria-label={t('After-sales support: scan to contact Bei on WeChat')}
          variant='ghost'
          onClick={() => setModal('community')}
        >
          <Headset aria-hidden='true' />
          <span>
            <strong>{t('After-sales support')}</strong>
            <small>{t('Contact Bei on WeChat')}</small>
          </span>
        </Button>
        <section className='hero' aria-labelledby='hero-title'>
          <div className='wrap hero-inner'>
            <div className='hero-intro'>
              <p className='hero-eyebrow'>
                {t('AI tools and access services for researchers')}
              </p>
              <h1 className='hero-h1' id='hero-title'>
                {t('BeiAPI')}
              </h1>
              <p className='hero-copy'>
                {t(
                  'AI tool access, setup guidance and support for graduate students, PhD students and researchers, helping with literature, academic writing, code debugging and data analysis.'
                )}
              </p>
              <ul className='hero-tags' aria-label={t('Key features')}>
                <li>{t('Research workflow support')}</li>
                <li>{t('Tool setup guidance')}</li>
                <li>{t('Tutorials and support')}</li>
              </ul>
              <div className='btn-row'>
                <Button
                  className='btn btn-primary'
                  variant='default'
                  role='link'
                  render={<Link to='/sign-in' />}
                >
                  {t('Get started')}
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
                className='hero-shortcuts'
                aria-label={t('Guides and rewards')}
              >
                <a
                  className='hero-shortcut'
                  href='https://docs.beiapi.cn/guide/codexbei'
                  target='_blank'
                  rel='noopener noreferrer'
                >
                  <span className='shortcut-title'>
                    {t('Codex installation guide')}
                  </span>
                  <span className='shortcut-desc'>
                    {t('Installation and one-click setup')}
                  </span>
                </a>
                <a className='hero-shortcut' href='#campus-partner'>
                  <span className='shortcut-title'>{t('Campus partners')}</span>
                  <span className='shortcut-desc'>
                    {t('Savings for friends. Commission for you.')}
                  </span>
                </a>
              </nav>
            </div>
            <div
              className='hero-visual'
              aria-label={t('Codex installation video')}
            >
              <InstallationVideo />
            </div>
          </div>
          <section
            className='wrap hero-services'
            aria-labelledby='hero-services-title'
          >
            <div className='hero-services-head'>
              <h2 className='hero-services-title' id='hero-services-title'>
                {t('Research AI access for labs and businesses')}
              </h2>
              <Button
                className='hero-consult-btn'
                type='button'
                aria-haspopup='dialog'
                aria-expanded={modal === 'community'}
                variant='ghost'
                onClick={() => setModal('community')}
              >
                {t('Discuss a partnership')}
              </Button>
            </div>
            <div className='hero-services-row'>
              <Card className='hero-service-item'>
                <span className='hero-service-icon' aria-hidden='true'>
                  <Landmark aria-hidden='true' />
                </span>
                <span className='hero-service-copy'>
                  <strong>{t('Centralized purchasing')}</strong>
                  <span>{t('Business bank transfers supported')}</span>
                </span>
              </Card>
              <Card className='hero-service-item'>
                <span className='hero-service-icon' aria-hidden='true'>
                  <Users aria-hidden='true' />
                </span>
                <span className='hero-service-copy'>
                  <strong>{t('Team access')}</strong>
                  <span>{t('Shared setup and guidance')}</span>
                </span>
              </Card>
              <Card className='hero-service-item'>
                <span className='hero-service-icon' aria-hidden='true'>
                  <Handshake aria-hidden='true' />
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
          >
            <span className='hero-referral-copy'>
              <Gift aria-hidden='true' className='hero-referral-icon' />
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
              <ChevronRight aria-hidden='true' />
            </span>
          </a>
        </section>
        <section
          className='routing'
          id='routing'
          aria-labelledby='routing-title'
        >
          <div className='wrap routing-inner'>
            <div>
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
            <svg
              viewBox='0 0 340 310'
              fill='none'
              xmlns='http://www.w3.org/2000/svg'
              aria-hidden='true'
            >
              <line className='hub-line' x1='124' y1='44' x2='162' y2='142' />
              <line className='hub-line' x1='270' y1='90' x2='192' y2='146' />
              <line className='hub-line' x1='270' y1='220' x2='192' y2='164' />
              <line className='hub-line' x1='124' y1='266' x2='162' y2='168' />
              <rect
                className='hub-node'
                x='10'
                y='20'
                width='114'
                height='48'
              />
              <text
                className='hub-text'
                x='67'
                y='40'
                textAnchor='middle'
                fontSize='12'
                fontWeight='600'
              >
                ChatGPT / Claude
              </text>
              <text
                className='hub-text hub-sub'
                x='67'
                y='56'
                textAnchor='middle'
                fontSize='10.5'
              >
                {t('Codex · IDE · Scripts')}
              </text>
              <rect
                className='hub-node'
                x='216'
                y='64'
                width='114'
                height='48'
              />
              <text
                className='hub-text'
                x='273'
                y='84'
                textAnchor='middle'
                fontSize='12'
                fontWeight='600'
              >
                {t('Academic writing')}
              </text>
              <text
                className='hub-text hub-sub'
                x='273'
                y='100'
                textAnchor='middle'
                fontSize='10.5'
              >
                {t('Polishing · Structure · Submission')}
              </text>
              <rect
                className='hub-node'
                x='216'
                y='198'
                width='114'
                height='48'
              />
              <text
                className='hub-text'
                x='273'
                y='218'
                textAnchor='middle'
                fontSize='12'
                fontWeight='600'
              >
                {t('Code experiments')}
              </text>
              <text
                className='hub-text hub-sub'
                x='273'
                y='234'
                textAnchor='middle'
                fontSize='10.5'
              >
                {t('Debugging · Refactoring · Engineering')}
              </text>
              <rect
                className='hub-node'
                x='10'
                y='242'
                width='114'
                height='48'
              />
              <text
                className='hub-text'
                x='67'
                y='262'
                textAnchor='middle'
                fontSize='12'
                fontWeight='600'
              >
                {t('Literature workflows')}
              </text>
              <text
                className='hub-text hub-sub'
                x='67'
                y='278'
                textAnchor='middle'
                fontSize='10.5'
              >
                {t('Reading · Summarizing · Analysis')}
              </text>
              <rect
                className='hub-center'
                x='138'
                y='128'
                width='64'
                height='54'
              />
              <text
                className='hub-ctxt'
                x='170'
                y='149'
                textAnchor='middle'
                fontSize='11.5'
                fontWeight='700'
              >
                {t('Bei')}
              </text>
              <text
                className='hub-ctxt'
                x='170'
                y='165'
                textAnchor='middle'
                fontSize='11.5'
                fontWeight='700'
              >
                {t('Research API')}
              </text>
            </svg>
          </div>
        </section>
        <section
          className='process'
          id='process'
          aria-labelledby='process-title'
        >
          <div className='wrap'>
            <div className='process-head'>
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
              <Card className='step'>
                <span className='step-num' aria-hidden='true'>
                  01
                </span>
                <h3 className='step-title'>{t('Set up access')}</h3>
                <p className='step-body'>
                  {t(
                    'Follow the guide to configure ChatGPT or Claude API access in your research tools.'
                  )}
                </p>
              </Card>
              <Card className='step'>
                <span className='step-num' aria-hidden='true'>
                  02
                </span>
                <h3 className='step-title'>{t('Full model capabilities')}</h3>
                <p className='step-body'>
                  {t(
                    'An uncompromised experience for long research documents, code reasoning and literature workflows.'
                  )}
                </p>
              </Card>
              <Card className='step'>
                <span className='step-num' aria-hidden='true'>
                  03
                </span>
                <h3 className='step-title'>{t('Cover research tasks')}</h3>
                <p className='step-body'>
                  {t(
                    'One API gateway for writing, debugging, data analysis and literature workflows.'
                  )}
                </p>
              </Card>
              <Card className='step'>
                <span className='step-num' aria-hidden='true'>
                  04
                </span>
                <h3 className='step-title'>{t('Ongoing community updates')}</h3>
                <p className='step-body'>
                  {t(
                    'Practical AI research workflows and tips for common graduate and PhD questions.'
                  )}
                </p>
              </Card>
            </div>
          </div>
        </section>
        <section
          className='tutorial'
          id='codex-install-video'
          aria-labelledby='codex-video-title'
        >
          <div className='wrap tutorial-inner'>
            <div className='tutorial-content'>
              <p className='kicker'>{t('Installation and setup')}</p>
              <h2 className='section-title' id='codex-video-title'>
                {t('Installing Codex for the first time? Follow the guide.')}
              </h2>
              <p className='section-body'>
                {t(
                  'Install CodexBei, then use one-click setup in the dashboard. The guide covers Windows, macOS, manual setup and common questions.'
                )}
              </p>
              <div className='tutorial-actions'>
                <Button
                  className='btn btn-primary'
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
                  <FileText aria-hidden='true' className='btn-icon' />
                  {t('Read the installation docs')}
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
                  <Check aria-hidden='true' />
                  {t('Codex installation')}
                </span>
                <span>
                  <Check aria-hidden='true' />
                  {t('One-click website setup')}
                </span>
                <span>
                  <Check aria-hidden='true' />
                  {t('Connection verification')}
                </span>
              </div>
            </div>
            <Card
              className='tutorial-preview'
              aria-label={t('Codex installation guide preview')}
            >
              <div className='tutorial-video-head'>
                <div className='tutorial-play' aria-hidden='true'>
                  <FileText aria-hidden='true' />
                </div>
                <div>
                  <p className='tutorial-preview-label'>CodexBei Guide</p>
                  <h3 className='tutorial-preview-title'>
                    {t('CodexBei installation and setup')}
                  </h3>
                </div>
              </div>
              <ol className='tutorial-checks'>
                <li>
                  <span>01</span>
                  {t('Install CodexBei and the ChatGPT / Codex desktop app.')}
                </li>
                <li>
                  <span>02</span>
                  {t(
                    'Click “One-click setup” in the dashboard and wait for completion.'
                  )}
                </li>
                <li>
                  <span>03</span>
                  {t(
                    'Restart the client, verify a new task and check the dashboard usage records.'
                  )}
                </li>
              </ol>
            </Card>
          </div>
        </section>
        <section className='trust' id='trust' aria-labelledby='trust-title'>
          <div className='wrap trust-inner'>
            <div>
              <p className='kicker'>{t('About Bei')}</p>
              <h2 className='section-title' id='trust-title'>
                {t('Research AI access from a long-time research AI educator.')}
              </h2>
            </div>
            <div className='trust-panel'>
              <p className='trust-quote'>
                {t(
                  'BeiAPI reaches over 100,000 followers, sharing research AI content to help graduate and PhD students apply AI to writing, code and research workflows.'
                )}
              </p>
              <div className='trust-metrics'>
                <div className='metric'>
                  <strong className='metric-val'>{t('100K+')}</strong>
                  <span className='metric-lbl'>
                    {t('Followers and research AI audiences')}
                  </span>
                </div>
                <div className='metric'>
                  <strong className='metric-val'>{t('Long-term')}</strong>
                  <span className='metric-lbl'>
                    {t(
                      'Content about papers, code, literature and research workflows'
                    )}
                  </span>
                </div>
                <div className='metric'>
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
            <div>
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
                  className='btn btn-primary'
                  variant='default'
                  role='link'
                  render={<Link to='/sign-in' />}
                >
                  {t('Connect now')}
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
            <div>
              <div className='price-facts' aria-label={t('Pricing advantages')}>
                <div className='price-fact'>
                  <strong>95%</strong>
                  <span>
                    {t(
                      'High cache hit rates save on repeated context and frequent tasks.'
                    )}
                  </span>
                </div>
                <div className='price-fact'>
                  <strong>{t('10% of price')}</strong>
                  <span>
                    {t('Cached tokens cost one tenth of the original price.')}
                  </span>
                </div>
                <div className='price-fact'>
                  <strong>{t('Pay as needed')}</strong>
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
                    className='price-badge pb-link'
                    type='button'
                    aria-haspopup='dialog'
                    aria-expanded={modal === 'service'}
                    variant='ghost'
                    onClick={() => setModal('service')}
                  >
                    {t('About the research API')}
                  </Button>
                </div>
                <div className='price-tier'>
                  <div>
                    <p className='price-name'>{t('Frequent research use')}</p>
                    <p className='price-desc'>
                      {t(
                        'For everyday writing, debugging and literature workflows.'
                      )}
                    </p>
                  </div>
                  <span className='price-badge pb-rec'>{t('Recommended')}</span>
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
                    className='price-badge pb-consult'
                    type='button'
                    aria-haspopup='dialog'
                    aria-expanded={modal === 'community'}
                    variant='ghost'
                    onClick={() => setModal('community')}
                  >
                    {t('Contact us')}
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
              <div className='reward-intro'>
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
                  className='btn btn-primary'
                  variant='default'
                  role='link'
                  render={<Link to='/campus-partner' />}
                >
                  {t('Join campus partners')}
                </Button>
              </div>
              <Card
                className='signup-reward'
                aria-labelledby='partner-invitation-title'
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
                      <span>STEP 01</span>
                      <strong>
                        {t('Join and share your invitation link')}
                      </strong>
                    </div>
                    <div className='signup-reward-step'>
                      <span>STEP 02</span>
                      <strong>{t('Friends bind and receive a coupon')}</strong>
                    </div>
                    <div className='signup-reward-step'>
                      <span>STEP 03</span>
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
                    className='btn btn-primary'
                    variant='default'
                    role='link'
                    render={<Link to='/campus-partner' />}
                  >
                    {t('Get my invitation link')}
                  </Button>
                </div>
              </Card>
              <div
                className='reward-grid'
                aria-label={t('Campus partner commission details')}
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
                    <div className='commission-metric'>
                      <span>{t('Highest commission tier')}</span>
                      <strong>50%</strong>
                    </div>
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
                      className='btn btn-primary'
                      variant='default'
                      role='link'
                      render={<Link to='/campus-partner' />}
                    >
                      {t('Open partner center')}
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
          <div className='wrap'>
            <p className='kicker'>{t('Get started')}</p>
            <h2 className='section-title' id='final-title'>
              {t('Make ChatGPT and Claude part of your research productivity.')}
            </h2>
            <p className='section-body'>
              {t(
                'Connect and configure your AI tools, then bring writing, coding, data analysis and literature workflows into everyday research.'
              )}
            </p>
            <div className='btn-row'>
              <Button
                className='btn btn-primary'
                variant='default'
                role='link'
                render={<Link to='/sign-in' />}
              >
                {t('Connect now')}
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
        </section>
        <Footer
          compact
          columns={[]}
          copyrightOwner='Bei API'
          attributionVariant='based-on'
          description={t('AI tools and access services · For researchers')}
          copyright={t('Original homepage content and branding.')}
        />
      </main>
      <Dialog
        open={modalHandlers.isOpen}
        onOpenChange={(open) => {
          if (!open) modalHandlers.reset()
        }}
        title={
          modal === 'service'
            ? t('Service scope and usage guidelines')
            : t('Contact Bei · Consultation and support')
        }
        description={
          modal === 'service'
            ? t('Audience, research uses and service boundaries.')
            : t(
                'Scan to contact Bei for API setup, top-ups, request errors or plan questions.'
              )
        }
        contentClassName='beiapi-home beiapi-home-dialog'
        titleClassName='pr-6'
        bodyClassName='space-y-4'
        footer={
          modal === 'service' ? (
            <>
              <span className='text-muted-foreground mr-auto text-xs'>
                {t('Use AI thoughtfully · Respect academic standards')}
              </span>
              <Button onClick={modalHandlers.reset}>{t('Got it')}</Button>
            </>
          ) : undefined
        }
      >
        {modal === 'service' ? (
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
        ) : (
          <>
            <p className='support-hint'>
              {t(
                'Mention “API support” when adding the contact and include the problem or an error screenshot. Try the left WeChat contact first; use the right backup contact if necessary.'
              )}
            </p>
            <div className='modal-img-frame' data-error={qrError || undefined}>
              <img
                className='modal-img'
                src='/beiapi-home/assets/3a3296fc7db30a31.png'
                loading='lazy'
                decoding='async'
                fetchPriority='low'
                width='983'
                height='614'
                alt={t('Bei WeChat contact QR codes')}
                onError={() => setQrError(true)}
                onLoad={() => setQrError(false)}
              />
              <p className='modal-fallback'>
                {t(
                  'The WeChat QR codes could not be loaded. Refresh the page to retry.'
                )}
              </p>
            </div>
          </>
        )}
      </Dialog>
    </>
  )
}
