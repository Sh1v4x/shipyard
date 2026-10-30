import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium transition-[color,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-white dark:bg-destructive/60',
        outline: 'text-foreground',
        amber: 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400',
        green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
        red: 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-400',
        gray: 'border-border bg-muted text-muted-foreground',
        blue: 'border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-400',
        purple: 'border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-400',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export function Badge({ className, variant, asChild = false, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
