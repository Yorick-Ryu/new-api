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
import {
  createApiKey,
  fetchTokenKey,
  updateApiKeyGroup,
} from '@/features/keys/api'
import { ApiKeyGroupCombobox } from '@/features/keys/components/api-key-group-combobox'
import type { ApiKey } from '@/features/keys/types'
import { api, getUserGroups } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'

import { findCodexSetupKey } from '../../lib/codex-setup-key'
import {
  buildDesktopSetupLink,
  sortClaudeModels,
  InvalidDesktopSetupUrlError,
  type SetupAgent,
} from '../../lib/desktop-setup-link'
import { DesktopSetupDownloads } from './desktop-setup-downloads'
import { SetupAgentSelect, SetupModelSelect } from './desktop-setup-selectors'

export type SetupDownload = { label: string; url: string }

function setupDownloads(): SetupDownload[] {
  const downloadBase = 'https://codexbei.beiapi.cn/downloads/latest'
  const candidates = [
    {
      label: 'Windows x64',
      url:
        import.meta.env.VITE_SETUP_WINDOWS_X64_URL?.trim() ||
        `${downloadBase}/CodexBei_x64-setup.exe`,
    },
    {
      label: 'Windows ARM64',
      url:
        import.meta.env.VITE_SETUP_WINDOWS_ARM64_URL?.trim() ||
        `${downloadBase}/CodexBei_arm64-setup.exe`,
    },
    {
      label: 'macOS Apple Silicon',
      url:
        import.meta.env.VITE_SETUP_MAC_ARM64_URL?.trim() ||
        `${downloadBase}/CodexBei_aarch64.dmg`,
    },
    {
      label: 'macOS Intel',
      url:
        import.meta.env.VITE_SETUP_MAC_X64_URL?.trim() ||
        `${downloadBase}/CodexBei_x64.dmg`,
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
  onConfirmed?: () => void
  userId: number
  baseUrl: string
  hasCredits?: boolean
  selectedKey?: ApiKey
  onKeyGroupSaved?: (key: ApiKey) => void
  downloads?: SetupDownload[]
  showDownloads?: boolean
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedModel, setSelectedModel] = useState('')
  const [agent, setAgent] = useState<SetupAgent>('codex')
  const [selectedGroup, setSelectedGroup] = useState<string>()
  const [launched, setLaunched] = useState(false)
  const [downloadFallback, setDownloadFallback] = useState(false)
  const version = useRef(0)
  const selectedKey = props.selectedKey
  const showDownloads = props.showDownloads || downloadFallback
  const downloads = props.downloads ?? setupDownloads()
  const groupsQuery = useQuery({
    queryKey: ['codexbei', 'groups', props.userId],
    enabled: props.open && !showDownloads,
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    retry: false,
  })
  const groupOptions = Object.entries(groupsQuery.data?.data ?? {})
    .filter(
      ([name]) =>
        selectedKey ||
        agent === 'codex' ||
        name === 'auto' ||
        name === 'claude' ||
        name === 'claude-kiro'
    )
    .map(([name, info]) => ({
      value: name,
      label: name,
      desc: info.desc,
      ratio: info.ratio,
    }))
  const availableGroups = groupOptions.map((item) => item.value)
  const preferredGroups = agent === 'codex' ? ['auto', 'default'] : ['auto']
  let candidateGroups = [
    ...preferredGroups.filter((name) => availableGroups.includes(name)),
    ...availableGroups.filter((name) => !preferredGroups.includes(name)),
  ]
  const savedKeyGroup = selectedKey?.group ?? ''
  const keyGroup = selectedGroup ?? savedKeyGroup
  if (selectedKey) {
    candidateGroups =
      keyGroup === 'auto' &&
      keyGroup === savedKeyGroup &&
      selectedKey.auto_groups?.length
        ? selectedKey.auto_groups
        : [keyGroup]
  }
  const groupReady = candidateGroups.length > 0

  const modelsQuery = useQuery({
    queryKey: ['codexbei', 'catalog', props.userId, agent, candidateGroups],
    enabled: props.open && !showDownloads && groupReady,
    queryFn: async ({ signal }) => {
      const catalogs = await Promise.all(
        candidateGroups.map(async (candidateGroup) => {
          const result = await api.get<{
            data?: { id: string }[]
            models?: {
              slug: string
              visibility: string
              supported_in_api: boolean
            }[]
          }>('/api/user/models', {
            signal,
            params: {
              group: candidateGroup,
              client_version: agent === 'codex' ? 'codexbei' : 'claude',
              ...(agent === 'codex' ? { purpose: 'desktop_setup' } : {}),
            },
          })
          let models: string[]
          if (agent !== 'codex') {
            if (!Array.isArray(result.data.data)) {
              throw new Error('Models unavailable')
            }
            models = result.data.data
              .map((item) => item.id)
              .filter((id) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id))
              .filter(
                (id) =>
                  agent !== 'claude-desktop' ||
                  /^(anthropic\/)?claude-(sonnet|opus|haiku|fable|mythos)-\d/.test(
                    id
                  )
              )
            models = sortClaudeModels(models)
          } else {
            if (!Array.isArray(result.data.models)) {
              throw new Error('Models unavailable')
            }
            // The dedicated Codex catalog owns ordering; do not sort by name here.
            models = result.data.models
              .filter(
                (model) =>
                  model.visibility === 'list' &&
                  model.supported_in_api &&
                  /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(model.slug)
              )
              .map((model) => model.slug)
          }
          return { group: candidateGroup, models }
        })
      )
      return catalogs.filter((catalog) => catalog.models.length > 0)
    },
    retry: false,
  })
  const groups = groupOptions.filter((option) =>
    modelsQuery.data?.some((catalog) => catalog.group === option.value)
  )
  const selectedCatalog =
    modelsQuery.data?.find((catalog) => catalog.group === selectedGroup) ??
    modelsQuery.data?.[0]
  const group = selectedKey ? keyGroup : (selectedCatalog?.group ?? '')
  const keyGroupOptions = [
    { value: '', label: t('User Group') },
    ...groupOptions,
  ]
  if (group && !keyGroupOptions.some((option) => option.value === group)) {
    keyGroupOptions.push({ value: group, label: group })
  }
  const keyGroupChanged = Boolean(selectedKey && group !== savedKeyGroup)
  const allowedModels = selectedKey?.model_limits_enabled
    ? new Set(selectedKey.model_limits?.split(','))
    : null
  let models = selectedCatalog?.models ?? []
  if (selectedKey) {
    models = [
      ...new Set(modelsQuery.data?.flatMap((catalog) => catalog.models)),
    ].filter((model) => !allowedModels || allowedModels.has(model))
    if (agent !== 'codex') models = sortClaudeModels(models)
  }
  const groupLoading = groupsQuery.isFetching
  const groupError = groupsQuery.isError
  const modelsLoading = modelsQuery.isFetching || groupLoading
  let description = t('Choose an agent and model for CodexBei.')
  if (showDownloads) description = t('For Windows and macOS')
  else if (selectedKey) description = t('Agent')

  useEffect(() => {
    if (props.open) {
      setSelectedGroup(undefined)
      setSelectedModel('')
    }
  }, [props.open, props.userId])

  useEffect(() => {
    if (!selectedKey || !props.open || !launched || showDownloads) return

    // Browsers do not report whether a custom protocol has a handler.
    // Losing focus can mean the app or the browser's launch prompt appeared.
    const timer = window.setTimeout(() => {
      if (!document.hidden && document.hasFocus()) setDownloadFallback(true)
    }, 1800)
    const cancelFallback = () => window.clearTimeout(timer)
    const onVisibilityChange = () => {
      if (document.hidden) cancelFallback()
    }
    window.addEventListener('blur', cancelFallback)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      cancelFallback()
      window.removeEventListener('blur', cancelFallback)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [selectedKey, props.open, launched, showDownloads])

  useEffect(() => {
    version.current += 1
    setLaunched(false)
    return () => {
      version.current += 1
    }
  }, [
    props.open,
    props.baseUrl,
    props.showDownloads,
    props.userId,
    agent,
    group,
  ])

  const model = models.includes(selectedModel)
    ? selectedModel
    : (models[0] ?? '')

  const launch = useMutation({
    mutationFn: async (selection: {
      model: string
      version: number
      agent: SetupAgent
      group: string
    }) => {
      // Validate everything before creating a key. Credentials are never stored in React state.
      buildDesktopSetupLink(
        props.baseUrl,
        'sk-validation-placeholder-only',
        selection.model,
        selection.agent
      )
      let tokenId =
        selectedKey?.id ??
        (await findCodexSetupKey(
          selection.model,
          () => selection.version === version.current,
          selection.group
        ))
      if (selection.version !== version.current) return
      if (tokenId === null) {
        let keyName = 'CodexBei-ChatGPT'
        if (selection.agent === 'claude') keyName = 'CodexBei-CC'
        if (selection.agent === 'claude-desktop') {
          keyName = 'CodexBei-Claude-Desktop'
        }
        const created = await createApiKey({
          name: selection.group === 'auto' ? 'CodexBei' : keyName,
          group: selection.group,
          expired_time: -1,
          remain_quota: 0,
          unlimited_quota: true,
          model_limits_enabled: false,
          model_limits: '',
          allow_ips: '',
          auto_groups: [],
          cross_group_retry: false,
          allow_user_quota_query: true,
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
        selection.model,
        selection.agent
      )
      if (selectedKey && selection.group !== savedKeyGroup) {
        const updated = requireServerSuccess(
          await updateApiKeyGroup(tokenId, selection.group)
        )
        if (!updated.data) throw new Error('Key unavailable')
        void queryClient.invalidateQueries({ queryKey: ['keys'] })
        if (selection.version !== version.current) return
        props.onKeyGroupSaved?.(updated.data)
      }
      try {
        window.location.assign(link)
      } catch (error) {
        if (!selectedKey) throw error
        setDownloadFallback(true)
        return
      }
      setLaunched(true)
    },
    retry: false,
  })

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85dvh] gap-5 overflow-y-auto rounded-2xl p-5 sm:max-w-lg sm:p-6'>
        <DialogHeader>
          <DialogTitle>
            {showDownloads ? t('Download CodexBei') : t('One-click setup')}
          </DialogTitle>
          <DialogDescription className='sr-only'>
            {description}
          </DialogDescription>
        </DialogHeader>
        {showDownloads ? (
          <>
            <DesktopSetupDownloads downloads={downloads} />
            {downloadFallback && (
              <Button
                variant='outline'
                onClick={() => {
                  setLaunched(false)
                  setDownloadFallback(false)
                }}
              >
                {t('Back')}
              </Button>
            )}
          </>
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
                  agent: (
                    <SetupAgentSelect
                      value={agent}
                      disabled={launch.isPending}
                      onValueChange={(value) => {
                        version.current += 1
                        setAgent(value)
                        if (!selectedKey) {
                          setSelectedGroup(undefined)
                          setSelectedModel('')
                        }
                        setLaunched(false)
                        launch.reset()
                      }}
                    />
                  ),
                  model: (
                    <SetupModelSelect
                      value={model}
                      models={models}
                      disabled={
                        launch.isPending || modelsLoading || !models.length
                      }
                      loading={modelsLoading}
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
            <div
              className='flex flex-col gap-2'
              role='group'
              aria-label={t('Group')}
            >
              <span className='text-muted-foreground text-xs'>
                {t('Group')}
              </span>
              <ApiKeyGroupCombobox
                size='compact'
                searchable={false}
                placeholder={modelsLoading ? t('Loading') : undefined}
                options={selectedKey ? keyGroupOptions : groups}
                value={group}
                disabled={
                  launch.isPending ||
                  (!selectedKey && (modelsLoading || modelsQuery.isError)) ||
                  groupsQuery.isError ||
                  (selectedKey ? groupLoading : !groups.length)
                }
                onValueChange={(value) => {
                  version.current += 1
                  setSelectedGroup(value)
                  setSelectedModel('')
                  setLaunched(false)
                  launch.reset()
                }}
              />
              {!selectedKey &&
                !modelsLoading &&
                !groupsQuery.isError &&
                !modelsQuery.isError &&
                !groups.length && <p role='status'>{t('No group found.')}</p>}
              {groupsQuery.isError && (
                <div role='alert'>
                  {t('Failed to load groups')}{' '}
                  <Button
                    variant='link'
                    size='sm'
                    onClick={() => void groupsQuery.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                </div>
              )}
            </div>
            <div className='flex flex-col gap-2'>
              {keyGroupChanged && (
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {t('Continuing updates the group of this API key.')}
                </p>
              )}
              {!selectedKey && (
                <p className='text-muted-foreground text-xs leading-relaxed'>
                  {t(
                    'An API key is configured for your selection and created automatically if no suitable key is available.'
                  )}
                </p>
              )}
              {modelsQuery.isError && (
                <div
                  role='alert'
                  className='text-destructive flex flex-wrap items-baseline gap-2 text-xs leading-relaxed'
                >
                  <span>{t('Could not load models.')}</span>
                  <Button
                    variant='link'
                    size='sm'
                    className='h-auto p-0 text-xs leading-relaxed font-normal'
                    onClick={() => void modelsQuery.refetch()}
                  >
                    {t('Retry')}
                  </Button>
                </div>
              )}
            </div>
            {!selectedKey && !props.hasCredits && (
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
                !groupReady ||
                groupLoading ||
                groupError ||
                launch.isPending ||
                modelsQuery.isFetching ||
                modelsQuery.isError
              }
              onClick={() => {
                setLaunched(false)
                launch.mutate({ model, version: version.current, agent, group })
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
            {launched && selectedKey && (
              <Button
                variant='outline'
                onClick={() => setDownloadFallback(true)}
              >
                {t('Download CodexBei')}
              </Button>
            )}
            {launched && !selectedKey && (
              <>
                <p
                  role='status'
                  className='text-muted-foreground text-xs leading-relaxed'
                >
                  <Trans
                    i18nKey='Trying to open CodexBei. Didn’t open? <download>Download and install</download> it, then click “One-click setup”.'
                    components={{
                      download: (
                        <a
                          href='https://codexbei.beiapi.cn/'
                          target='_blank'
                          rel='noopener noreferrer'
                          className='text-primary focus-visible:ring-ring rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2'
                        />
                      ),
                    }}
                  />
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
