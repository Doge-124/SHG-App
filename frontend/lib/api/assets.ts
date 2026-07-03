import { invoke } from '@tauri-apps/api/core'
import type { Asset, NewAssetInput, AssetSummary, ApiResponse } from '@/lib/types'

export async function getAssets(): Promise<ApiResponse<Asset[]>> {
  try {
    const assets = await invoke('list_assets') as Asset[]
    return { success: true, data: assets }
  } catch (error) {
    console.error('Failed to load assets:', error)
    return { success: false, error: 'Failed to load assets' }
  }
}

export async function getAssetSummary(): Promise<ApiResponse<AssetSummary>> {
  try {
    const summary = await invoke('get_asset_summary') as AssetSummary
    return { success: true, data: summary }
  } catch (error) {
    console.error('Failed to load asset summary:', error)
    return { success: false, error: 'Failed to load asset summary' }
  }
}

export async function addAsset(input: NewAssetInput): Promise<ApiResponse<number>> {
  try {
    const id = await invoke('add_asset', { input }) as number
    return { success: true, data: id }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to add asset' }
  }
}

export async function updateAsset(
  id: number,
  fields: { name: string; category: string; supplier?: string | null; location?: string | null; note?: string | null },
): Promise<ApiResponse<void>> {
  try {
    await invoke('update_asset', { id, ...fields })
    return { success: true }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to update asset' }
  }
}

export async function disposeAsset(
  id: number,
  proceeds: number,
  method: string | null,
  date: string,
): Promise<ApiResponse<void>> {
  try {
    await invoke('dispose_asset', { id, proceeds, method, date })
    return { success: true }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to dispose asset' }
  }
}
