import { invoke } from '@tauri-apps/api/core'
import type { 
  AppSettings, 
  GeneralSettings, 
  NotificationSettings, 
  DataSettings,
  AppearanceSettings,
  CloudBackupSettings,
  BackupInfo,
  ApiResponse
} from '@/lib/types'

// General Settings
export async function getGeneralSettings(): Promise<ApiResponse<GeneralSettings>> {
  try {
    const settings = await invoke('get_general_settings') as GeneralSettings
    return { success: true, data: settings }
  } catch (error) {
    console.error('Failed to get general settings:', error)
    return { success: false, error: 'Failed to load general settings' }
  }
}

export async function saveGeneralSettings(settings: GeneralSettings): Promise<ApiResponse<void>> {
  try {
    await invoke('save_general_settings', { settings })
    return { success: true }
  } catch (error) {
    console.error('Failed to save general settings:', error)
    return { success: false, error: 'Failed to save general settings' }
  }
}

// Notification Settings
export async function getNotificationSettings(): Promise<ApiResponse<NotificationSettings>> {
  try {
    const settings = await invoke('get_notification_settings') as NotificationSettings
    return { success: true, data: settings }
  } catch (error) {
    console.error('Failed to get notification settings:', error)
    return { success: false, error: 'Failed to load notification settings' }
  }
}

export async function saveNotificationSettings(settings: NotificationSettings): Promise<ApiResponse<void>> {
  try {
    await invoke('save_notification_settings', { settings })
    return { success: true }
  } catch (error) {
    console.error('Failed to save notification settings:', error)
    return { success: false, error: 'Failed to save notification settings' }
  }
}

// Data Settings
export async function getDataSettings(): Promise<ApiResponse<DataSettings>> {
  try {
    const settings = await invoke('get_data_settings') as DataSettings
    return { success: true, data: settings }
  } catch (error) {
    console.error('Failed to get data settings:', error)
    return { success: false, error: 'Failed to load data settings' }
  }
}

export async function saveDataSettings(settings: DataSettings): Promise<ApiResponse<void>> {
  try {
    await invoke('save_data_settings', { settings })
    return { success: true }
  } catch (error) {
    console.error('Failed to save data settings:', error)
    return { success: false, error: 'Failed to save data settings' }
  }
}

// Cloud Backup (Email) Settings
export async function getCloudBackupSettings(): Promise<ApiResponse<CloudBackupSettings>> {
  try {
    const settings = await invoke('get_cloud_backup_settings') as CloudBackupSettings
    return { success: true, data: settings }
  } catch (error) {
    console.error('Failed to get cloud backup settings:', error)
    return { success: false, error: 'Failed to load cloud backup settings' }
  }
}

export async function saveCloudBackupSettings(settings: CloudBackupSettings): Promise<ApiResponse<void>> {
  try {
    await invoke('save_cloud_backup_settings', { settings })
    return { success: true }
  } catch (error) {
    console.error('Failed to save cloud backup settings:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to save cloud backup settings' }
  }
}

/** Send a test email to verify SMTP credentials. */
export async function sendCloudTestEmail(): Promise<ApiResponse<void>> {
  try {
    await invoke('send_cloud_test_email')
    return { success: true }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to send test email' }
  }
}

/** Create a backup and email it now. */
export async function runCloudBackupNow(): Promise<ApiResponse<string>> {
  try {
    const status = await invoke('run_cloud_backup_now') as string
    return { success: true, data: status }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Failed to email backup' }
  }
}

/** Run a cloud backup only if one is due (safe to call on launch). */
export async function runCloudBackupIfDue(): Promise<ApiResponse<string>> {
  try {
    const status = await invoke('run_cloud_backup_if_due') as string
    return { success: true, data: status }
  } catch (error) {
    return { success: false, error: typeof error === 'string' ? error : 'Cloud backup check failed' }
  }
}

// Appearance Settings
export async function getAppearanceSettings(): Promise<ApiResponse<AppearanceSettings>> {
  try {
    const settings = await invoke('get_appearance_settings') as AppearanceSettings
    return { success: true, data: settings }
  } catch (error) {
    console.error('Failed to get appearance settings:', error)
    return { success: false, error: 'Failed to load appearance settings' }
  }
}

