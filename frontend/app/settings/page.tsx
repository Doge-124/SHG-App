'use client'

import { useState, useEffect } from 'react'
import {
  Building2,
  Users,
  Shield,
  Database,
  Bell,
  Palette,
  Save,
  Check,
  Lock,
  LockOpen,
  RefreshCw,
  Download,
  FileText,
  Wrench,
  Printer,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { PageHeader } from '@/components/page-header'
import { Spinner } from '@/components/ui/spinner'
import { invoke } from '@tauri-apps/api/core'
import { check as checkUpdate } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
import { readDir, readFile, writeFile, BaseDirectory } from '@tauri-apps/plugin-fs'
import {
  getAllSettings,
  saveAllSettings,
  createBackup,
  restoreBackup,
  clearAllData,
  clearDataKeepMembers,
  changeDatabasePassword,
  getBackupList,
  verifyMasterPassword,
  getPastDataLockStatus,
  lockPastDataEntry,
  unlockPastDataEntry,
  getCloudBackupSettings,
  saveCloudBackupSettings,
  sendCloudTestEmail,
  runCloudBackupNow,
} from '@/lib/api/settings'
import { useAppearance } from '@/lib/appearance-context'
import { useSettings } from '@/lib/settings-context'
import { isAutoPrintEnabled, setAutoPrintEnabled, isSilentPrintEnabled, setSilentPrintEnabled } from '@/lib/auto-print'
import type { AppSettings, BackupInfo, CloudBackupSettings } from '@/lib/types'

const DEFAULT_CLOUD_BACKUP: CloudBackupSettings = {
  enabled: false,
  smtpHost: 'smtp.gmail.com',
  smtpPort: 587,
  username: '',
  appPassword: '',
  fromEmail: '',
  recipient: '',
  frequency: 'daily',
  lastBackupAt: null,
}

export default function SettingsPage() {
  const [isSaving, setIsSaving] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<string | null>(null)
  const [isExportingLogs, setIsExportingLogs] = useState(false)
  const [isDiagnosing, setIsDiagnosing] = useState(false)
  const [diagnosticText, setDiagnosticText] = useState<string | null>(null)
  const [isCheckingIntegrity, setIsCheckingIntegrity] = useState(false)
  const [integrityReport, setIntegrityReport] = useState<any | null>(null)
  const [crashStatus, setCrashStatus] = useState<{ configured: boolean; enabled: boolean } | null>(null)
  const [isTestingCrash, setIsTestingCrash] = useState(false)
  const [licenseStatus, setLicenseStatus] = useState<any | null>(null)
  const [isRefreshingLicense, setIsRefreshingLicense] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [isRestoreLoading, setIsRestoreLoading] = useState(false)
  const [clearDataDialogOpen, setClearDataDialogOpen] = useState(false)
  const [clearMode, setClearMode] = useState<'all' | 'keep'>('all')
  const [clearDataPassword, setClearDataPassword] = useState('')
  const [clearDataConfirmed, setClearDataConfirmed] = useState(false)
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false)
  const [changeAdminPinDialogOpen, setChangeAdminPinDialogOpen] = useState(false)
  const [currentAdminPin, setCurrentAdminPin] = useState('')
  const [newAdminPin, setNewAdminPin] = useState('')
  const [confirmAdminPin, setConfirmAdminPin] = useState('')
  const [isChangingAdminPin, setIsChangingAdminPin] = useState(false)
  const [pastDataLocked, setPastDataLocked] = useState(false)
  const [shgOpeningLocked, setShgOpeningLocked] = useState(false)
  const [shgOpeningCash, setShgOpeningCash] = useState('')
  const [shgOpeningBank, setShgOpeningBank] = useState('')
  const [shgOpeningExisting, setShgOpeningExisting] = useState({ cash: 0, bank: 0 })
  const [isSavingOpening, setIsSavingOpening] = useState(false)
  const [lockDialogOpen, setLockDialogOpen] = useState(false)
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false)
  const [unlockAdminPin, setUnlockAdminPin] = useState('')
  const [isTogglingLock, setIsTogglingLock] = useState(false)
  const [autoPrintDocs, setAutoPrintDocs] = useState(false)
  const [silentPrint, setSilentPrint] = useState(false)
  const [cloud, setCloud] = useState<CloudBackupSettings>(DEFAULT_CLOUD_BACKUP)
  const [isSavingCloud, setIsSavingCloud] = useState(false)
  const [isTestingEmail, setIsTestingEmail] = useState(false)
  const [isCloudBackingUp, setIsCloudBackingUp] = useState(false)

  const { settings: globalSettings, updateSettings, refreshSettings, pastDataLocked: globalLocked, refreshPastDataLock } = useSettings()
  const appearance = useAppearance()

  // Local state for form — initialised empty; synced from DB via useEffect below.
  const [settings, setSettings] = useState<AppSettings>({
    general: {
      groupName: '',
      registrationNumber: '',
      address: '',
      contactPhone: '',
      contactEmail: '',
    },
    notifications: {
      enableNotifications: true,
      enableEmailAlerts: false,
      loanDueReminders: true,
      chitCycleAlerts: true,
      newMemberRequests: true,
      paymentConfirmations: false,
    },
    data: {
      autoBackup: true,
      backupFrequency: 'daily',
      lastBackupDate: undefined,
    },
    appearance: {
      theme: 'light',
      language: 'english',
    },
  })

  // Sync local form state with global settings
  useEffect(() => {
    if (globalSettings) {
      setSettings({
        general: {
          groupName: globalSettings.general.groupName || '',
          registrationNumber: globalSettings.general.registrationNumber || '',
          address: globalSettings.general.address || '',
          contactPhone: globalSettings.general.contactPhone || '',
          contactEmail: globalSettings.general.contactEmail || '',
        },
        notifications: {
          enableNotifications: globalSettings.notifications.enableNotifications ?? true,
          enableEmailAlerts: globalSettings.notifications.enableEmailAlerts ?? false,
          loanDueReminders: globalSettings.notifications.loanDueReminders ?? true,
          chitCycleAlerts: globalSettings.notifications.chitCycleAlerts ?? true,
          newMemberRequests: globalSettings.notifications.newMemberRequests ?? true,
          paymentConfirmations: globalSettings.notifications.paymentConfirmations ?? false,
        },
        data: {
          autoBackup: globalSettings.data.autoBackup ?? true,
          backupFrequency: globalSettings.data.backupFrequency || 'daily',
          lastBackupDate: globalSettings.data.lastBackupDate,
        },
        appearance: {
          // Use appearance context values instead of database for theme
          theme: appearance.theme,
          language: appearance.language,
        }
      })
    }
  }, [globalSettings, appearance.theme, appearance.language])

  useEffect(() => { setPastDataLocked(globalLocked) }, [globalLocked])

  // Auto-print is a per-machine preference held in localStorage.
  useEffect(() => {
    setAutoPrintDocs(isAutoPrintEnabled())
    setSilentPrint(isSilentPrintEnabled())
  }, [])

  // Load cloud-backup (email) settings from the encrypted DB on mount.
  useEffect(() => {
    getCloudBackupSettings().then((r) => {
      if (r.success && r.data) setCloud({ ...DEFAULT_CLOUD_BACKUP, ...r.data })
    })
  }, [])

  const handleSaveCloudBackup = async () => {
    setIsSavingCloud(true)
    try {
      const res = await saveCloudBackupSettings(cloud)
      if (res.success) toast.success('Cloud backup settings saved')
      else toast.error(res.error || 'Failed to save')
    } finally {
      setIsSavingCloud(false)
    }
  }

  const handleTestEmail = async () => {
    setIsTestingEmail(true)
    try {
      // Persist first so the test uses exactly what's on screen.
      const saved = await saveCloudBackupSettings(cloud)
      if (!saved.success) { toast.error(saved.error || 'Failed to save settings'); return }
      const res = await sendCloudTestEmail()
      if (res.success) toast.success('Test email sent — check the recipient inbox')
      else toast.error(res.error || 'Failed to send test email')
    } finally {
      setIsTestingEmail(false)
    }
  }

  const handleCloudBackupNow = async () => {
    setIsCloudBackingUp(true)
    try {
      const saved = await saveCloudBackupSettings(cloud)
      if (!saved.success) { toast.error(saved.error || 'Failed to save settings'); return }
      const res = await runCloudBackupNow()
      if (res.success) {
        toast.success('Backup emailed successfully')
        const r = await getCloudBackupSettings()
        if (r.success && r.data) setCloud({ ...DEFAULT_CLOUD_BACKUP, ...r.data })
      } else {
        toast.error(res.error || 'Failed to email backup')
      }
    } finally {
      setIsCloudBackingUp(false)
    }
  }

  const handleToggleAutoPrint = (checked: boolean) => {
    setAutoPrintEnabled(checked)
    setAutoPrintDocs(checked)
    toast.success(
      checked
        ? 'Auto-print on — new receipts and vouchers will print automatically'
        : 'Auto-print off'
    )
  }

  const handleToggleSilentPrint = (checked: boolean) => {
    setSilentPrintEnabled(checked)
    setSilentPrint(checked)
    toast.success(
      checked
        ? 'Silent printing on — documents print straight to the printer'
        : 'Silent printing off — the print dialog will be shown'
    )
  }

  const handleSetShgOpeningBalance = async () => {
    const cash = parseFloat(shgOpeningCash) || 0
    const bank = parseFloat(shgOpeningBank) || 0
    if (cash < 0 || bank < 0) { toast.error('Amounts cannot be negative'); return }
    if (cash === 0 && bank === 0) { toast.error('Enter at least one non-zero balance'); return }
    setIsSavingOpening(true)
    try {
      await invoke('set_shg_opening_balance', { cash, bank })
      setShgOpeningLocked(true)
      setShgOpeningExisting({ cash, bank })
      setShgOpeningCash('')
      setShgOpeningBank('')
      toast.success('SHG opening balance set and locked')
    } catch (err: any) {
      toast.error(err?.toString() || 'Failed to set opening balance')
    } finally {
      setIsSavingOpening(false)
    }
  }

  // Load SHG opening balance status on mount
  useEffect(() => {
    invoke<{ locked: boolean; cash: number; bank: number }>('get_shg_opening_status')
      .then(s => {
        setShgOpeningLocked(s.locked)
        setShgOpeningExisting({ cash: s.cash, bank: s.bank })
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    invoke<{ configured: boolean; enabled: boolean }>('get_crash_reporting_status')
      .then(setCrashStatus)
      .catch(() => setCrashStatus({ configured: false, enabled: false }))
  }, [])

  useEffect(() => {
    invoke<any>('get_license_status').then(setLicenseStatus).catch(() => {})
  }, [])

  const refreshLicense = async () => {
    setIsRefreshingLicense(true)
    try {
      const s = await invoke<any>('get_license_status')
      setLicenseStatus(s)
      toast.success('License re-validated')
    } catch (e) {
      toast.error('Re-validation failed: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setIsRefreshingLicense(false)
    }
  }

  const handleLockPastData = async () => {
    setIsTogglingLock(true)
    try {
      const res = await lockPastDataEntry()
      if (res.success) {
        setLockDialogOpen(false)
        await refreshPastDataLock()
        toast.success('Past data entry is now locked')
      } else {
        toast.error(res.error || 'Failed to lock')
      }
    } finally {
      setIsTogglingLock(false)
    }
  }

  const handleUnlockPastData = async () => {
    if (!unlockAdminPin.trim()) { toast.error('Enter admin PIN'); return }
    setIsTogglingLock(true)
    try {
      const res = await unlockPastDataEntry(unlockAdminPin)
      if (res.success) {
        setUnlockDialogOpen(false)
        setUnlockAdminPin('')
        await refreshPastDataLock()
        toast.success('Past data entry unlocked')
      } else {
        toast.error(res.error || 'Incorrect admin PIN')
      }
    } finally {
      setIsTogglingLock(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await saveAllSettings(settings)
      if (response.success) {
        toast.success('Settings saved successfully')
        // Update global state and refresh all components
        updateSettings(settings)
        await refreshSettings()
      } else {
        toast.error(response.error || 'Failed to save settings')
      }
    } catch (error) {
      console.error('Failed to save settings:', error)
      toast.error('An error occurred while saving settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDebugSettings = async () => {
    try {
      const settingsJson = await invoke('debug_settings_json') as string
      
      if (settingsJson.includes('group_name')) {
        await invoke('force_migrate_settings')
        toast.success('Settings migrated successfully')
        
        // Refresh global settings
        await refreshSettings()
      } else {
        toast.info('Settings already in correct format')
      }
    } catch (error) {
      console.error('Debug error:', error)
      toast.error('Debug operation failed')
    }
  }

  const handleBackup = async () => {
    try {
      const response = await createBackup()
      if (response.success && response.data) {
        toast.success(`Backup created: ${response.data.fileName}`)
        // Update last backup date
        setSettings(prev => ({
          ...prev,
          data: {
            ...prev.data,
            lastBackupDate: response.data!.createdAt
          }
        }))
      } else {
        toast.error(response.error || 'Failed to create backup')
      }
    } catch (error) {
      console.error('Failed to create backup:', error)
      toast.error('An error occurred while creating backup')
    }
  }

  const handleClearData = (mode: 'all' | 'keep' = 'all') => {
    setClearMode(mode)
    setClearDataDialogOpen(true)
  }

  const handleVerifyAndClearData = async () => {
    if (!clearDataPassword.trim()) {
      toast.error('Please enter your admin PIN')
      return
    }
    if (!clearDataConfirmed) {
      toast.error('Please tick the box to confirm you understand this is permanent')
      return
    }

    setIsVerifyingPassword(true)
    try {
      // Verify the admin PIN (the one set during initial app setup).
      const verifyResponse = await verifyMasterPassword(clearDataPassword)
      if (!verifyResponse.success) {
        toast.error(verifyResponse.error || 'Could not verify admin PIN')
        return
      }
      if (!verifyResponse.data) {
        toast.error('Incorrect admin PIN')
        return
      }

      // PIN verified + box ticked → no native confirm() (unreliable in the
      // Tauri webview). Proceed directly.
      const response = clearMode === 'keep'
        ? await clearDataKeepMembers()
        : await clearAllData()
      if (!response.success) {
        toast.error(response.error || 'Failed to clear data')
        return
      }

      toast.success(clearMode === 'keep'
        ? 'Data cleared — members and their opening balances were kept'
        : 'All data cleared successfully')
      setClearDataDialogOpen(false)
      setClearDataPassword('')
      setClearDataConfirmed(false)

      // Full clear resets settings too, so mirror that in the live UI. The
      // keep-members clear preserves settings, so leave appearance alone.
      if (clearMode === 'all') {
        appearance.setTheme('light')
        appearance.setLanguage('english')
      }

      // Refresh global settings context from the now-reset DB
      await refreshSettings()

      // Redirect to home page after a short delay
      setTimeout(() => {
        window.location.href = '/'
      }, 1500)
    } catch (error) {
      console.error('Failed to clear data:', error)
      toast.error('An error occurred while clearing data')
    } finally {
      setIsVerifyingPassword(false)
    }
  }

  const handleCancelClearData = () => {
    setClearDataDialogOpen(false)
    setClearDataPassword('')
    setClearDataConfirmed(false)
  }

  const handleOpenRestoreDialog = async () => {
    setIsRestoreLoading(true)
    try {
      const response = await getBackupList()
      if (response.success && response.data) {
        setBackups(response.data)
        setRestoreDialogOpen(true)
      } else {
        toast.error(response.error || 'Failed to load backups')
      }
    } catch (error) {
      console.error('Failed to load backup list:', error)
      toast.error('An error occurred while loading backups')
    } finally {
      setIsRestoreLoading(false)
    }
  }

  const handleRestoreBackup = async (backupPath: string) => {
    if (confirm('Are you sure you want to restore this backup? This will replace all current data with the backup data. This action cannot be undone.')) {
      setIsRestoreLoading(true)
      try {
        const response = await restoreBackup(backupPath)
        if (response.success) {
          toast.success('Backup restored successfully. Please restart the application.')
          setRestoreDialogOpen(false)
        } else {
          toast.error(response.error || 'Failed to restore backup')
        }
      } catch (error) {
        console.error('Failed to restore backup:', error)
        toast.error('An error occurred while restoring backup')
      } finally {
        setIsRestoreLoading(false)
      }
    }
  }

  const handleChangeAdminPin = async () => {
    if (!currentAdminPin.trim()) {
      toast.error('Please enter your current admin PIN')
      return
    }
    if (newAdminPin.length < 4) {
      toast.error('New admin PIN must be at least 4 characters')
      return
    }
    if (newAdminPin !== confirmAdminPin) {
      toast.error('New admin PINs do not match')
      return
    }
    setIsChangingAdminPin(true)
    try {
      await invoke('change_admin_pin', {
        currentAdminPin: currentAdminPin,
        newAdminPin: newAdminPin,
      })
      toast.success('Admin PIN changed successfully')
      setChangeAdminPinDialogOpen(false)
      setCurrentAdminPin('')
      setNewAdminPin('')
      setConfirmAdminPin('')
    } catch (error) {
      toast.error((error as string) || 'Failed to change admin PIN')
    } finally {
      setIsChangingAdminPin(false)
    }
  }

  const handleThemeChange = (theme: 'light' | 'dark' | 'system') => {
    setSettings(prev => ({
      ...prev,
      appearance: {
        ...prev.appearance,
        theme
      }
    }))
    // Apply theme immediately via context
    appearance.setTheme(theme)
  }

  const handleLanguageChange = (language: 'english' | 'hindi' | 'tamil') => {
    setSettings(prev => ({
      ...prev,
      appearance: {
        ...prev.appearance,
        language
      }
    }))
    // Apply language immediately via context
    appearance.setLanguage(language)
  }

  // Show loading state only if global settings are not loaded yet
  if (!globalSettings) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Settings"
          description="Manage your SHG application settings"
        />
        <div className="flex items-center justify-center py-12">
          <Spinner className="h-8 w-8" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your SHG application settings"
      >
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Changes
              </>
            )}
          </Button>
        </div>
      </PageHeader>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="general" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">General</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4" />
            <span className="hidden sm:inline">Notifications</span>
          </TabsTrigger>
          <TabsTrigger value="data" className="gap-2">
            <Database className="h-4 w-4" />
            <span className="hidden sm:inline">Data</span>
          </TabsTrigger>
          <TabsTrigger value="appearance" className="gap-2">
            <Palette className="h-4 w-4" />
            <span className="hidden sm:inline">Appearance</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>Group Information</CardTitle>
              <CardDescription>
                Basic information about your Self Help Group
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="groupName">Group Name</Label>
                  <Input
                    id="groupName"
                    value={settings.general.groupName}
                    onChange={(e) =>
                      setSettings((s) => ({ 
                        ...s, 
                        general: { ...s.general, groupName: e.target.value }
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="registrationNumber">Registration Number</Label>
                  <Input
                    id="registrationNumber"
                    value={settings.general.registrationNumber}
                    onChange={(e) =>
                      setSettings((s) => ({ 
                        ...s, 
                        general: { ...s.general, registrationNumber: e.target.value }
                      }))
                    }
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="address">Address</Label>
                <Input
                  id="address"
                  value={settings.general.address}
                  onChange={(e) =>
                    setSettings((s) => ({ 
                      ...s, 
                      general: { ...s.general, address: e.target.value }
                    }))
                  }
                />
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Contact Phone</Label>
                  <Input
                    id="contactPhone"
                    value={settings.general.contactPhone}
                    onChange={(e) =>
                      setSettings((s) => ({ 
                        ...s, 
                        general: { ...s.general, contactPhone: e.target.value }
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactEmail">Contact Email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    value={settings.general.contactEmail}
                    onChange={(e) =>
                      setSettings((s) => ({ 
                        ...s, 
                        general: { ...s.general, contactEmail: e.target.value }
                      }))
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Security</CardTitle>
              <CardDescription>
                Security and access settings
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Database Encryption</Label>
                  <p className="text-sm text-muted-foreground">
                    Your data is encrypted using SQLCipher
                  </p>
                </div>
                <div className="flex items-center gap-2 text-success">
                  <Check className="h-4 w-4" />
                  <span className="text-sm font-medium">Enabled</span>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Change Admin PIN</Label>
                  <p className="text-sm text-muted-foreground">
                    Update the recovery PIN used to reset your main PIN
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setChangeAdminPinDialogOpen(true)}>
                  <Shield className="mr-2 h-4 w-4" />
                  Change Admin PIN
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="mt-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Printer className="h-5 w-5" />
                Printing
              </CardTitle>
              <CardDescription>
                Control how receipts and vouchers are printed
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5 pr-4">
                  <Label>Auto-print receipts &amp; vouchers</Label>
                  <p className="text-sm text-muted-foreground">
                    When on, every receipt or voucher is sent straight to the printer
                    the moment it is created — loan repayments, chit installments,
                    payouts, contributions, and manual receipts/vouchers. Turn off to
                    print each document manually.
                  </p>
                </div>
                <Switch
                  checked={autoPrintDocs}
                  onCheckedChange={handleToggleAutoPrint}
                />
              </div>

              {autoPrintDocs && (
                <>
                  <Separator />
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5 pr-4">
                      <Label>Silent printing (no dialog)</Label>
                      <p className="text-sm text-muted-foreground">
                        Send documents straight to the default printer without
                        showing the print dialog. Requires a silent-capable PDF
                        reader (e.g. SumatraPDF, Adobe, or Foxit Reader) set as
                        the system default. If none is available, the app falls
                        back to the print dialog automatically.
                      </p>
                    </div>
                    <Switch
                      checked={silentPrint}
                      onCheckedChange={handleToggleSilentPrint}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>
                Configure how you receive notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>In-App Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Show notifications within the application
                  </p>
                </div>
                <Switch
                  checked={settings.notifications.enableNotifications}
                  onCheckedChange={(checked) =>
                    setSettings((s) => ({ 
                      ...s, 
                      notifications: { ...s.notifications, enableNotifications: checked }
                    }))
                  }
                />
              </div>

              <Separator />

              <div className="flex items-center justify-between opacity-60">
                <div className="space-y-0.5">
                  <Label>Email Alerts</Label>
                  <p className="text-sm text-muted-foreground">
                    Not available — requires external email configuration
                  </p>
                </div>
                <Switch
                  checked={false}
                  disabled
                />
              </div>

              <Separator />

              <div className="space-y-4">
                <Label>Notification Types</Label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <span className="text-sm">Loan Due Reminders</span>
                    <Switch 
                      checked={settings.notifications.loanDueReminders}
                      onCheckedChange={(checked) =>
                        setSettings((s) => ({ 
                          ...s, 
                          notifications: { ...s.notifications, loanDueReminders: checked }
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <span className="text-sm">Chit Cycle Alerts</span>
                    <Switch 
                      checked={settings.notifications.chitCycleAlerts}
                      onCheckedChange={(checked) =>
                        setSettings((s) => ({ 
                          ...s, 
                          notifications: { ...s.notifications, chitCycleAlerts: checked }
                        }))
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50 opacity-60">
                    <span className="text-sm">New Member Requests</span>
                    <Switch checked={false} disabled />
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                    <span className="text-sm">Payment Confirmations</span>
                    <Switch 
                      checked={settings.notifications.paymentConfirmations}
                      onCheckedChange={(checked) =>
                        setSettings((s) => ({ 
                          ...s, 
                          notifications: { ...s.notifications, paymentConfirmations: checked }
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data">
          <Card>
            <CardHeader>
              <CardTitle>Data Management</CardTitle>
              <CardDescription>
                Backup, restore, and manage your data
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Automatic Backups</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically backup your data
                  </p>
                </div>
                <Switch
                  checked={settings.data.autoBackup}
                  onCheckedChange={(checked) =>
                    setSettings((s) => ({ 
                      ...s, 
                      data: { ...s.data, autoBackup: checked }
                    }))
                  }
                />
              </div>

              <Separator />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="p-4 rounded-lg border bg-card">
                  <h4 className="font-medium mb-2">Last Backup</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    {settings.data.lastBackupDate 
                      ? new Date(settings.data.lastBackupDate).toLocaleString()
                      : 'No backup created yet'
                    }
                  </p>
                  <Button variant="outline" size="sm" className="w-full" onClick={handleBackup}>
                    <Database className="mr-2 h-4 w-4" />
                    Backup Now
                  </Button>
                </div>

                <div className="p-4 rounded-lg border bg-card">
                  <h4 className="font-medium mb-2">Restore Data</h4>
                  <p className="text-sm text-muted-foreground mb-3">
                    Restore from a previous backup
                  </p>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="w-full" 
                    onClick={handleOpenRestoreDialog}
                    disabled={isRestoreLoading}
                  >
                    {isRestoreLoading ? (
                      <Spinner className="mr-2 h-4 w-4" />
                    ) : (
                      <Database className="mr-2 h-4 w-4" />
                    )}
                    Restore Backup
                  </Button>
                </div>
              </div>

              <Separator />

              {/* Automatic Cloud Backup (Email) */}
              <div className="space-y-4 rounded-lg border p-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="flex items-center gap-2">
                      <Database className="h-4 w-4" />
                      Automatic Cloud Backup (Email)
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Email an encrypted backup to yourself on a schedule using your own
                      email account.
                    </p>
                  </div>
                  <Switch
                    checked={cloud.enabled}
                    onCheckedChange={(checked) => setCloud((c) => ({ ...c, enabled: checked }))}
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="smtpHost">SMTP Host</Label>
                    <Input
                      id="smtpHost"
                      value={cloud.smtpHost}
                      placeholder="smtp.gmail.com"
                      onChange={(e) => setCloud((c) => ({ ...c, smtpHost: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="smtpPort">SMTP Port</Label>
                    <Input
                      id="smtpPort"
                      type="number"
                      value={cloud.smtpPort === 0 ? '' : cloud.smtpPort}
                      placeholder="587"
                      onChange={(e) => setCloud((c) => ({ ...c, smtpPort: parseInt(e.target.value) || 0 }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="smtpUser">Sender Email</Label>
                    <Input
                      id="smtpUser"
                      type="email"
                      value={cloud.username}
                      placeholder="you@gmail.com"
                      onChange={(e) => setCloud((c) => ({ ...c, username: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="smtpPass">App Password</Label>
                    <Input
                      id="smtpPass"
                      type="password"
                      value={cloud.appPassword}
                      placeholder="App password (not your login password)"
                      onChange={(e) => setCloud((c) => ({ ...c, appPassword: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cloudRecipient">Send Backup To</Label>
                    <Input
                      id="cloudRecipient"
                      type="email"
                      value={cloud.recipient}
                      placeholder={cloud.username || 'recipient@example.com'}
                      onChange={(e) => setCloud((c) => ({ ...c, recipient: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cloudFrequency">Frequency</Label>
                    <select
                      id="cloudFrequency"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={cloud.frequency}
                      onChange={(e) => setCloud((c) => ({ ...c, frequency: e.target.value as CloudBackupSettings['frequency'] }))}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  For Gmail, enable 2-Step Verification and create an{' '}
                  <span className="font-medium">App Password</span> — use that here, not your
                  normal password. The emailed database is encrypted; restoring it needs this
                  app and your PIN. Last cloud backup:{' '}
                  <span className="font-medium">
                    {cloud.lastBackupAt ? new Date(cloud.lastBackupAt).toLocaleString() : 'never'}
                  </span>
                </p>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={handleSaveCloudBackup} disabled={isSavingCloud}>
                    {isSavingCloud ? <Spinner className="mr-2 h-4 w-4" /> : <Save className="mr-2 h-4 w-4" />}
                    Save
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleTestEmail} disabled={isTestingEmail}>
                    {isTestingEmail ? <Spinner className="mr-2 h-4 w-4" /> : <Bell className="mr-2 h-4 w-4" />}
                    Send test email
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleCloudBackupNow} disabled={isCloudBackingUp}>
                    {isCloudBackingUp ? <Spinner className="mr-2 h-4 w-4" /> : <Database className="mr-2 h-4 w-4" />}
                    Back up &amp; email now
                  </Button>
                </div>
              </div>

              <Separator />

              {/* SHG Opening Balance */}
              <div className={`p-4 rounded-lg border ${shgOpeningLocked ? 'border-green-500 bg-green-50 dark:bg-green-950/20' : 'border-blue-400 bg-blue-50 dark:bg-blue-950/20'}`}>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    {shgOpeningLocked
                      ? <Lock className="h-4 w-4 text-green-600" />
                      : <LockOpen className="h-4 w-4 text-blue-600" />}
                    <h4 className="font-medium">SHG Opening Balance</h4>
                  </div>
                  {shgOpeningLocked ? (
                    <div className="space-y-1">
                      <p className="text-sm text-green-700 font-medium">Opening balance is set and locked.</p>
                      <p className="text-sm text-muted-foreground">
                        Cash: ₹{shgOpeningExisting.cash.toLocaleString('en-IN')} &nbsp;|&nbsp;
                        Bank: ₹{shgOpeningExisting.bank.toLocaleString('en-IN')}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        This is the starting balance for the SHG. All future transactions will reflect on top of this.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Enter the current cash and bank balance of the SHG before you start recording transactions.
                        This will be the starting point and will be locked once set.
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <Label htmlFor="opening-cash">Cash Balance (₹)</Label>
                          <Input
                            id="opening-cash"
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            value={shgOpeningCash}
                            onChange={e => setShgOpeningCash(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="opening-bank">Bank Balance (₹)</Label>
                          <Input
                            id="opening-bank"
                            type="number"
                            min={0}
                            step="0.01"
                            placeholder="0.00"
                            value={shgOpeningBank}
                            onChange={e => setShgOpeningBank(e.target.value)}
                          />
                        </div>
                      </div>
                      <Button
                        onClick={handleSetShgOpeningBalance}
                        disabled={isSavingOpening}
                        className="w-full"
                      >
                        {isSavingOpening && <Spinner className="mr-2 h-4 w-4" />}
                        <Lock className="mr-2 h-4 w-4" />
                        Set & Lock Opening Balance
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              <div className={`p-4 rounded-lg border ${pastDataLocked ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20' : 'border-muted'}`}>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      {pastDataLocked
                        ? <Lock className="h-4 w-4 text-amber-600" />
                        : <LockOpen className="h-4 w-4 text-muted-foreground" />
                      }
                      <h4 className="font-medium">Past Data Entry Lock</h4>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {pastDataLocked
                        ? 'Past data entry is locked. Member opening data, past loans, and past chit cycles cannot be modified.'
                        : 'Lock past data entry once all historical records are entered to prevent accidental changes.'}
                    </p>
                  </div>
                  {pastDataLocked ? (
                    <Button variant="outline" size="sm" onClick={() => setUnlockDialogOpen(true)}>
                      <LockOpen className="mr-2 h-4 w-4" />
                      Unlock
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => setLockDialogOpen(true)}>
                      <Lock className="mr-2 h-4 w-4" />
                      Lock
                    </Button>
                  )}
                </div>
              </div>

              <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                <h4 className="font-medium text-destructive mb-2">Danger Zone</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  These actions are irreversible. Please be careful.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="border-amber-400 text-amber-700 hover:bg-amber-50" onClick={() => handleClearData('keep')}>
                    <Users className="mr-2 h-4 w-4" />
                    Clear Data (Keep Members)
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleClearData('all')}>
                    Clear All Data
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  <strong>Clear Data (Keep Members)</strong> wipes loans, chits, receipts, vouchers and
                  balances but keeps your members and their entered savings opening balances — use it
                  to go live after testing without re-adding everyone.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>
                Customize the look and feel of the application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <Label>Theme</Label>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { name: 'Light', value: 'light' },
                    { name: 'Dark', value: 'dark' },
                    { name: 'System', value: 'system' },
                  ].map((theme) => (
                    <button
                      type="button"
                      key={theme.value}
                      onClick={() => handleThemeChange(theme.value as 'light' | 'dark' | 'system')}
                      className={`p-4 rounded-lg border-2 text-center transition-colors ${
                        settings.appearance.theme === theme.value
                          ? 'border-primary bg-primary/5'
                          : 'border-muted hover:border-muted-foreground/20'
                      }`}
                    >
                      <Palette className="h-6 w-6 mx-auto mb-2" />
                      <span className="text-sm font-medium">{theme.name}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <Label>Language</Label>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-primary"
                    disabled
                  >
                    English
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  English is the only supported language
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Support & Updates ─────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Support & Updates
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Auto-update */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Software Updates</p>
            <p className="text-xs text-muted-foreground">
              Checks GitHub for a newer version and installs it automatically.
              The app will restart after installation.
            </p>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                disabled={isCheckingUpdate}
                onClick={async () => {
                  setIsCheckingUpdate(true)
                  setUpdateStatus(null)
                  try {
                    const update = await checkUpdate()
                    if (update) {
                      setUpdateStatus(`Update available: v${update.version}. Downloading…`)
                      await update.downloadAndInstall()
                      setUpdateStatus('Installed. Restarting…')
                      await relaunch()
                    } else {
                      setUpdateStatus('You are on the latest version.')
                    }
                  } catch (err: any) {
                    const msg = err?.toString() ?? 'unknown error'
                    // 404 on latest.json usually means the release hasn't published
                    // its updater manifest yet. Anything else is genuinely a network
                    // or signature issue.
                    if (msg.includes('404') || msg.toLowerCase().includes('not found')) {
                      setUpdateStatus('No updater manifest found on the latest release yet. Try again later.')
                    } else {
                      setUpdateStatus('Update check failed: ' + msg)
                    }
                  } finally {
                    setIsCheckingUpdate(false)
                  }
                }}
              >
                {isCheckingUpdate
                  ? <><Spinner className="mr-2 h-4 w-4" />Checking…</>
                  : <><RefreshCw className="mr-2 h-4 w-4" />Check for Updates</>}
              </Button>
              {updateStatus && (
                <p className="text-sm text-muted-foreground">{updateStatus}</p>
              )}
            </div>
          </div>

          <Separator />

          {/* Log export */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Export Logs</p>
            <p className="text-xs text-muted-foreground">
              Saves the application log file to a location you choose.
              Send this to support when reporting a problem.
            </p>
            <Button
              variant="outline"
              disabled={isExportingLogs}
              onClick={async () => {
                setIsExportingLogs(true)
                try {
                  const logDir = await invoke<string>('get_log_dir')
                  // Read the most recent log file
                  const files = await readDir(logDir)
                  const logFiles = files
                    .filter(f => f.name?.endsWith('.log'))
                    .sort((a, b) => (b.name ?? '').localeCompare(a.name ?? ''))
                  if (logFiles.length === 0) {
                    toast.error('No log files found yet. Use the app a bit first.')
                    return
                  }
                  const latestLog = logFiles[0]
                  const content = await readFile(`${logDir}/${latestLog.name}`)
                  const savePath = await saveDialog({
                    defaultPath: `shg-manager-logs-${new Date().toISOString().split('T')[0]}.log`,
                    filters: [{ name: 'Log Files', extensions: ['log', 'txt'] }],
                  })
                  if (savePath) {
                    await writeFile(savePath, content)
                    toast.success(`Log exported to ${savePath}`)
                  }
                } catch (err: any) {
                  toast.error('Failed to export logs: ' + err?.toString())
                } finally {
                  setIsExportingLogs(false)
                }
              }}
            >
              {isExportingLogs
                ? <><Spinner className="mr-2 h-4 w-4" />Exporting…</>
                : <><Download className="mr-2 h-4 w-4" />Export Logs</>}
            </Button>
          </div>

          <Separator />

          {/* Database integrity check */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Database Integrity Check</p>
            <p className="text-xs text-muted-foreground">
              Validates database structure, foreign-key constraints, and balance invariants.
              Run if you suspect data inconsistency or before submitting a support ticket.
            </p>
            <Button
              variant="outline"
              disabled={isCheckingIntegrity}
              onClick={async () => {
                setIsCheckingIntegrity(true)
                setIntegrityReport(null)
                try {
                  const report = await invoke<any>('check_db_integrity')
                  setIntegrityReport(report)
                  if (report.overallOk) {
                    toast.success('Database integrity OK')
                  } else {
                    toast.error(`Database integrity check found ${report.errorCount} error(s)`)
                  }
                } catch (err: any) {
                  toast.error('Integrity check failed: ' + err?.toString())
                } finally {
                  setIsCheckingIntegrity(false)
                }
              }}
            >
              {isCheckingIntegrity
                ? <><Spinner className="mr-2 h-4 w-4" />Checking…</>
                : <><Check className="mr-2 h-4 w-4" />Run Integrity Check</>}
            </Button>
            <Button
              variant="outline"
              className="ml-2"
              onClick={async () => {
                if (!confirm('Recompute member savings and SHG cash/bank balances from the underlying transaction history? This is safe to run — it only writes if the cache is out of sync.')) return
                try {
                  const r = await invoke<any>('rebuild_balances')
                  const cashDelta = (r.shgCashAfter - r.shgCashBefore).toFixed(2)
                  const bankDelta = (r.shgBankAfter - r.shgBankBefore).toFixed(2)
                  toast.success(`Rebuilt ${r.memberRowsUpdated} member + ${r.loanRowsUpdated} loan balance(s). Cash Δ ${cashDelta}, Bank Δ ${bankDelta}`)
                } catch (err: any) {
                  toast.error('Rebuild failed: ' + err?.toString())
                }
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />Rebuild Balances
            </Button>

            {integrityReport && (
              <div className={`mt-2 rounded-lg border p-3 space-y-2 ${
                integrityReport.overallOk ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'
              }`}>
                <p className={`text-sm font-semibold ${integrityReport.overallOk ? 'text-green-800' : 'text-red-800'}`}>
                  {integrityReport.overallOk
                    ? '✓ All integrity checks passed'
                    : `✗ ${integrityReport.errorCount} error(s), ${integrityReport.warnCount} warning(s)`}
                </p>
                <div className="space-y-1.5 text-xs">
                  {integrityReport.checks.map((c: any, i: number) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={`flex-shrink-0 w-4 ${
                        c.severity === 'error' ? 'text-red-600'
                        : c.severity === 'warn' ? 'text-orange-600'
                        : c.severity === 'info' ? 'text-blue-600'
                        : 'text-green-600'
                      }`}>
                        {c.severity === 'error' ? '✗' : c.severity === 'warn' ? '⚠' : c.severity === 'info' ? 'ℹ' : '✓'}
                      </span>
                      <div className="flex-1">
                        <span className={c.passed ? '' : 'font-medium'}>{c.name}</span>
                        {c.details && (
                          <p className="text-muted-foreground mt-0.5">{c.details}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Crash reporting */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Automatic Crash Reporting</p>
                <p className="text-xs text-muted-foreground max-w-xl">
                  When the app crashes or hits an unexpected error, send the technical details to the developer
                  so it can be fixed. <strong>No personal data is sent</strong> — names, phone numbers, and
                  balances are not included. Only error messages, stack traces, app version, and your installation ID.
                </p>
              </div>
              <Switch
                checked={crashStatus?.enabled ?? false}
                disabled={!crashStatus?.configured}
                onCheckedChange={async checked => {
                  try {
                    await invoke('set_crash_reporting_enabled', { enabled: checked })
                    setCrashStatus(prev => prev ? { ...prev, enabled: checked } : prev)
                    toast.success(checked ? 'Crash reporting enabled' : 'Crash reporting disabled')
                  } catch (err: any) {
                    toast.error('Failed: ' + err?.toString())
                  }
                }}
              />
            </div>
            {!crashStatus?.configured && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                Crash reporting is not configured in this build (no Sentry DSN was set).
                Toggling on has no effect until the next signed release.
              </p>
            )}
            {crashStatus?.configured && crashStatus.enabled && (
              <Button
                variant="outline"
                size="sm"
                disabled={isTestingCrash}
                onClick={async () => {
                  setIsTestingCrash(true)
                  try {
                    const result = await invoke<string>('send_test_crash_event')
                    toast.success(result)
                  } catch (err: any) {
                    toast.error('Test failed: ' + err?.toString())
                  } finally {
                    setIsTestingCrash(false)
                  }
                }}
              >
                {isTestingCrash
                  ? <><Spinner className="mr-2 h-4 w-4" />Sending…</>
                  : <>Send Test Event</>}
              </Button>
            )}
          </div>

          <Separator />

          {/* Diagnostic report */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Diagnostic Report</p>
            <p className="text-xs text-muted-foreground">
              Generates a summary of the app state (version, member count, balances).
              Share this with support for quick diagnosis — contains no personal data.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={isDiagnosing}
                onClick={async () => {
                  setIsDiagnosing(true)
                  try {
                    const report = await invoke<any>('get_diagnostic_report')
                    const text = [
                      `SHG Manager Diagnostic Report`,
                      `Generated: ${report.generatedAt}`,
                      ``,
                      `Installation ID:   ${report.installationId}`,
                      `Installed Since:   ${report.installationCreatedAt}`,
                      `App Version:       ${report.appVersion}`,
                      `Schema Version:    v${report.schemaVersion}`,
                      `OS:                ${report.os} (${report.arch})`,
                      `DB Connected:      ${report.dbConnected ? 'Yes' : 'No (DB not unlocked)'}`,
                      ``,
                      `Active Members:    ${report.memberCount}`,
                      `Active Loans:      ${report.activeLoanCount}`,
                      `Loans Outstanding: Rs. ${report.totalLoanOutstanding?.toFixed(2)}`,
                      `Active Chit Groups: ${report.chitGroupCount}`,
                      ``,
                      `SHG Cash Balance:  Rs. ${report.shgCashBalance?.toFixed(2)}`,
                      `SHG Bank Balance:  Rs. ${report.shgBankBalance?.toFixed(2)}`,
                      ``,
                      `Log Directory: ${report.logDir}`,
                    ].join('\n')
                    setDiagnosticText(text)
                  } catch (err: any) {
                    toast.error('Failed to generate report: ' + err?.toString())
                  } finally {
                    setIsDiagnosing(false)
                  }
                }}
              >
                {isDiagnosing
                  ? <><Spinner className="mr-2 h-4 w-4" />Generating…</>
                  : <><FileText className="mr-2 h-4 w-4" />Generate Report</>}
              </Button>
              {diagnosticText && (
                <Button
                  variant="outline"
                  onClick={async () => {
                    const savePath = await saveDialog({
                      defaultPath: `shg-diagnostic-${new Date().toISOString().split('T')[0]}.txt`,
                      filters: [{ name: 'Text Files', extensions: ['txt'] }],
                    })
                    if (savePath) {
                      await writeFile(savePath, new TextEncoder().encode(diagnosticText))
                      toast.success('Report saved')
                    }
                  }}
                >
                  <Download className="mr-2 h-4 w-4" />Save Report
                </Button>
              )}
            </div>
            {diagnosticText && (
              <pre className="mt-2 rounded-lg bg-muted p-3 text-xs font-mono whitespace-pre-wrap">
                {diagnosticText}
              </pre>
            )}
          </div>
        </CardContent>
      </Card>

      {/* License Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            License
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!licenseStatus ? (
            <p className="text-sm text-muted-foreground">Loading license info…</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <p className="font-medium capitalize">{String(licenseStatus.status).replace(/_/g, ' ')}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">License Key</p>
                  <p className="font-mono text-xs">{licenseStatus.licenseKey ?? '—'}</p>
                </div>
                {licenseStatus.customerName && (
                  <div>
                    <p className="text-muted-foreground">Issued To</p>
                    <p className="font-medium">{licenseStatus.customerName}</p>
                  </div>
                )}
                {licenseStatus.expiresAt && (
                  <div>
                    <p className="text-muted-foreground">Expires</p>
                    <p className="font-medium">
                      {new Date(licenseStatus.expiresAt).toLocaleDateString()}
                      {typeof licenseStatus.daysUntilExpiry === 'number' &&
                        ` (${licenseStatus.daysUntilExpiry} days)`}
                    </p>
                  </div>
                )}
                {licenseStatus.lastValidatedAt && (
                  <div>
                    <p className="text-muted-foreground">Last Verified</p>
                    <p className="font-medium">
                      {new Date(licenseStatus.lastValidatedAt).toLocaleString()}
                      {licenseStatus.offlineValidation && ' (offline cache)'}
                    </p>
                  </div>
                )}
              </div>
              {licenseStatus.message && (
                <p className="text-xs text-muted-foreground">{licenseStatus.message}</p>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={isRefreshingLicense}
                onClick={refreshLicense}
              >
                {isRefreshingLicense
                  ? <><Spinner className="mr-2 h-4 w-4" />Verifying…</>
                  : <><RefreshCw className="mr-2 h-4 w-4" />Re-verify Now</>}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* About Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            About SHG Manager
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <p className="text-muted-foreground">Version</p>
              <p className="font-medium">v1.0.0</p>
            </div>
            <div>
              <p className="text-muted-foreground">Built with</p>
              <p className="font-medium">Tauri + React</p>
            </div>
            <div>
              <p className="text-muted-foreground">Database</p>
              <p className="font-medium">SQLCipher (Encrypted)</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Restore Backup Dialog */}
      <Dialog open={restoreDialogOpen} onOpenChange={setRestoreDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Restore Backup</DialogTitle>
            <DialogDescription>
              Select a backup to restore. This will replace all current data with the backup data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4 max-h-[300px] overflow-y-auto">
            {backups.length === 0 ? (
              <p className="text-center text-muted-foreground">No backups available</p>
            ) : (
              backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent cursor-pointer"
                  onClick={() => handleRestoreBackup(backup.fileName)}
                >
                  <div>
                    <p className="font-medium">{backup.fileName}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(backup.createdAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(backup.fileSize / 1024).toFixed(2)} KB • {backup.type}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isRestoreLoading}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleRestoreBackup(backup.fileName)
                    }}
                  >
                    {isRestoreLoading ? <Spinner className="h-4 w-4" /> : 'Restore'}
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreDialogOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock Past Data Dialog */}
      <Dialog open={lockDialogOpen} onOpenChange={setLockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4" /> Lock Past Data Entry
            </DialogTitle>
            <DialogDescription>
              Once locked, no new member opening balances, past loans, or past chit cycles can be recorded.
              You can unlock later using your admin PIN.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLockDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleLockPastData} disabled={isTogglingLock}>
              {isTogglingLock ? <><Spinner className="mr-2 h-4 w-4" />Locking…</> : <><Lock className="mr-2 h-4 w-4" />Confirm Lock</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlock Past Data Dialog */}
      <Dialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockOpen className="h-4 w-4" /> Unlock Past Data Entry
            </DialogTitle>
            <DialogDescription>
              Enter your admin PIN to re-enable past data entry. If no admin PIN has been set up, your main PIN will work.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-2">
              <Label htmlFor="unlockAdminPin">Admin PIN (or main PIN)</Label>
              <Input
                id="unlockAdminPin"
                type="password"
                placeholder="Enter admin PIN or main PIN"
                value={unlockAdminPin}
                onChange={e => setUnlockAdminPin(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleUnlockPastData() }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setUnlockDialogOpen(false); setUnlockAdminPin('') }}>Cancel</Button>
            <Button onClick={handleUnlockPastData} disabled={isTogglingLock}>
              {isTogglingLock ? <><Spinner className="mr-2 h-4 w-4" />Verifying…</> : <><LockOpen className="mr-2 h-4 w-4" />Unlock</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Admin PIN Dialog */}
      <Dialog open={changeAdminPinDialogOpen} onOpenChange={setChangeAdminPinDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Admin PIN</DialogTitle>
            <DialogDescription>
              The admin PIN is used to recover access when you forget your main PIN. Enter your current admin PIN and choose a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="currentAdminPin">Current Admin PIN</Label>
              <Input
                id="currentAdminPin"
                type="password"
                placeholder="Enter current admin PIN"
                value={currentAdminPin}
                onChange={(e) => setCurrentAdminPin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newAdminPin">New Admin PIN</Label>
              <Input
                id="newAdminPin"
                type="password"
                placeholder="At least 4 characters"
                value={newAdminPin}
                onChange={(e) => setNewAdminPin(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmAdminPin">Confirm New Admin PIN</Label>
              <Input
                id="confirmAdminPin"
                type="password"
                placeholder="Repeat new admin PIN"
                value={confirmAdminPin}
                onChange={(e) => setConfirmAdminPin(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleChangeAdminPin() }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setChangeAdminPinDialogOpen(false)
                setCurrentAdminPin('')
                setNewAdminPin('')
                setConfirmAdminPin('')
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleChangeAdminPin} disabled={isChangingAdminPin}>
              {isChangingAdminPin ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Updating...
                </>
              ) : (
                'Update Admin PIN'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clear Data Password Dialog */}
      <Dialog open={clearDataDialogOpen} onOpenChange={(open) => {
        setClearDataDialogOpen(open)
        if (!open) { setClearDataPassword(''); setClearDataConfirmed(false) }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={clearMode === 'keep' ? 'text-amber-700' : 'text-destructive'}>
              {clearMode === 'keep' ? 'Clear Data (Keep Members)' : 'Clear All Data'}
            </DialogTitle>
            <DialogDescription>
              {clearMode === 'keep'
                ? 'This permanently deletes all loans, chits, receipts, vouchers and balances, but KEEPS your members and their entered savings opening balances. This cannot be undone. Enter the admin PIN you set when the app was first set up to confirm.'
                : 'This permanently deletes all members, transactions, loans, and chit data. Settings are preserved. This cannot be undone. Enter the admin PIN you set when the app was first set up to confirm.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="clearDataPassword">Admin PIN</Label>
              <Input
                id="clearDataPassword"
                type="password"
                placeholder="Enter your admin PIN"
                value={clearDataPassword}
                onChange={(e) => setClearDataPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleVerifyAndClearData()
                  }
                }}
              />
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={clearDataConfirmed}
                onChange={(e) => setClearDataConfirmed(e.target.checked)}
              />
              <span>{clearMode === 'keep'
                ? 'I understand this permanently deletes all transactions (members and opening balances are kept) and cannot be undone.'
                : 'I understand this permanently deletes all data and cannot be undone.'}</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelClearData}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVerifyAndClearData}
              disabled={isVerifyingPassword || !clearDataPassword.trim() || !clearDataConfirmed}
            >
              {isVerifyingPassword ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Verifying...
                </>
              ) : (
                'Clear Data'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
