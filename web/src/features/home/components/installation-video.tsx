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
import { ArrowUpRight01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

const DEFAULT_VIDEO_DURATION = 76
const chapters = [
  {
    start: 3.5,
    time: '01 / 00:03',
    label: 'Download and install',
    accessibleLabel: 'Jump to 3.5 seconds: download and installation',
  },
  {
    start: 39.5,
    time: '02 / 00:39',
    label: 'Configure the API',
    accessibleLabel: 'Jump to 39.5 seconds: configure the API',
  },
  {
    start: 53.5,
    time: '03 / 00:53',
    label: 'Get started',
    accessibleLabel: 'Jump to 53.5 seconds: get started',
  },
] as const
const videoUrl = 'https://assets.beiapi.cn/videos/codexbei-4k.mp4'

export function InstallationVideo() {
  const { t } = useTranslation()
  const videoRef = useRef<HTMLVideoElement>(null)
  const pendingSeek = useRef<number | null>(null)
  const playRequest = useRef(0)
  const [hasError, setHasError] = useState(false)
  const [currentChapter, setCurrentChapter] = useState(-1)
  const [duration, setDuration] = useState(DEFAULT_VIDEO_DURATION)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) videoRef.current?.pause()
    }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden)
    }
  }, [])

  function playChapter(time: number): void {
    const video = videoRef.current
    if (!video) return
    const request = ++playRequest.current
    setHasError(false)
    if (video.readyState < 1) {
      pendingSeek.current = time
      video.load()
    } else {
      pendingSeek.current = null
      video.currentTime = time
    }
    // Start within the user gesture, then seek when metadata arrives.
    void video.play().catch((error: unknown) => {
      if (request !== playRequest.current) return
      if (
        (error instanceof Error || error instanceof DOMException) &&
        error.name === 'AbortError'
      ) {
        return
      }
      if (
        (error instanceof Error || error instanceof DOMException) &&
        error.name === 'NotAllowedError'
      ) {
        video.focus()
        return
      }
      setHasError(true)
    })
  }

  const safeDuration =
    duration > 0 && Number.isFinite(duration)
      ? duration
      : DEFAULT_VIDEO_DURATION

  return (
    <Card className='hero-video' aria-labelledby='video-title'>
      <header className='video-heading'>
        <div>
          <h2 id='video-title'>
            <em>{t('No VPN needed')}</em>
            {t(', set up Codex in one click')}
          </h2>
          <p>
            {t(
              'Download, install and configure in this 76-second walkthrough.'
            )}
          </p>
        </div>
        <a
          className='video-guide-link'
          href='https://docs.beiapi.cn/guide/codexbei'
          target='_blank'
          rel='noopener noreferrer'
        >
          <span>{t('Read the illustrated guide')}</span>
          <HugeiconsIcon
            icon={ArrowUpRight01Icon}
            className='video-guide-arrow'
            aria-hidden='true'
          />
        </a>
      </header>
      <div className='video-stage'>
        <video
          ref={videoRef}
          controls
          playsInline
          preload='none'
          poster='/beiapi-home/assets/3af3c5d013189f31.jpg'
          aria-label={t(
            'CodexBei installation and setup: a 76-second Windows walkthrough'
          )}
          onLoadedMetadata={(event) => {
            const mediaDuration = event.currentTarget.duration
            if (mediaDuration > 0 && Number.isFinite(mediaDuration)) {
              setDuration(mediaDuration)
            }
            if (pendingSeek.current !== null) {
              event.currentTarget.currentTime = pendingSeek.current
              pendingSeek.current = null
            }
          }}
          onPlay={() => setHasError(false)}
          onEnded={() => setProgress(1)}
          onError={() => {
            pendingSeek.current = null
            setHasError(true)
          }}
          onTimeUpdate={(event) => {
            const time = event.currentTarget.currentTime
            const mediaDuration = event.currentTarget.duration
            const effectiveDuration =
              mediaDuration > 0 && Number.isFinite(mediaDuration)
                ? mediaDuration
                : safeDuration
            setProgress(Math.min(1, Math.max(0, time / effectiveDuration)))
            let current = -1
            chapters.forEach((chapter, index) => {
              if (time >= chapter.start) current = index
            })
            setCurrentChapter(current)
          }}
        >
          <source src={videoUrl} type='video/mp4' />
          {t('Your browser cannot play this video. Please')}{' '}
          <a href={videoUrl}>{t('Open the video file')}</a>.
        </video>
        {hasError && (
          <p className='video-error' role='alert'>
            {t('The video could not be played. You can')}{' '}
            <a href={videoUrl} target='_blank' rel='noopener noreferrer'>
              {t('Open the video separately')}
            </a>
            .
          </p>
        )}
      </div>
      <div
        className='video-progress-rail'
        role='progressbar'
        aria-label={t('Video playback progress')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
      >
        <span
          className='video-progress-fill'
          style={{ transform: `scaleX(${progress})` }}
        />
        {chapters.map((chapter) => (
          <span
            key={chapter.start}
            className='video-progress-tick'
            style={{ left: `${(chapter.start / safeDuration) * 100}%` }}
            aria-hidden='true'
          />
        ))}
      </div>
      <nav className='video-chapters' aria-label={t('Jump to a video chapter')}>
        {chapters.map((chapter, index) => (
          <Button
            key={chapter.start}
            className='video-chapter'
            variant='ghost'
            aria-label={t(chapter.accessibleLabel)}
            aria-current={currentChapter === index}
            onClick={() => playChapter(chapter.start)}
          >
            <span className='video-chapter-bar' aria-hidden='true' />
            <span className='video-chapter-meta'>
              <span className='video-chapter-dot' aria-hidden='true' />
              <small>{chapter.time}</small>
            </span>
            <strong>{t(chapter.label)}</strong>
          </Button>
        ))}
      </nav>
    </Card>
  )
}
