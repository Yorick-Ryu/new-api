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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@/components/ui/tooltip'
import type { PricingData } from '@/features/pricing/types'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import * as imageAPI from '../api'
import type { ImageJob, ImageOptions } from '../api'
import { ImageForm } from '../components/image-form'
import { ImageResult } from '../components/image-result'
import { ImageStudio } from '../index'

const options: ImageOptions = {
  available: true,
  models: [
    {
      model: 'gpt-image-1',
      sizes: ['', '1024x1024'],
      qualities: ['', 'high'],
      max_count: 4,
      editing: true,
    },
  ],
}
const job: ImageJob = {
  id: 'task-one',
  status: 'success',
  created_at: 1,
  expires_at: 86401,
  input: {
    model: 'gpt-image-1',
    prompt: 'A small house',
    size: '',
    quality: '',
    n: 1,
  },
  assets: [
    {
      id: 'task-one-0-original',
      kind: 'original',
      url: 'https://example.com/image.png',
    },
    {
      id: 'task-one-0-thumbnail',
      kind: 'thumbnail',
      url: 'https://example.com/thumb.jpg',
    },
  ],
}

const batchJob: ImageJob = {
  ...job,
  input: { ...job.input, n: 2 },
  assets: [
    ...job.assets,
    {
      id: 'task-one-1-original',
      kind: 'original',
      url: 'blob:second-original',
    },
    {
      id: 'task-one-1-thumbnail',
      kind: 'thumbnail',
      url: 'blob:second-thumbnail',
    },
  ],
}

const costOptions: ImageOptions = {
  available: true,
  models: [
    {
      model: 'gpt-image-2',
      sizes: ['', '1024x1024', '1536x864', '864x1536'],
      qualities: ['', 'low', 'medium', 'high'],
      max_count: 4,
      editing: true,
      custom_size: true,
    },
  ],
}
const pricing: PricingData = {
  success: true,
  data: [
    {
      id: 1,
      model_name: 'gpt-image-2',
      quota_type: 0,
      model_ratio: 0,
      completion_ratio: 0,
      enable_groups: ['default'],
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("image", fixed(0.02)) * image_count',
    },
  ],
  group_ratio: { default: 2 },
  vendors: [],
  usable_group: {},
  supported_endpoint: {},
  auto_groups: [],
}
let previousCurrency = useSystemConfigStore.getState().config.currency

function wrapper(props: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{props.children}</TooltipProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  previousCurrency = useSystemConfigStore.getState().config.currency
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  useAuthStore
    .getState()
    .auth.setUser({ id: 1, username: 'image-test', role: 1 })
  vi.spyOn(imageAPI, 'getImageJobs').mockResolvedValue([])
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/pricing') return { data: pricing }
    if (url === '/api/image-studio/options') {
      return { data: { success: true, data: options } }
    }
    return { data: { success: true, data: [] } }
  })
})
afterEach(() => {
  cleanup()
  useSystemConfigStore.getState().setConfig({ currency: previousCurrency })
  useAuthStore.getState().auth.setUser(null)
  vi.restoreAllMocks()
})

