import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5 [&>svg]:text-current',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-400 [&>svg]:text-current *:data-[slot=alert-description]:text-red-700/90 dark:*:data-[slot=alert-description]:text-red-400/90',
        warning: 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-300 *:data-[slot=alert-description]:text-amber-800/90 dark:*:data-[slot=alert-description]:text-amber-300/90',
        success: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300 *:data-[slot=alert-description]:text-emerald-800/90 dark:*:data-[slot=alert-description]:text-emerald-300/90',
        info: 'border-blue-500/30 bg-blue-500/5 text-blue-800 dark:text-blue-300 *:data-[slot=alert-description]:text-blue-800/90 dark:*:data-[slot=alert-description]:text-blue-300/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Alert({ className, variant, ...props }: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}

export function AlertTitle({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('col-start-2 line-clamp-1 min-h-4 font-medium tracking-tight', className)} {...props} />
}

export function AlertDescription({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('col-start-2 grid justify-items-start gap-1 text-sm text-muted-foreground [&_p]:leading-relaxed', className)} {...props} />
}
