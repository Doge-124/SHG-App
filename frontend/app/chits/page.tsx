'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, Eye, Users, Calendar, CircleDollarSign } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { PageHeader } from '@/components/page-header'
import { StatCard } from '@/components/stat-card'
import { ChitGroupForm } from '@/components/forms/chit-group-form'
import { useApp } from '@/context/app-context'
import { createChitGroup } from '@/lib/api/chits'
import { formatCurrency, formatDate } from '@/lib/format'
import type { ChitGroupFormData } from '@/lib/types'
import { cn } from '@/lib/utils'

export default function ChitsPage() {
  const { chitGroups, loadingChitGroups, refreshChitGroups } = useApp()
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    refreshChitGroups()
  }, [refreshChitGroups])

  const activeGroups = chitGroups.filter((g) => g.status === 'active')
  const completedGroups = chitGroups.filter((g) => g.status === 'completed')
  const totalValue = chitGroups.reduce((sum, g) => sum + g.totalAmount, 0)

  const handleCreateGroup = async (data: ChitGroupFormData) => {
    setIsSubmitting(true)
    try {
      const response = await createChitGroup(data)
      if (response.success) {
        toast.success('Chit group created successfully')
        setIsFormOpen(false)
        refreshChitGroups()
      } else {
        toast.error(response.error || 'Failed to create chit group')
      }
    } catch {
      toast.error('An error occurred')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chit Funds"
        description="Manage chit fund groups and cycles"
      >
        <Button onClick={() => setIsFormOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create Chit Group
        </Button>
      </PageHeader>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="Active Groups"
          value={activeGroups.length}
          icon={CircleDollarSign}
          description="Running chit funds"
          variant="info"
        />
        <StatCard
          title="Total Value"
          value={formatCurrency(totalValue)}
          icon={CircleDollarSign}
          description="Across all groups"
        />
        <StatCard
          title="Completed"
          value={completedGroups.length}
          icon={CircleDollarSign}
          description="Finished groups"
          variant="success"
        />
      </div>

      {/* Chit Groups Grid */}
      {loadingChitGroups ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-5 w-32 bg-muted rounded" />
                <div className="h-4 w-24 bg-muted rounded mt-2" />
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="h-4 w-full bg-muted rounded" />
                  <div className="h-4 w-3/4 bg-muted rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : chitGroups.length === 0 ? (
        <Card className="py-12">
          <CardContent className="text-center">
            <CircleDollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Chit Groups Yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first chit group to start managing chit funds.
            </p>
            <Button onClick={() => setIsFormOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Create Chit Group
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {chitGroups.map((group) => {
            const progress = (group.currentCycle / group.durationMonths) * 100
            return (
              <Card key={group.id} className="hover:shadow-md transition-shadow">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-lg">{group.name}</CardTitle>
                      <CardDescription>
                        Started {formatDate(group.startDate)}
                      </CardDescription>
                    </div>
                    <Badge
                      variant={group.status === 'active' ? 'default' : 'secondary'}
                      className={cn(
                        group.status === 'active' && 'bg-success/10 text-success',
                        group.status === 'completed' && 'bg-primary/10 text-primary'
                      )}
                    >
                      {group.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Total Amount</p>
                      <p className="font-semibold">{formatCurrency(group.totalAmount)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Monthly</p>
                      <p className="font-semibold">{formatCurrency(group.monthlyContribution)}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-4 w-4" />
                      <span>{group.currentMembers} of {group.totalMembers} members</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Calendar className="h-4 w-4" />
                      <span>Cycle {group.currentCycle} of {group.durationMonths}</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Progress</span>
                      <span className="font-medium">{Math.round(progress)}%</span>
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  <Button asChild variant="outline" className="w-full">
                    <Link href={`/chits/detail?id=${group.id}`}>
                      <Eye className="mr-2 h-4 w-4" />
                      View Details
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <ChitGroupForm
        open={isFormOpen}
        onOpenChange={setIsFormOpen}
        onSubmit={handleCreateGroup}
        isLoading={isSubmitting}
      />
    </div>
  )
}