describe('Image workbench', () => {
  it('shows persistent browser history and disables deletion in an empty gallery', async () => {
    render(<ImageStudio />, { wrapper })
    expect(
      await screen.findByText(
        'Images and history are saved in this browser until you delete them. Clearing browser data also removes them.'
      )
    ).toBeInTheDocument()
    expect(await screen.findByText('No images yet')).toBeInTheDocument()
    expect(screen.queryByText(/remaining|expires in/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Select images' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
  })
  it('disables generation when image storage is unavailable', async () => {
    render(
      <ImageForm
        options={{ ...options, available: false }}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    expect(
      screen.getByRole('button', { name: 'Generate image' })
    ).toBeDisabled()
  })
  it('keeps size and ratio modes mutually exclusive and submits the effective size and count', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { id: 'task-one' } },
    })
    const onCreated = vi.fn()
    render(
      <ImageForm
        options={{
          ...options,
          models: [
            {
              ...options.models[0],
              sizes: ['', '1024x1024', '1536x1024', '1024x1536'],
            },
          ],
        }}
        reuse={null}
        reference={null}
        onCreated={onCreated}
      />,
      { wrapper }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    const sizes = within(
      await screen.findByRole('group', { name: 'Image size' })
    )
    fireEvent.click(sizes.getByRole('button', { name: '1536×1024' }))
    const ratioTrigger = screen.getByRole('button', { name: 'Aspect ratio' })
    const sizeTrigger = screen.getByRole('button', {
      name: 'Choose image size',
    })
    expect(ratioTrigger).toHaveTextContent('Free ratio')
    fireEvent.click(ratioTrigger)
    const ratios = within(
      await screen.findByRole('group', { name: 'Aspect ratio' })
    )
    fireEvent.click(ratios.getByRole('button', { name: /2:3/ }))
    expect(sizeTrigger).toHaveTextContent('Auto')
    expect(ratioTrigger).toHaveTextContent('2:3')
    fireEvent.click(sizeTrigger)
    expect(sizes.getByRole('button', { name: 'Auto' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(sizes.getByRole('button', { name: '1024×1536' })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    fireEvent.click(sizes.getByRole('button', { name: '1024×1024' }))
    expect(ratioTrigger).toHaveTextContent('Free ratio')
    fireEvent.click(ratioTrigger)
    expect(ratios.getByRole('button', { name: /Free ratio/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(ratios.getByRole('button', { name: /2:3/ })).toHaveAttribute(
      'aria-pressed',
      'false'
    )
    fireEvent.click(ratios.getByRole('button', { name: /3:2/ }))
    expect(sizeTrigger).toHaveTextContent('Auto')
    fireEvent.click(ratioTrigger)
    const countTrigger = screen.getByRole('button', {
      name: 'Choose number of images',
    })
    expect(countTrigger).toHaveTextContent('1')
    fireEvent.click(countTrigger)
    const counts = within(
      await screen.findByRole('group', { name: 'Number of images' })
    )
    fireEvent.click(counts.getByRole('button', { name: '3' }))
    await waitFor(() =>
      expect(countTrigger).toHaveAttribute('aria-expanded', 'false')
    )
    expect(countTrigger).toHaveTextContent('3')
    fireEvent.click(countTrigger)
    const selectedCount = within(
      await screen.findByRole('group', { name: 'Number of images' })
    ).getByRole('button', { name: '3' })
    expect(selectedCount).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(selectedCount)
    expect(countTrigger).toHaveTextContent('3')
    expect(post).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'A small house' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('task-one'))
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      '/api/image-studio/jobs',
      expect.objectContaining({ size: '1536x1024', n: 3 }),
      expect.any(Object)
    )
  })
  it('offers only supported sizes and counts while storage is unavailable', async () => {
    render(
      <ImageForm
        options={{
          available: false,
          models: [{ ...options.models[0], max_count: 1 }],
        }}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    const sizes = within(
      await screen.findByRole('group', { name: 'Image size' })
    )
    expect(
      sizes.getAllByRole('button').map((item) => item.textContent)
    ).toEqual(['Auto', '1024×1024'])
    fireEvent.click(sizes.getByRole('button', { name: '1024×1024' }))
    fireEvent.click(screen.getByRole('button', { name: 'Aspect ratio' }))
    const ratios = within(
      await screen.findByRole('group', { name: 'Aspect ratio' })
    )
    expect(ratios.queryByRole('button', { name: /3:2|2:3|3:4|4:3/ })).toBeNull()
    expect(ratios.getByRole('button', { name: /Free ratio/ })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    fireEvent.click(sizes.getByRole('button', { name: 'Auto' }))
    expect(sizes.getByRole('button', { name: 'Auto' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose number of images' })
    )
    const counts = within(
      await screen.findByRole('group', { name: 'Number of images' })
    )
    expect(counts.getAllByRole('button')).toHaveLength(1)
    expect(counts.getByRole('button', { name: '1' })).toBeEnabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose number of images' })
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose image quality' })
    )
    const qualities = within(
      await screen.findByRole('group', { name: 'Quality' })
    )
    expect(
      qualities.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Auto', 'High'])
    expect(
      screen.getByRole('button', { name: 'Generate image' })
    ).toBeDisabled()
  })
  it.each([
    ['3:4', '1152x1536'],
    ['4:3', '1536x1152'],
  ])(
    'submits the %s ratio while displaying automatic size',
    async (ratio, size) => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({
        data: { success: true, data: { id: 'ratio-task' } },
      })
      const onCreated = vi.fn()
      render(
        <ImageForm
          options={{
            ...options,
            models: [
              {
                ...options.models[0],
                model: 'gpt-image-2',
                custom_size: true,
                sizes: ['', '1024x1024', '1536x864', '864x1536'],
              },
            ],
          }}
          reuse={null}
          reference={null}
          onCreated={onCreated}
        />,
        { wrapper }
      )
      const ratioTrigger = screen.getByRole('button', { name: 'Aspect ratio' })
      fireEvent.click(ratioTrigger)
      const ratios = within(
        await screen.findByRole('group', { name: 'Aspect ratio' })
      )
      fireEvent.click(ratios.getByRole('button', { name: new RegExp(ratio) }))
      expect(ratioTrigger).toHaveTextContent(ratio)
      expect(
        screen.getByRole('button', { name: 'Choose image size' })
      ).toHaveTextContent('Auto')
      fireEvent.click(ratioTrigger)
      fireEvent.change(screen.getByLabelText('Image prompt'), {
        target: { value: 'A small house' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
      await waitFor(() => expect(onCreated).toHaveBeenCalledWith('ratio-task'))
      expect(post).toHaveBeenCalledWith(
        '/api/image-studio/jobs',
        expect.objectContaining({ model: 'gpt-image-2', size }),
        expect.any(Object)
      )
    }
  )
  it('switches a selected ratio to a custom size and submits the chosen quality', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({
      data: { success: true, data: { id: 'task-one' } },
    })
    const onCreated = vi.fn()
    render(
      <ImageForm
        options={{
          ...options,
          models: [
            {
              ...options.models[0],
              model: 'gpt-image-2',
              qualities: ['', 'low', 'medium', 'high'],
              custom_size: true,
              sizes: ['', '1024x1024', '1536x864', '864x1536'],
            },
          ],
        }}
        reuse={null}
        reference={null}
        onCreated={onCreated}
      />,
      { wrapper }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    const sizes = within(
      await screen.findByRole('group', { name: 'Image size' })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Aspect ratio' }))
    const ratios = within(
      await screen.findByRole('group', { name: 'Aspect ratio' })
    )
    fireEvent.click(ratios.getByRole('button', { name: /16:9/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    fireEvent.click(sizes.getByRole('button', { name: 'Custom' }))
    expect(
      screen.getByRole('button', { name: 'Aspect ratio' })
    ).toHaveTextContent('Free ratio')
    fireEvent.change(screen.getByRole('textbox', { name: 'Width' }), {
      target: { value: '3840' },
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Height' }), {
      target: { value: '2160' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    const qualityTrigger = screen.getByRole('button', {
      name: 'Choose image quality',
    })
    expect(qualityTrigger).toHaveTextContent('Auto')
    fireEvent.click(qualityTrigger)
    const qualities = within(
      await screen.findByRole('group', { name: 'Quality' })
    )
    expect(
      qualities.getAllByRole('button').map((button) => button.textContent)
    ).toEqual(['Auto', 'Low', 'Medium', 'High'])
    expect(
      qualities.queryByRole('button', { name: 'Model default' })
    ).not.toBeInTheDocument()
    fireEvent.click(qualities.getByRole('button', { name: 'High' }))
    await waitFor(() =>
      expect(qualityTrigger).toHaveAttribute('aria-expanded', 'false')
    )
    expect(qualityTrigger).toHaveTextContent('High')
    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'A small house' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('task-one'))
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith(
      '/api/image-studio/jobs',
      expect.objectContaining({
        model: 'gpt-image-2',
        size: '3840x2160',
        quality: 'high',
      }),
      expect.any(Object)
    )
  })
  it.each([
    {
      reason: 'a dimension is not a multiple of 16',
      width: '1025',
      height: '1024',
    },
    { reason: 'the pixel limit is exceeded', width: '3840', height: '2176' },
    {
      reason: 'the pixel count is below the minimum',
      width: '624',
      height: '1024',
    },
    { reason: 'the aspect ratio exceeds 3:1', width: '3072', height: '1008' },
    { reason: 'a dimension is zero', width: '0', height: '1024' },
  ])(
    'rejects a custom size when $reason without creating a paid task',
    async ({ width, height }) => {
      const post = vi.spyOn(api, 'post').mockResolvedValue({
        data: { success: true, data: { id: 'task-one' } },
      })
      render(
        <ImageForm
          options={{
            ...options,
            models: [
              {
                ...options.models[0],
                model: 'gpt-image-2',
                custom_size: true,
                sizes: ['', '1024x1024', '1536x864', '864x1536'],
              },
            ],
          }}
          reuse={null}
          reference={null}
          onCreated={vi.fn()}
        />,
        { wrapper }
      )
      fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
      await screen.findByRole('group', { name: 'Image size' })
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Image size' })).getByRole(
          'button',
          { name: 'Custom' }
        )
      )
      const widthInput = screen.getByRole('textbox', { name: 'Width' })
      const heightInput = screen.getByRole('textbox', { name: 'Height' })
      for (const input of [widthInput, heightInput]) {
        for (const value of ['4096', '12345678', '-16', '1.5', '1e3', 'abc']) {
          fireEvent.change(input, { target: { value } })
          expect(input).toHaveValue('1024')
        }
        fireEvent.change(input, { target: { value: '' } })
        expect(input).toHaveValue('')
        fireEvent.change(input, { target: { value: '1024' } })
      }
      fireEvent.change(widthInput, { target: { value: width } })
      fireEvent.change(screen.getByRole('textbox', { name: 'Height' }), {
        target: { value: height },
      })
      expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement()
      fireEvent.change(screen.getByLabelText('Image prompt'), {
        target: { value: 'A small house' },
      })
      fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
      expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement()
      expect(screen.getByRole('textbox', { name: 'Width' })).toBeInvalid()
      expect(post).not.toHaveBeenCalled()
    }
  )
  it('updates the request-price estimate when image count changes without charging', async () => {
    const post = vi.spyOn(api, 'post')
    render(
      <ImageForm
        options={costOptions}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    const estimate = screen.getByRole('status', {
      name: 'Estimated image cost',
    })
    await waitFor(() => expect(estimate).toHaveTextContent(/^\$0\.04$/))
    expect(screen.queryByText('Image output only')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Cost estimate details' })
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose number of images' })
    )
    const counts = within(
      await screen.findByRole('group', { name: 'Number of images' })
    )
    fireEvent.click(counts.getByRole('button', { name: '4' }))
    await waitFor(() => expect(estimate).toHaveTextContent(/^\$0\.16$/))
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
    expect(post).not.toHaveBeenCalled()
  })
  it('shows an output-only range for Auto and updates it for the selected size and quality', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...pricing,
        group_ratio: { default: 1 },
        data: [
          {
            ...pricing.data[0],
            billing_expr: 'tier("standard", p * 5 + c * 30)',
          },
        ],
      },
    })
    render(
      <ImageForm
        options={costOptions}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    const estimate = screen.getByRole('status', {
      name: 'Estimated image cost',
    })
    await waitFor(() =>
      expect(estimate).toHaveTextContent('$0.00162 – $0.71157')
    )
    expect(screen.queryByText('Image output only')).not.toBeInTheDocument()
    const detailsButton = screen.getByRole('button', {
      name: 'Cost estimate details',
    })
    act(() => detailsButton.focus())
    expect(
      await screen.findByText(
        'Excludes prompt and reference-image input costs. Final cost depends on actual usage.'
      )
    ).toBeVisible()
    expect(
      screen.getByText(
        'Automatic size or quality is shown as a range across supported settings.'
      )
    ).toBeVisible()
    act(() => detailsButton.blur())
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose image quality' })
    )
    fireEvent.click(
      within(await screen.findByRole('group', { name: 'Quality' })).getByRole(
        'button',
        { name: 'Low' }
      )
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose image size' }))
    fireEvent.click(
      within(
        await screen.findByRole('group', { name: 'Image size' })
      ).getByRole('button', { name: '1024×1024' })
    )
    await waitFor(() => expect(estimate).toHaveTextContent('≈ $0.00588'))
    expect(screen.queryByText('Image output only')).not.toBeInTheDocument()
  })
  it('keeps generation available while pricing loads and after the pricing request fails', async () => {
    let rejectPricing!: (reason: Error) => void
    vi.mocked(api.get).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPricing = reject
      })
    )
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue({ data: { success: true, data: { id: 'task-one' } } })
    const onCreated = vi.fn()
    render(
      <ImageForm
        options={costOptions}
        reuse={null}
        reference={null}
        onCreated={onCreated}
      />,
      { wrapper }
    )
    const estimate = screen.getByRole('status', {
      name: 'Estimated image cost',
    })
    expect(estimate).toHaveTextContent('Estimating…')
    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'A small house' },
    })
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
    rejectPricing(new Error('pricing offline'))
    await waitFor(() =>
      expect(estimate).toHaveTextContent('Estimate unavailable')
    )
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('task-one'))
    expect(post).toHaveBeenCalledTimes(1)
  })
  it('shows an unavailable estimate for unsupported expressions without blocking generation', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        ...pricing,
        data: [{ ...pricing.data[0], billing_expr: 'tier("custom", c * c)' }],
      },
    })
    render(
      <ImageForm
        options={costOptions}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    await waitFor(() =>
      expect(
        screen.getByRole('status', { name: 'Estimated image cost' })
      ).toHaveTextContent('Estimate unavailable')
    )
    expect(screen.queryByText('Image output only')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate image' })).toBeEnabled()
  })
  it('rejects an empty prompt without creating a paid task', async () => {
    const post = vi.spyOn(api, 'post')
    render(
      <ImageForm
        options={options}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Generate image' })
      ).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    expect(
      await screen.findByText('Enter a prompt of up to 16,000 characters')
    ).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })
  it('uploads four references, removes one, and submits the remaining references in order', async () => {
    let finishUploads!: () => void
    const uploadsReady = new Promise<void>((resolve) => {
      finishUploads = resolve
    })
    const post = vi.spyOn(api, 'post').mockImplementation(async (url, data) => {
      if (url === '/api/image-studio/references') {
        await uploadsReady
        const file = (data as FormData).get('image') as File
        return {
          data: { success: true, data: { id: file.name.replace('.png', '') } },
        }
      }
      return { data: { success: true, data: { id: 'task-one' } } }
    })
    const onCreated = vi.fn()
    render(
      <ImageForm
        options={options}
        reuse={null}
        reference={null}
        onCreated={onCreated}
      />,
      { wrapper }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Reference images (up to 4)' })
    )
    const input = await screen.findByLabelText('Reference images (up to 4)', {
      selector: 'input',
    })
    expect(input).toHaveAttribute('multiple')
    fireEvent.change(input, {
      target: {
        files: [1, 2, 3, 4].map(
          (number) =>
            new File(['image'], `ref-${number}.png`, { type: 'image/png' })
        ),
      },
    })
    await waitFor(() => expect(post).toHaveBeenCalledTimes(4))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Generate image/ })
      ).toBeDisabled()
    )
    finishUploads()
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Remove reference image: ref-2.png',
      })
    )
    expect(
      screen.queryByRole('button', {
        name: 'Remove reference image: ref-2.png',
      })
    ).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'A small house' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('task-one'))
    const submitted = post.mock.calls.find(
      ([url]) => url === '/api/image-studio/jobs'
    )
    expect(submitted?.[1]).toEqual(
      expect.objectContaining({ reference_ids: ['ref-1', 'ref-3', 'ref-4'] })
    )
    expect(submitted?.[1]).not.toHaveProperty('reference_id')
  })
  it('rejects five selected references without uploading any file', async () => {
    const post = vi.spyOn(api, 'post')
    render(
      <ImageForm
        options={options}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Reference images (up to 4)' })
    )
    fireEvent.change(
      await screen.findByLabelText('Reference images (up to 4)', {
        selector: 'input',
      }),
      {
        target: {
          files: [1, 2, 3, 4, 5].map(
            (number) =>
              new File(['image'], `ref-${number}.png`, { type: 'image/png' })
          ),
        },
      }
    )
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement()
    expect(post).not.toHaveBeenCalled()
  })
  it('preserves successful references when one upload fails and allows retrying the failed file', async () => {
    let failedAttempts = 0
    const post = vi.spyOn(api, 'post').mockImplementation(async (url, data) => {
      if (url === '/api/image-studio/references') {
        const file = (data as FormData).get('image') as File
        if (file.name === 'ref-2.png' && failedAttempts++ === 0) {
          throw new Error('Upload failed')
        }
        return {
          data: { success: true, data: { id: file.name.replace('.png', '') } },
        }
      }
      return { data: { success: true, data: { id: 'task-one' } } }
    })
    const onCreated = vi.fn()
    render(
      <ImageForm
        options={options}
        reuse={null}
        reference={null}
        onCreated={onCreated}
      />,
      { wrapper }
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Reference images (up to 4)' })
    )
    const input = await screen.findByLabelText('Reference images (up to 4)', {
      selector: 'input',
    })
    const first = new File(['image'], 'ref-1.png', { type: 'image/png' })
    const second = new File(['image'], 'ref-2.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [first, second] } })
    expect(await screen.findByRole('alert')).not.toBeEmptyDOMElement()
    expect(
      screen.getByRole('button', { name: 'Remove reference image: ref-1.png' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: 'Remove reference image: ref-2.png',
      })
    ).not.toBeInTheDocument()
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { files: [second] } })
    expect(
      await screen.findByRole('button', {
        name: 'Remove reference image: ref-2.png',
      })
    ).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'A small house' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('task-one'))
    expect(
      post.mock.calls.filter(([url]) => url === '/api/image-studio/references')
    ).toHaveLength(3)
    expect(post).toHaveBeenCalledWith(
      '/api/image-studio/jobs',
      expect.objectContaining({ reference_ids: ['ref-1', 'ref-2'] }),
      expect.any(Object)
    )
  })
  it('uses the same request key when retrying after a lost response', async () => {
    const post = vi
      .spyOn(api, 'post')
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({
        data: { success: true, data: { id: 'task-one' } },
      })
    const onCreated = vi.fn()
    render(
      <ImageForm
        options={options}
        reuse={null}
        reference={null}
        onCreated={onCreated}
      />,
      { wrapper }
    )
    fireEvent.change(screen.getByLabelText('Image prompt'), {
      target: { value: 'A small house' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Generate image' })
      ).toBeEnabled()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Generate image' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('task-one'))
    expect(post.mock.calls[0][2]?.headers).toEqual(
      post.mock.calls[1][2]?.headers
    )
  })
  it('keeps running tasks visible and disables deleting them', () => {
    render(
      <ImageResult
        job={{ ...job, status: 'running', assets: [] }}
        canEdit
        onReuse={vi.fn()}
        onReference={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Generating…'
    )
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled()
  })
  it('allows reusing expired parameters without offering downloads', () => {
    const reuse = vi.fn()
    render(
      <ImageResult
        job={{ ...job, status: 'expired', assets: [] }}
        canEdit
        onReuse={reuse}
        onReference={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper }
    )
    expect(
      screen.queryByRole('button', { name: 'Download' })
    ).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reuse parameters' }))
    expect(reuse).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-one' })
    )
  })
  it('shows an error with retry when the gallery request fails', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('unavailable'))
    render(<ImageStudio />, { wrapper })
    expect(
      (await screen.findAllByRole('button', { name: 'Retry' })).length
    ).toBeGreaterThan(0)
  })
  it('opens the image preview and allows using the image as a reference', () => {
    const reference = vi.fn()
    render(
      <ImageResult
        job={job}
        canEdit
        onReuse={vi.fn()}
        onReference={reference}
        onDelete={vi.fn()}
      />,
      { wrapper }
    )
    fireEvent.click(screen.getByRole('button', { name: 'Use as reference' }))
    expect(reference).toHaveBeenCalledWith(job, 'task-one-0-original')
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview generated image' })
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Image Preview')
  })
  it('requires confirmation before removing a history entry', async () => {
    vi.mocked(imageAPI.getImageJobs).mockResolvedValue([job])
    vi.mocked(api.get).mockImplementation(async (url) => ({
      data: {
        success: true,
        data: url === '/api/image-studio/options' ? options : [job],
      },
    }))
    const remove = vi
      .spyOn(imageAPI, 'deleteImageJobs')
      .mockResolvedValue(undefined)
    render(<ImageStudio />, { wrapper })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(await screen.findByRole('alertdialog')).toHaveAccessibleName(
      'Delete image generation?'
    )
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
  })
  it('selects one image from a batch and deletes only that image after confirmation', async () => {
    vi.mocked(imageAPI.getImageJobs).mockResolvedValue([batchJob])
    const remove = vi
      .spyOn(imageAPI, 'deleteImageAssets')
      .mockResolvedValue(undefined)
    render(<ImageStudio />, { wrapper })
    const selectImages = screen.getByRole('button', { name: 'Select images' })
    await waitFor(() => expect(selectImages).toBeEnabled())
    fireEvent.click(selectImages)
    const first = screen.getByRole('checkbox', {
      name: 'Select image 1: A small house',
    })
    const second = screen.getByRole('checkbox', {
      name: 'Select image 2: A small house',
    })
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    fireEvent.click(first)
    expect(first).toBeChecked()
    expect(second).not.toBeChecked()
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete selected images' })
    )
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Delete selected images?',
    })
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete selected images' })
    )
    dialog = await screen.findByRole('alertdialog', {
      name: 'Delete selected images?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(['task-one-0-original'])
    )
    expect(remove).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
  })
  it('clears finished history after confirmation while keeping a running generation', async () => {
    const running: ImageJob = {
      ...job,
      id: 'task-running',
      status: 'running',
      input: { ...job.input, prompt: 'Still generating' },
      assets: [],
    }
    const failed: ImageJob = {
      ...job,
      id: 'task-failed',
      status: 'failed',
      input: { ...job.input, prompt: 'A failed request' },
      assets: [],
    }
    vi.mocked(imageAPI.getImageJobs).mockResolvedValue([
      batchJob,
      running,
      failed,
    ])
    const remove = vi
      .spyOn(imageAPI, 'deleteImageJobs')
      .mockImplementation(async () => {
        vi.mocked(imageAPI.getImageJobs).mockResolvedValue([running])
      })
    render(<ImageStudio />, { wrapper })
    const selectImages = screen.getByRole('button', { name: 'Select images' })
    await waitFor(() => expect(selectImages).toBeEnabled())
    fireEvent.click(selectImages)
    fireEvent.click(screen.getByRole('button', { name: 'Select all images' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toBeChecked()
    }
    expect(
      screen.queryByRole('checkbox', { name: /Still generating/ })
    ).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: /Generating… Still generating/ })
    )
    expect(await screen.findByRole('status', { name: '' })).toHaveTextContent(
      'Generating…'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    let dialog = await screen.findByRole('alertdialog', {
      name: 'Clear all image history?',
    })
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    dialog = await screen.findByRole('alertdialog', {
      name: 'Clear all image history?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear all' }))
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith(['task-one', 'task-failed'])
    )
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    )
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent(
      'Generating…'
    )
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeDisabled()
  })
  it('keeps the selected-image deletion dialog open and shows an asynchronous deletion failure', async () => {
    vi.mocked(imageAPI.getImageJobs).mockResolvedValue([batchJob])
    let rejectDeletion!: (reason: Error) => void
    const remove = vi.spyOn(imageAPI, 'deleteImageAssets').mockReturnValue(
      new Promise<void>((_resolve, reject) => {
        rejectDeletion = reject
      })
    )
    render(<ImageStudio />, { wrapper })
    const selectImages = screen.getByRole('button', { name: 'Select images' })
    await waitFor(() => expect(selectImages).toBeEnabled())
    fireEvent.click(selectImages)
    fireEvent.click(screen.getByRole('button', { name: 'Select all images' }))
    fireEvent.click(
      screen.getByRole('button', { name: 'Delete selected images' })
    )
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete selected images?',
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith([
        'task-one-0-original',
        'task-one-1-original',
      ])
    )
    await waitFor(() =>
      expect(
        within(dialog).getByRole('button', { name: 'Delete' })
      ).toBeDisabled()
    )
    rejectDeletion(new Error('Browser storage is unavailable'))
    expect(
      await within(dialog).findByText('Browser storage is unavailable')
    ).toBeInTheDocument()
    expect(
      screen.getByRole('alertdialog', { name: 'Delete selected images?' })
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })
  it('keeps a missing original visible without requesting unavailable bytes or enabling download', () => {
    const load = vi.spyOn(imageAPI, 'getImageURL')
    render(
      <ImageResult
        job={{
          ...job,
          assets: [
            {
              id: 'missing-original',
              kind: 'original',
              url: '',
              unavailable: true,
            },
          ],
        }}
        canEdit
        onReuse={vi.fn()}
        onReference={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper }
    )
    expect(
      screen.getByText(
        'This image was not saved in this browser and is no longer available. You can generate it again using the saved prompt.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Use as reference' })
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Preview generated image' })
    ).toBeDisabled()
    expect(load).not.toHaveBeenCalled()
  })
  it('keeps the selected model label visible on narrow screens', async () => {
    render(
      <ImageForm
        options={options}
        reuse={null}
        reference={null}
        onCreated={vi.fn()}
      />,
      { wrapper }
    )
    expect(await screen.findByText('gpt-image-1')).not.toHaveClass('hidden')
  })
  it('loads the selected original from browser storage before enabling preview', async () => {
    const load = vi
      .spyOn(imageAPI, 'getImageURL')
      .mockResolvedValue('blob:owned-image')
    render(
      <ImageResult
        job={{
          ...job,
          assets: [{ id: 'local-original', kind: 'original', url: '' }],
        }}
        canEdit
        onReuse={vi.fn()}
        onReference={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper }
    )
    await waitFor(() => expect(load).toHaveBeenCalledWith('local-original'))
    expect(
      await screen.findByRole('img', { name: 'Generated image' })
    ).toHaveAttribute('src', 'blob:owned-image')
    expect(
      screen.getByRole('button', { name: 'Preview generated image' })
    ).toBeEnabled()
  })
  it('keeps successful output downloadable when browser persistence fails', async () => {
    vi.mocked(imageAPI.getImageJobs).mockResolvedValue([
      { ...job, storage_error: true },
    ])
    render(<ImageStudio />, { wrapper })
    expect(
      await screen.findByText(
        'Could not save some images in this browser. Download them before closing this page.'
      )
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download' })).toBeEnabled()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })
})
