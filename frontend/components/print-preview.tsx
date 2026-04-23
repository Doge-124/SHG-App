'use client'

import React, { useState, useRef, useEffect } from 'react'
import { X, Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import type { Receipt, Voucher } from '@/lib/types'

interface PrintPreviewProps {
  isOpen: boolean
  onClose: () => void
  type: 'receipt' | 'voucher' | 'receipts' | 'vouchers'
  data: Receipt | Voucher | Receipt[] | Voucher[]
  shgName?: string
}

export function PrintPreview({ isOpen, onClose, type, data, shgName }: PrintPreviewProps) {
  const [pdfUrl, setPdfUrl] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const generatePreview = async () => {
    setIsLoading(true)
    try {
      let pdfBlob: Blob
      const {
        generateReceiptPDFBlobAsync,
        generateVoucherPDFBlobAsync,
        generateMultipleReceiptsPDFBlobAsync,
        generateMultipleVouchersPDFBlobAsync,
      } = await import('@/lib/pdf')

      if (type === 'receipt') {
        pdfBlob = await generateReceiptPDFBlobAsync(data as Receipt, shgName)
      } else if (type === 'voucher') {
        pdfBlob = await generateVoucherPDFBlobAsync(data as Voucher, shgName)
      } else if (type === 'receipts') {
        pdfBlob = await generateMultipleReceiptsPDFBlobAsync(data as Receipt[], shgName)
      } else {
        pdfBlob = await generateMultipleVouchersPDFBlobAsync(data as Voucher[], shgName)
      }

      // Create URL for the blob
      const url = URL.createObjectURL(pdfBlob)
      setPdfUrl(url)

      // Clean up previous URL if exists
      return () => {
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl)
        }
      }
    } catch (error) {
      console.error('Error generating preview:', error)
      toast.error('Failed to generate preview')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDownload = () => {
    if (!pdfUrl) return

    const link = document.createElement('a')
    link.href = pdfUrl
    
    let filename = ''
    if (type === 'receipt') {
      const receipt = data as Receipt
      filename = `receipt_${receipt.referenceNumber || 'unknown'}.pdf`
    } else if (type === 'voucher') {
      const voucher = data as Voucher
      filename = `voucher_${voucher.referenceNumber || 'unknown'}.pdf`
    } else if (type === 'receipts') {
      filename = `receipts_batch_${new Date().toISOString().split('T')[0]}.pdf`
    } else {
      filename = `vouchers_batch_${new Date().toISOString().split('T')[0]}.pdf`
    }
    
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    
    toast.success('PDF downloaded successfully')
  }

  const handlePrint = () => {
    if (!iframeRef.current) return

    const iframe = iframeRef.current
    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document
    
    if (iframeDoc) {
      iframe.contentWindow?.print()
    }
  }

  // Generate preview when dialog opens
  useEffect(() => {
    if (isOpen && data) {
      generatePreview()
    }

    // Cleanup on unmount
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl)
      }
    }
  }, [isOpen, data])

  const getTitle = () => {
    switch (type) {
      case 'receipt':
        return 'Receipt Preview'
      case 'voucher':
        return 'Voucher Preview'
      case 'receipts':
        return 'All Receipts Preview'
      case 'vouchers':
        return 'All Vouchers Preview'
      default:
        return 'Document Preview'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle>{getTitle()}</DialogTitle>
        </DialogHeader>
        
        <div className="flex flex-col h-[calc(90vh-8rem)]">
          {/* Action buttons */}
          <div className="flex gap-2 mb-4">
            <Button
              variant="outline"
              onClick={handlePrint}
              disabled={!pdfUrl || isLoading}
            >
              <Printer className="mr-2 h-4 w-4" />
              Print
            </Button>
            <Button
              onClick={handleDownload}
              disabled={!pdfUrl || isLoading}
            >
              <Download className="mr-2 h-4 w-4" />
              Download
            </Button>
          </div>

          {/* PDF Preview */}
          <ScrollArea className="flex-1 border rounded-md">
            {isLoading ? (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
                  <p className="text-muted-foreground">Generating preview...</p>
                </div>
              </div>
            ) : pdfUrl ? (
              <iframe
                ref={iframeRef}
                src={pdfUrl}
                className="w-full h-full min-h-[400px]"
                title="PDF Preview"
              />
            ) : (
              <div className="flex items-center justify-center h-full min-h-[400px]">
                <p className="text-muted-foreground">No preview available</p>
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Legacy blob helpers kept for reference — actual generation now uses pdf.ts exports.
async function generateReceiptPDFBlob(receipt: Receipt): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  
  // Use the same PDF generation logic but return blob instead of downloading
  const PAGE_WIDTH = 210
  const PAGE_HEIGHT = 297
  const MARGIN = 20

  const formatCurrencyForPDF = (amount: number): string => {
    return `Rs. ${amount.toLocaleString('en-IN')}`
  }

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Generate PDF content (same as original function)
  doc.setFontSize(20)
  doc.text('RECEIPT', PAGE_WIDTH / 2, 30, { align: 'center' })
  
  doc.setFontSize(12)
  doc.text('Self Help Group Management System', PAGE_WIDTH / 2, 40, { align: 'center' })
  
  doc.line(MARGIN, 50, PAGE_WIDTH - MARGIN, 50)
  
  let yPosition = 65
  doc.setFontSize(11)
  doc.text(`Reference No: ${receipt.referenceNumber || 'N/A'}`, MARGIN, yPosition)
  yPosition += 10
  doc.text(`Date: ${formatDateTime(receipt.createdAt || '')}`, MARGIN, yPosition)
  yPosition += 10
  doc.text(`Type: ${receipt.referenceType ? receipt.referenceType.replace('_', ' ').toUpperCase() : 'GENERAL'}`, MARGIN, yPosition)
  
  yPosition += 15
  doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
  
  yPosition += 10
  doc.setFont(undefined as any, 'bold')
  doc.text('Received From:', MARGIN, yPosition)
  yPosition += 10
  doc.setFont(undefined as any, 'normal')
  doc.text(receipt.memberName || 'General', MARGIN, yPosition)
  
  yPosition += 15
  doc.setFontSize(12)
  doc.setFont(undefined as any, 'bold')
  doc.text('Amount Details:', MARGIN, yPosition)
  yPosition += 8
  doc.setFont(undefined as any, 'normal')
  doc.text(`Amount: ${formatCurrencyForPDF(receipt.amount || 0)}`, MARGIN, yPosition)
  yPosition += 8
  doc.text(`Payment Method: ${receipt.paymentMethod?.toUpperCase() || 'CASH'}`, MARGIN, yPosition)
  
  yPosition += 15
  doc.setFontSize(12)
  doc.setFont(undefined as any, 'bold')
  doc.text('Reason:', MARGIN, yPosition)
  yPosition += 8
  doc.setFont(undefined as any, 'normal')
  const reasonLines = doc.splitTextToSize(receipt.reason || 'N/A', PAGE_WIDTH - 2 * MARGIN)
  reasonLines.forEach((line: string) => {
    doc.text(line, MARGIN, yPosition)
    yPosition += 6
  })
  
  yPosition = PAGE_HEIGHT - 40
  doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
  yPosition += 10
  doc.setFontSize(10)
  doc.text('This is a computer-generated receipt', PAGE_WIDTH / 2, yPosition, { align: 'center' })
  yPosition += 6
  doc.text('No signature required', PAGE_WIDTH / 2, yPosition, { align: 'center' })

  return doc.output('blob')
}

// Similar helper functions for other document types...
async function generateVoucherPDFBlob(voucher: Voucher): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  
  // Voucher-specific PDF generation (same as original but returns blob)
  const PAGE_WIDTH = 210
  const PAGE_HEIGHT = 297
  const MARGIN = 20

  const formatCurrencyForPDF = (amount: number): string => {
    return `Rs. ${amount.toLocaleString('en-IN')}`
  }

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Generate voucher PDF content
  doc.setFontSize(20)
  doc.text('VOUCHER', PAGE_WIDTH / 2, 30, { align: 'center' })
  
  doc.setFontSize(12)
  doc.text('Self Help Group Management System', PAGE_WIDTH / 2, 40, { align: 'center' })
  
  doc.line(MARGIN, 50, PAGE_WIDTH - MARGIN, 50)
  
  let yPosition = 65
  doc.setFontSize(11)
  doc.text(`Reference No: ${voucher.referenceNumber || 'N/A'}`, MARGIN, yPosition)
  yPosition += 10
  doc.text(`Date: ${formatDateTime(voucher.createdAt || '')}`, MARGIN, yPosition)
  
  yPosition += 15
  doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
  
  yPosition += 10
  doc.setFontSize(12)
  doc.setFont(undefined as any, 'bold')
  doc.text('Paid To:', MARGIN, yPosition)
  yPosition += 8
  doc.setFont(undefined as any, 'normal')
  doc.text(voucher.memberName || voucher.reference || 'General', MARGIN, yPosition)
  
  yPosition += 15
  doc.setFontSize(12)
  doc.setFont(undefined as any, 'bold')
  doc.text('Amount Details:', MARGIN, yPosition)
  yPosition += 8
  doc.setFont(undefined as any, 'normal')
  doc.text(`Amount: ${formatCurrencyForPDF(voucher.amount || 0)}`, MARGIN, yPosition)
  yPosition += 8
  doc.text(`Payment Method: ${voucher.paymentMethod?.toUpperCase() || 'CASH'}`, MARGIN, yPosition)
  
  yPosition += 15
  doc.setFontSize(12)
  doc.setFont(undefined as any, 'bold')
  doc.text('Reason:', MARGIN, yPosition)
  yPosition += 8
  doc.setFont(undefined as any, 'normal')
  const reasonLines = doc.splitTextToSize(voucher.reason || 'N/A', PAGE_WIDTH - 2 * MARGIN)
  reasonLines.forEach((line: string) => {
    doc.text(line, MARGIN, yPosition)
    yPosition += 6
  })
  
  yPosition = PAGE_HEIGHT - 40
  doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
  yPosition += 10
  doc.setFontSize(10)
  doc.text('This is a computer-generated voucher', PAGE_WIDTH / 2, yPosition, { align: 'center' })
  yPosition += 6
  doc.text('No signature required', PAGE_WIDTH / 2, yPosition, { align: 'center' })

  return doc.output('blob')
}

async function generateMultipleReceiptsPDFBlob(receipts: Receipt[]): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  
  const PAGE_WIDTH = 210
  const PAGE_HEIGHT = 297
  const MARGIN = 20

  const formatCurrencyForPDF = (amount: number): string => {
    return `Rs. ${amount.toLocaleString('en-IN')}`
  }

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Add each receipt on a separate page
  receipts.forEach((receipt, index) => {
    if (index > 0) {
      doc.addPage()
    }
    
    // Generate receipt PDF content (same as single receipt)
    doc.setFontSize(20)
    doc.text('RECEIPT', PAGE_WIDTH / 2, 30, { align: 'center' })
    
    doc.setFontSize(12)
    doc.text('Self Help Group Management System', PAGE_WIDTH / 2, 40, { align: 'center' })
    
    doc.line(MARGIN, 50, PAGE_WIDTH - MARGIN, 50)
    
    let yPosition = 65
    doc.setFontSize(11)
    doc.text(`Reference No: ${receipt.referenceNumber || 'N/A'}`, MARGIN, yPosition)
    yPosition += 10
    doc.text(`Date: ${formatDateTime(receipt.createdAt || '')}`, MARGIN, yPosition)
    yPosition += 10
    doc.text(`Type: ${receipt.referenceType ? receipt.referenceType.replace('_', ' ').toUpperCase() : 'GENERAL'}`, MARGIN, yPosition)
    
    yPosition += 15
    doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
    
    yPosition += 10
    doc.setFontSize(12)
    doc.setFont(undefined as any, 'bold')
    doc.text('Received From:', MARGIN, yPosition)
    yPosition += 8
    doc.setFont(undefined as any, 'normal')
    doc.text(receipt.memberName || 'General', MARGIN, yPosition)
    
    yPosition += 15
    doc.setFontSize(12)
    doc.setFont(undefined as any, 'bold')
    doc.text('Amount Details:', MARGIN, yPosition)
    yPosition += 8
    doc.setFont(undefined as any, 'normal')
    doc.text(`Amount: ${formatCurrencyForPDF(receipt.amount || 0)}`, MARGIN, yPosition)
    yPosition += 8
    doc.text(`Payment Method: ${receipt.paymentMethod?.toUpperCase() || 'CASH'}`, MARGIN, yPosition)
    
    yPosition += 15
    doc.setFontSize(12)
    doc.setFont(undefined as any, 'bold')
    doc.text('Reason:', MARGIN, yPosition)
    yPosition += 8
    doc.setFont(undefined as any, 'normal')
    const reasonLines = doc.splitTextToSize(receipt.reason || 'N/A', PAGE_WIDTH - 2 * MARGIN)
    reasonLines.forEach((line: string) => {
      doc.text(line, MARGIN, yPosition)
      yPosition += 6
    })
    
    yPosition = PAGE_HEIGHT - 40
    doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
    yPosition += 10
    doc.setFontSize(10)
    doc.text('This is a computer-generated receipt', PAGE_WIDTH / 2, yPosition, { align: 'center' })
    yPosition += 6
    doc.text('No signature required', PAGE_WIDTH / 2, yPosition, { align: 'center' })
  })

  return doc.output('blob')
}

async function generateMultipleVouchersPDFBlob(vouchers: Voucher[]): Promise<Blob> {
  const { default: jsPDF } = await import('jspdf')
  const doc = new jsPDF()
  
  const PAGE_WIDTH = 210
  const PAGE_HEIGHT = 297
  const MARGIN = 20

  const formatCurrencyForPDF = (amount: number): string => {
    return `Rs. ${amount.toLocaleString('en-IN')}`
  }

  const formatDateTime = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  // Add each voucher on a separate page
  vouchers.forEach((voucher, index) => {
    if (index > 0) {
      doc.addPage()
    }
    
    // Generate voucher PDF content (same as single voucher)
    doc.setFontSize(20)
    doc.text('VOUCHER', PAGE_WIDTH / 2, 30, { align: 'center' })
    
    doc.setFontSize(12)
    doc.text('Self Help Group Management System', PAGE_WIDTH / 2, 40, { align: 'center' })
    
    doc.line(MARGIN, 50, PAGE_WIDTH - MARGIN, 50)
    
    let yPosition = 65
    doc.setFontSize(11)
    doc.text(`Reference No: ${voucher.referenceNumber || 'N/A'}`, MARGIN, yPosition)
    yPosition += 10
    doc.text(`Date: ${formatDateTime(voucher.createdAt || '')}`, MARGIN, yPosition)
    
    yPosition += 15
    doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
    
    yPosition += 10
    doc.setFontSize(12)
    doc.setFont(undefined as any, 'bold')
    doc.text('Paid To:', MARGIN, yPosition)
    yPosition += 8
    doc.setFont(undefined as any, 'normal')
    doc.text(voucher.memberName || voucher.reference || 'General', MARGIN, yPosition)
    
    yPosition += 15
    doc.setFontSize(12)
    doc.setFont(undefined as any, 'bold')
    doc.text('Amount Details:', MARGIN, yPosition)
    yPosition += 8
    doc.setFont(undefined as any, 'normal')
    doc.text(`Amount: ${formatCurrencyForPDF(voucher.amount || 0)}`, MARGIN, yPosition)
    yPosition += 8
    doc.text(`Payment Method: ${voucher.paymentMethod?.toUpperCase() || 'CASH'}`, MARGIN, yPosition)
    
    yPosition += 15
    doc.setFontSize(12)
    doc.setFont(undefined as any, 'bold')
    doc.text('Reason:', MARGIN, yPosition)
    yPosition += 8
    doc.setFont(undefined as any, 'normal')
    const reasonLines = doc.splitTextToSize(voucher.reason || 'N/A', PAGE_WIDTH - 2 * MARGIN)
    reasonLines.forEach((line: string) => {
      doc.text(line, MARGIN, yPosition)
      yPosition += 6
    })
    
    yPosition = PAGE_HEIGHT - 40
    doc.line(MARGIN, yPosition, PAGE_WIDTH - MARGIN, yPosition)
    yPosition += 10
    doc.setFontSize(10)
    doc.text('This is a computer-generated voucher', PAGE_WIDTH / 2, yPosition, { align: 'center' })
    yPosition += 6
    doc.text('No signature required', PAGE_WIDTH / 2, yPosition, { align: 'center' })
  })

  return doc.output('blob')
}
