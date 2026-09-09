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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { createApiKey, fetchTokenKey } from '@/features/keys/api'
import { api } from '@/lib/api'

import { findCodexSetupKey } from '../../lib/codex-setup-key'
import {
  buildDesktopSetupLink,
  InvalidDesktopSetupUrlError,
} from '../../lib/desktop-setup-link'
import { DesktopSetupDownloads } from './desktop-setup-downloads'
import { SetupAgentSelect, SetupModelSelect } from './desktop-setup-selectors'

export type SetupDownload = { label: string; url: string }

function setupDownloads(): SetupDownload[] {
  const downloadBase = 'https://codexbei.beiapi.cn/downloads/0.1.0'
  const candidates = [
    {
      label: 'Windows x64',
      url:
        import.meta.env.VITE_SETUP_WINDOWS_X64_URL?.trim() ||
        `${downloadBase}/CodexBei_0.1.0_x64-setup.exe`,
    },
    {
      label: 'Windows ARM64',
      url:
        import.meta.env.VITE_SETUP_WINDOWS_ARM64_URL?.trim() ||
        `${downloadBase}/CodexBei_0.1.0_arm64-setup.exe`,
    },
    {
      label: 'macOS Apple Silicon',
      url:
        import.meta.env.VITE_SETUP_MAC_ARM64_URL?.trim() ||
        `${downloadBase}/CodexBei_0.1.0_aarch64.dmg`,
    },
    {
      label: 'macOS Intel',
      url:
        import.meta.env.VITE_SETUP_MAC_X64_URL?.trim() ||
        `${downloadBase}/CodexBei_0.1.0_x64.dmg`,
    },
  ]
  return candidates.filter((item): item is SetupDownload => {
    try {
      const url = new URL(item.url ?? '')
      return url.protocol === 'https:' && !url.username && !url.password
    } catch {
      return false
    }
  })
}