export async function saveAppearanceSettings(settings: AppearanceSettings): Promise<ApiResponse<void>> {
  try {
    await invoke('save_appearance_settings', { settings })
    return { success: true }
  } catch (error) {
    console.error('Failed to save appearance settings:', error)
    return { success: false, error: 'Failed to save appearance settings' }
  }
}

// All Settings
export async function getAllSettings(): Promise<ApiResponse<AppSettings>> {
  try {
    const settings = await invoke('get_all_settings') as AppSettings
    return { success: true, data: settings }
  } catch (error: any) {
    const errorMsg = error?.toString() || ''
    // Don't log "DB not unlocked" as error since it's expected before auth
    if (!errorMsg.includes('DB not unlocked')) {
      console.error('Failed to get all settings:', error)
    }
    return { success: false, error: 'Failed to load settings' }
  }
}

export async function saveAllSettings(settings: AppSettings): Promise<ApiResponse<void>> {
  try {
    await invoke('save_all_settings', { settings })
    return { success: true }
  } catch (error) {
    console.error('Failed to save all settings:', error)
    return { success: false, error: 'Failed to save settings' }
  }
}

// Database Operations
export async function changeDatabasePassword(currentPassword: string, newPassword: string): Promise<ApiResponse<void>> {
  try {
    await invoke('change_database_password', { currentPassword, newPassword })
    return { success: true }
  } catch (error) {
    console.error('Failed to change database password:', error)
    return { success: false, error: 'Failed to change database password' }
  }
}

// Backup Operations
export async function createBackup(): Promise<ApiResponse<BackupInfo>> {
  try {
    const backup = await invoke('create_backup') as BackupInfo
    return { success: true, data: backup }
  } catch (error) {
    console.error('Failed to create backup:', error)
    return { success: false, error: 'Failed to create backup' }
  }
}

export async function restoreBackup(backupPath: string): Promise<ApiResponse<void>> {
  try {
    await invoke('restore_backup', { backupPath })
    return { success: true }
  } catch (error) {
    console.error('Failed to restore backup:', error)
    return { success: false, error: 'Failed to restore backup' }
  }
}

export async function restoreBackupFromFile(sourcePath: string): Promise<ApiResponse<void>> {
  try {
    await invoke('restore_backup_from_file', { sourcePath })
    return { success: true }
  } catch (error) {
    console.error('Failed to restore from file:', error)
    // Surface the backend's specific message (e.g. wrong-PIN) to the user.
    return { success: false, error: typeof error === 'string' ? error : 'Failed to restore from the selected file' }
  }
}

export async function getBackupList(): Promise<ApiResponse<BackupInfo[]>> {
  try {
    const backups = await invoke('get_backup_list') as BackupInfo[]
    return { success: true, data: backups }
  } catch (error) {
    console.error('Failed to get backup list:', error)
    return { success: false, error: 'Failed to get backup list' }
  }
}

export async function clearAllData(): Promise<ApiResponse<void>> {
  try {
    await invoke('clear_all_data')
    return { success: true }
  } catch (error) {
    console.error('Failed to clear data:', error)
    return { success: false, error: 'Failed to clear data' }
  }
}

/** Clear transactional data but keep members and their savings opening balances. */
export async function clearDataKeepMembers(): Promise<ApiResponse<void>> {
  try {
    await invoke('clear_data_keep_members')
    return { success: true }
  } catch (error) {
    console.error('Failed to clear data:', error)
    return { success: false, error: typeof error === 'string' ? error : 'Failed to clear data' }
  }
}

// Password verification
export async function verifyMasterPassword(password: string): Promise<ApiResponse<boolean>> {
  try {
    const isValid = await invoke('verify_master_password', { password }) as boolean
    return { success: true, data: isValid }
  } catch (error) {
    console.error('Failed to verify password:', error)
    return { success: false, error: 'Failed to verify password' }
  }
}

// Past data lock
export async function getPastDataLockStatus(): Promise<ApiResponse<boolean>> {
  try {
    const locked = await invoke('get_past_data_lock_status') as boolean
    return { success: true, data: locked }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export async function lockPastDataEntry(): Promise<ApiResponse<void>> {
  try {
    await invoke('lock_past_data_entry')
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export async function unlockPastDataEntry(adminPin: string): Promise<ApiResponse<void>> {
  try {
    await invoke('unlock_past_data_entry', { adminPin })
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}
