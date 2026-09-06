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
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { handleServerError } from '@/lib/handle-server-error'

import {
  getModelDisplayOrder,
  saveModelDisplayOrder,
} from '../../display-order-api'
import { ModelDisplayOrderEditor } from '../model-display-order-editor'

export function ModelDisplayOrderDialog(props: { onClose: () => void }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<string[] | null>(null)
  const query = useQuery({
    queryKey: ['model-display-order'],
    queryFn: getModelDisplayOrder,
    staleTime: 0,
    refetchOnWindowFocus: false,
  })
  const mutation = useMutation({
    mutationFn: saveModelDisplayOrder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pricing'] })
      void queryClient.invalidateQueries({ queryKey: ['model-display-order'] })
      toast.success(t('Model display order saved'))
      props.onClose()
    },
    onError: handleServerError,
  })
  const names = draft ?? query.data ?? []
  const dirty =
    draft !== null && JSON.stringify(draft) !== JSON.stringify(query.data)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) props.onClose()
      }}
    >
      <DialogContent
        className='flex max-h-[85dvh] flex-col sm:max-w-2xl'
        showCloseButton={!mutation.isPending}
      >
        <DialogHeader>
          <DialogTitle>{t('Model display order')}</DialogTitle>
          <DialogDescription>
            {t(
              'Drag models or use the arrow buttons to reorder. Save to apply this order to the model marketplace. New models appear after your saved models.'
            )}
          </DialogDescription>
        </DialogHeader>
        {query.isPending && <p role='status'>{t('Loading...')}</p>}
        {query.isError && (
          <div role='alert' className='space-y-2'>
            <p>{t('Failed to load model order')}</p>
            <Button
              variant='outline'
              onClick={() => {
                void query.refetch()
              }}
            >
              {t('Retry')}
            </Button>
          </div>
        )}
        {query.isSuccess && (
          <ModelDisplayOrderEditor
            names={names}
            disabled={mutation.isPending}
            onChange={setDraft}
          />
        )}
        {mutation.isError && (
          <p role='alert'>
            {t(
              'Failed to save model order. Your changes are kept; please retry.'
            )}
          </p>
        )}
        <DialogFooter>
          <Button
            variant='outline'
            disabled={mutation.isPending}
            onClick={props.onClose}
          >
            {t('Cancel')}
          </Button>
          <Button
            disabled={!dirty || !query.isSuccess || mutation.isPending}
            onClick={() => mutation.mutate(names)}
          >
            {mutation.isPending ? t('Saving...') : t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