export function DesktopSetupDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed: () => void
  userId: number
  baseUrl: string
  hasCredits: boolean
  downloads?: SetupDownload[]
  showDownloads?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedModel, setSelectedModel] = useState('')
  const [launched, setLaunched] = useState(false)
  const version = useRef(0)
  const downloads = props.downloads ?? setupDownloads()
  useEffect(() => {
    version.current += 1
    setLaunched(false)
    return () => {
      version.current += 1
    }
  }, [props.open, props.baseUrl, props.showDownloads])

  const modelsQuery = useQuery({
    queryKey: ['codexbei', 'codex-catalog', props.userId, 'default'],
    enabled: props.open && !props.showDownloads,
    queryFn: async () => {
      const result = await api.get<{
        models?: {
          slug: string
          visibility: string
          supported_in_api: boolean
        }[]
      }>('/api/user/models', {
        params: { group: 'default', client_version: 'codexbei' },
      })
      if (!Array.isArray(result.data.models)) {
        throw new Error('Models unavailable')
      }
      // The dedicated Codex catalog owns ordering; do not sort by name here.
      return result.data.models
        .filter(
          (model) =>
            model.visibility === 'list' &&
            model.supported_in_api &&
            /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model.slug)
        )
        .map((model) => model.slug)
    },
    retry: false,
  })
  const models = modelsQuery.data ?? []
  let model = models.includes(selectedModel) ? selectedModel : (models[0] ?? '')
  if (!models.includes(selectedModel) && models.includes('gpt-6-astra')) {
    model = 'gpt-6-astra'
  }

  const launch = useMutation({
    mutationFn: async (selection: { model: string; version: number }) => {
      // Validate everything before creating a key. Credentials are never stored in React state.
      buildDesktopSetupLink(
        props.baseUrl,
        'sk-validation-placeholder-only',
        selection.model
      )
      let tokenId = await findCodexSetupKey(
        selection.model,
        () => selection.version === version.current
      )
      if (!tokenId) {
        const created = await createApiKey({
          name: 'CodexBei · ChatGPT',
          group: 'default',
          expired_time: -1,
          remain_quota: 0,
          unlimited_quota: true,
          model_limits_enabled: false,
          model_limits: '',
          allow_ips: '',
          auto_groups: [],
          cross_group_retry: false,
        })
        if (!created.success || !created.data?.id) {
          throw new Error('Key creation failed')
        }
        tokenId = created.data.id
        void queryClient.invalidateQueries({
          queryKey: ['dashboard', 'overview', 'api-keys'],
        })
        void queryClient.invalidateQueries({ queryKey: ['api-keys'] })
      }
      if (selection.version !== version.current) return
      const result = await fetchTokenKey(tokenId)
      if (!result.success || !result.data?.key) {
        throw new Error('Key unavailable')
      }
      if (selection.version !== version.current) return
      const link = buildDesktopSetupLink(
        props.baseUrl,
        result.data.key,
        selection.model
      )
      window.location.assign(link)
      setLaunched(true)
    },
    retry: false,
  })

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85dvh] gap-5 overflow-y-auto rounded-2xl p-5 sm:max-w-lg sm:p-6'>
        <DialogHeader>
          <DialogTitle>
            {props.showDownloads
              ? t('Download CodexBei')
              : t('One-click setup')}
          </DialogTitle>
          <DialogDescription className='sr-only'>
            {props.showDownloads
              ? t('For Windows and macOS')
              : t('Choose an agent and model for CodexBei.')}
          </DialogDescription>
        </DialogHeader>
        {props.showDownloads ? (
          <DesktopSetupDownloads downloads={downloads} />
        ) : (
          <>
            <div
              className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-3 text-sm'
              role='group'
              aria-label={t('Choose an agent and model for CodexBei.')}
            >
              <Trans
                i18nKey='<start>I want to use</start> <model/> <middle>in</middle> <agent/>'
                components={{
                  start: <span className='shrink-0 whitespace-nowrap' />,
                  middle: <span className='shrink-0 whitespace-nowrap' />,
                  agent: <SetupAgentSelect disabled={launch.isPending} />,
                  model: (
                    <SetupModelSelect
                      value={model}
                      models={models}
                      disabled={
                        launch.isPending ||
                        modelsQuery.isFetching ||
                        !models.length
                      }
                      loading={modelsQuery.isFetching}
                      onValueChange={(value) => {
                        setSelectedModel(value)
                        setLaunched(false)
                        launch.reset()
                      }}
                    />
                  ),
                }}
              />
            </div>
            <p className='text-muted-foreground text-xs leading-relaxed'>
              {t(
                'An API key is configured for your selection and created automatically if no suitable key is available.'
              )}
            </p>
            {modelsQuery.isError && (
              <div role='alert' className='text-destructive text-sm'>
                {t('Could not load models.')}{' '}
                <Button
                  variant='link'
                  size='sm'
                  onClick={() => void modelsQuery.refetch()}
                >
                  {t('Retry')}
                </Button>
              </div>
            )}
            {!props.hasCredits && (
              <p className='text-muted-foreground text-xs'>
                {t('Add credits before use.')}{' '}
                <Link to='/wallet' className='text-primary underline'>
                  {t('Add credits')}
                </Link>
              </p>
            )}
            <Button
              className='h-10 rounded-lg'
              disabled={
                !model ||
                launch.isPending ||
                modelsQuery.isFetching ||
                modelsQuery.isError
              }
              onClick={() => {
                setLaunched(false)
                launch.mutate({ model, version: version.current })
              }}
            >
              {launch.isPending ? t('Configuring...') : t('One-click setup')}
            </Button>
            {launch.isError && (
              <p role='alert' className='text-destructive text-sm'>
                {launch.error instanceof InvalidDesktopSetupUrlError
                  ? t('HTTPS gateway address is not configured.')
                  : t('Setup failed. Please retry.')}
              </p>
            )}
            {launched && (
              <>
                <p
                  role='status'
                  className='text-muted-foreground text-xs leading-relaxed'
                >
                  {t('Continue in CodexBei.')}
                </p>
                <Button
                  variant='outline'
                  className='w-full'
                  onClick={props.onConfirmed}
                >
                  {t('I have finished setup on this device')}
                </Button>
              </>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
