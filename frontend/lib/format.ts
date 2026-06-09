export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount)
}

// Round a chit installment to the nearest multiple of 5, rounding UP when the
// amount past the lower multiple of 5 is 3 or more and DOWN when it is less
// than 3 (e.g. 173.8 -> 175, 172.2 -> 170). Mirrors the backend round_to_5 so
// collected contributions are clean cash amounts.
export function roundToFive(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0
  return Math.floor((amount + 2) / 5) * 5
}

// Human-friendly loan reference derived from the loan's row id (LN-0007).
export function loanRef(id: string | number): string {
  const n = typeof id === 'number' ? id : parseInt(id, 10)
  if (!Number.isFinite(n)) return `LN-${id}`
  return `LN-${String(n).padStart(4, '0')}`
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatPhone(phone: string): string {
  // Format as Indian phone number: +91 XXXXX XXXXX
  if (phone.length === 10) {
    return `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
  }
  return phone
}

export function generateReferenceNumber(type: 'receipt' | 'voucher'): string {
  const now = new Date()
  const year = now.getFullYear().toString().slice(-2) // Last 2 digits
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  
  const prefix = type === 'receipt' ? 'RCPT' : 'VOU'
  return `${prefix}${year}${month}${day}${random}`
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return 'Just now'
  }
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours} hour${hours > 1 ? 's' : ''} ago`
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days} day${days > 1 ? 's' : ''} ago`
  }

  return formatDate(dateString)
}
