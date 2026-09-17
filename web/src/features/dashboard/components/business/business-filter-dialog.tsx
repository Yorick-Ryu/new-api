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
import { Calendar, Filter, RotateCcw, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'

import {
  fromBusinessPickerDate,
  getBusinessPresetRange,
  toBusinessPickerDate,
  type BusinessFilter,
  type BusinessPreset,
} from './business-period'

interface BusinessFilterDialogProps {
  value: BusinessFilter
  onChange: (filter: BusinessFilter) => void
}

export function BusinessFilterDialog(props: BusinessFilterDialogProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<BusinessPreset | null>(null)
  const [start, setStart] = useState<Date>()
  const [end, setEnd] = useState<Date>()
  const [error, setError] = useState('')

  const selectPreset = (value: BusinessPreset) => {
    const range = getBusinessPresetRange(value)
    setPreset(value)
    setStart(toBusinessPickerDate(range.start_timestamp))
    setEnd(toBusinessPickerDate(range.end_timestamp))
    setError('')
  }

  const handleOpenChange = (next: boolean) => {
    if (next) {
      if (props.value.period === 'custom') {
        setPreset(null)
        setStart(toBusinessPickerDate(props.value.start_timestamp))
        setEnd(toBusinessPickerDate(props.value.end_timestamp))
        setError('')
      } else {
        selectPreset(props.value.period)
      }
    }
    setOpen(next)
  }

  const handleApply = () => {
    if (preset) {
      props.onChange({ period: preset })
      setOpen(false)
      return
    }
    if (!start || !end) {
      setError(t('Select both start and end times'))
      return
    }
    const startTimestamp = fromBusinessPickerDate(start)
    const endTimestamp = fromBusinessPickerDate(end)
    if (
      !Number.isFinite(startTimestamp) ||
      !Number.isFinite(endTimestamp) ||
      startTimestamp <= 0 ||
      endTimestamp <= startTimestamp
    ) {
      setError(t('End time must be after start time'))
      return
    }
    if (endTimestamp - startTimestamp > 30 * 86400) {
      setError(t('Select a time range of up to 30 days'))
      return
    }
    if (endTimestamp > Math.floor(Date.now() / 1000) + 1) {
      setError(t('End time cannot be in the future'))
      return
    }
    props.onChange({
      period: 'custom',
      start_timestamp: startTimestamp,
      end_timestamp: endTimestamp,
    })
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      trigger={
        <Button variant='outline' size='sm' className='shrink-0'>
          <Filter className='mr-2 size-4' aria-hidden='true' />
          {t('Filter')}
        </Button>
      }
      title={t('Business Overview Filters')}
      description={t('Choose a time range of up to 30 days (Beijing time).')}
      contentClassName='max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-lg'
      footerClassName='grid grid-cols-2 gap-2 sm:flex'
      footer={
        <>
          <Button
            variant='outline'
            type='button'
            onClick={() => {
              props.onChange({ period: '1' })
              setOpen(false)
            }}
          >
            <RotateCcw className='mr-2 size-4' aria-hidden='true' />
            {t('Reset')}
          </Button>
          <Button onClick={handleApply} type='button'>
            <Search className='mr-2 size-4' aria-hidden='true' />
            {t('Apply Filters')}
          </Button>
        </>
      }
    >
      <ScrollArea className='h-full pr-3 sm:pr-4'>
        <div className='grid gap-4 py-2'>
          <div className='grid gap-2'>
            <Label className='flex items-center gap-2'>
              <Calendar className='size-4' aria-hidden='true' />
              {t('Quick Range')}
            </Label>
            <div className='grid grid-cols-2 gap-2 sm:flex'>
              {(['1', 'yesterday', '3', '7', '30'] as const).map((value) => {
                let label = t('Last {{days}} days', { days: Number(value) })
                if (value === '1') label = t('Today')
                if (value === 'yesterday') label = t('Yesterday')
                return (
                  <Button
                    key={value}
                    type='button'
                    size='sm'
                    variant={preset === value ? 'default' : 'outline'}
                    aria-pressed={preset === value}
                    onClick={() => selectPreset(value)}
                    className='flex-1'
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className='relative'>
            <div className='absolute inset-0 flex items-center'>
              <span className='w-full border-t' />
            </div>
            <div className='relative flex justify-center text-xs uppercase'>
              <span className='bg-background text-muted-foreground px-2'>
                {t('Custom Time Range')}
              </span>
            </div>
          </div>
          <fieldset className='grid gap-2'>
            <legend className='mb-2 text-sm font-medium'>
              {t('Start Time')}
            </legend>
            <DateTimePicker
              value={start}
              onChange={(date) => {
                setStart(date)
                setPreset(null)
                setError('')
              }}
              placeholder={t('Select start time')}
            />
          </fieldset>
          <fieldset className='grid gap-2'>
            <legend className='mb-2 text-sm font-medium'>
              {t('End Time')}
            </legend>
            <DateTimePicker
              value={end}
              onChange={(date) => {
                setEnd(date)
                setPreset(null)
                setError('')
              }}
              placeholder={t('Select end time')}
            />
          </fieldset>
          {error && (
            <p role='alert' className='text-destructive text-sm'>
              {error}
            </p>
          )}
        </div>
      </ScrollArea>
    </Dialog>
  )
}
