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
import {
  getAllSettings,
  saveAllSettings,
  createBackup,
  restoreBackup,
  exportAllData,
  importAllData,
  clearAllData,
  changeDatabasePassword,
  getBackupList,
  verifyMasterPassword,
} from '@/lib/api/settings'
import { useAppearance } from '@/lib/appearance-context'
import { useSettings } from '@/lib/settings-context'
import type { AppSettings, BackupInfo } from '@/lib/types'

export default function SettingsPage() {
  const [isSaving, setIsSaving] = useState(false)
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [isRestoreLoading, setIsRestoreLoading] = useState(false)
  const [clearDataDialogOpen, setClearDataDialogOpen] = useState(false)
  const [clearDataPassword, setClearDataPassword] = useState('')
  const [isVerifyingPassword, setIsVerifyingPassword] = useState(false)
  
  const { settings: globalSettings, updateSettings, refreshSettings } = useSettings()
  const appearance = useAppearance()

  // Local state for form - sync with global settings
  const [settings, setSettings] = useState<AppSettings>({
    general: {
      groupName: 'Shakti Self Help Group',
      registrationNumber: 'SHG-2024-001234',
      address: 'Village Center, Main Road',
      contactPhone: '9876543210',
      contactEmail: 'shakti.shg@example.com',
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
          groupName: globalSettings.general.groupName || 'Shakti Self Help Group',
          registrationNumber: globalSettings.general.registrationNumber || 'SHG-2024-001234',
          address: globalSettings.general.address || 'Village Center, Main Road',
          contactPhone: globalSettings.general.contactPhone || '9876543210',
          contactEmail: globalSettings.general.contactEmail || 'shakti.shg@example.com',
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

  const handleExport = async () => {
    if (!confirm(
      'The exported file will contain all your SHG data in plain text (JSON) format and is NOT encrypted.\n\n' +
      'Store it in a secure location. Do you want to continue?'
    )) return

    try {
      const response = await exportAllData()
      if (response.success && response.data) {
        const blob = new Blob([response.data], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `shg-export-${new Date().toISOString().split('T')[0]}.json`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success('Data exported successfully — keep the file secure')
      } else {
        toast.error(response.error || 'Failed to export data')
      }
    } catch (error) {
      console.error('Failed to export data:', error)
      toast.error('An error occurred while exporting data')
    }
  }

  const handleImport = async () => {
    // Create a file input element
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      
      if (confirm('Are you sure you want to import this data? This will replace all current data with the imported data. This action cannot be undone.')) {
        try {
          const reader = new FileReader()
          reader.onload = async (event) => {
            const jsonData = event.target?.result as string
            if (!jsonData) {
              toast.error('Failed to read file')
              return
            }
            
            const response = await importAllData(jsonData)
            if (response.success) {
              toast.success('Data imported successfully. Please refresh the page.')
            } else {
              toast.error(response.error || 'Failed to import data')
            }
          }
          reader.readAsText(file)
        } catch (error) {
          console.error('Failed to import data:', error)
          toast.error('An error occurred while importing data')
        }
      }
    }
    
    input.click()
  }

  const handleClearData = () => {
    setClearDataDialogOpen(true)
  }

  const handleVerifyAndClearData = async () => {
    if (!clearDataPassword.trim()) {
      toast.error('Please enter your master password')
      return
    }
    
    setIsVerifyingPassword(true)
    try {
      const verifyResponse = await verifyMasterPassword(clearDataPassword)
      if (verifyResponse.success && verifyResponse.data) {
        // Password correct, proceed with clear
        if (confirm('Are you sure you want to clear all data? This action cannot be undone and will delete all members, transactions, loans, and other data. Settings will be preserved.')) {
          const response = await clearAllData()
          if (response.success) {
            toast.success('All data cleared successfully')
            setClearDataDialogOpen(false)
            setClearDataPassword('')

            // Reset appearance to defaults immediately so the UI reflects the
            // cleared state before the page reloads.
            appearance.setTheme('light')
            appearance.setLanguage('english')

            // Refresh global settings context from the now-reset DB
            await refreshSettings()

            // Redirect to home page after a short delay
            setTimeout(() => {
              window.location.href = '/'
            }, 1500)
          } else {
            toast.error(response.error || 'Failed to clear data')
          }
        }
      } else {
        toast.error('Incorrect password')
      }
    } catch (error) {
      console.error('Failed to verify password:', error)
      toast.error('An error occurred while verifying password')
    } finally {
      setIsVerifyingPassword(false)
    }
  }

  const handleCancelClearData = () => {
    setClearDataDialogOpen(false)
    setClearDataPassword('')
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
          <Button variant="outline" onClick={handleDebugSettings}>
            Debug Settings
          </Button>
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
                  <Label>Change Database Password</Label>
                  <p className="text-sm text-muted-foreground">
                    Update the encryption password
                  </p>
                </div>
                <Button variant="outline" size="sm">
                  <Shield className="mr-2 h-4 w-4" />
                  Change Password
                </Button>
              </div>
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

              <div className="p-4 rounded-lg border border-destructive/20 bg-destructive/5">
                <h4 className="font-medium text-destructive mb-2">Danger Zone</h4>
                <p className="text-sm text-muted-foreground mb-3">
                  These actions are irreversible. Please be careful.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleExport}>
                    <Database className="mr-2 h-4 w-4" />
                    Export Data
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleImport}>
                    <Database className="mr-2 h-4 w-4" />
                    Import Data
                  </Button>
                  <Button variant="destructive" size="sm" onClick={handleClearData}>
                    Clear All Data
                  </Button>
                </div>
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
              <p className="font-medium">1.0.0</p>
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

      {/* Clear Data Password Dialog */}
      <Dialog open={clearDataDialogOpen} onOpenChange={setClearDataDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-destructive">Clear All Data</DialogTitle>
            <DialogDescription>
              This action is destructive and will delete all members, transactions, loans, and other data. 
              Please enter your master password to confirm.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="clearDataPassword">Master Password</Label>
              <Input
                id="clearDataPassword"
                type="password"
                placeholder="Enter your master password"
                value={clearDataPassword}
                onChange={(e) => setClearDataPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleVerifyAndClearData()
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelClearData}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleVerifyAndClearData}
              disabled={isVerifyingPassword}
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
