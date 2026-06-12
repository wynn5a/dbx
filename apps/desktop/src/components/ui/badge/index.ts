import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Badge } from "./Badge.vue";

export const badgeVariants = cva(
  "h-5 gap-1 rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium transition-all has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:size-3! group/badge inline-flex w-fit shrink-0 items-center justify-center overflow-hidden whitespace-nowrap focus-visible:border-[var(--ds-accent-line)] focus-visible:ring-[3px] focus-visible:ring-[var(--ds-accent-line)] aria-invalid:border-[var(--ds-red)] [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] [a]:hover:bg-[color-mix(in_srgb,var(--ds-accent)_22%,transparent)]",
        secondary: "bg-[var(--ds-bg-active)] text-[var(--ds-text-2)] [a]:hover:bg-[var(--ds-bg-hover)]",
        destructive:
          "bg-[color-mix(in_srgb,var(--ds-red)_14%,transparent)] [a]:hover:bg-[color-mix(in_srgb,var(--ds-red)_22%,transparent)] text-[var(--ds-red)]",
        outline:
          "border-[var(--ds-border)] text-[var(--ds-text-2)] [a]:hover:bg-[var(--ds-bg-hover)] [a]:hover:text-[var(--ds-text-1)]",
        ghost: "hover:bg-[var(--ds-bg-hover)] hover:text-[var(--ds-text-1)]",
        link: "text-[var(--ds-accent)] underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);
export type BadgeVariants = VariantProps<typeof badgeVariants>;
