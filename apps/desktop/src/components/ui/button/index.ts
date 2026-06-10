import type { VariantProps } from "class-variance-authority";
import { cva } from "class-variance-authority";

export { default as Button } from "./Button.vue";

// Variants follow docs/design-system/DESIGN-SYSTEM.md button recipes:
// default = primary (accent gradient), outline = chip, ghost = icon button,
// destructive = 14%-tint red fill, all on --ds-* tokens (6px radius, 12.5px/500,
// 120ms color-only motion, accent-line focus ring).
export const buttonVariants = cva(
  "focus-visible:ring-2 focus-visible:ring-[var(--ds-accent-line)] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 rounded-sm border border-transparent bg-clip-padding text-[12.5px] font-medium aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*=size-])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[background-color,border-color,color] duration-[var(--ds-speed)] ease-[var(--ds-ease)] outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "btn-ds-primary",
        outline:
          "border-[var(--ds-border)] bg-transparent text-[var(--ds-text-2)] hover:bg-[var(--ds-bg-hover)] hover:border-[var(--ds-border-strong)] hover:text-[var(--ds-text-1)] aria-expanded:bg-[var(--ds-bg-active)] aria-expanded:text-[var(--ds-text-1)]",
        secondary:
          "bg-[var(--ds-bg-elevated)] border-[var(--ds-border)] text-[var(--ds-text-1)] hover:bg-[var(--ds-bg-active)] hover:border-[var(--ds-border-strong)] aria-expanded:bg-[var(--ds-bg-active)]",
        ghost:
          "hover:bg-[var(--ds-bg-active)] hover:text-[var(--ds-text-1)] aria-expanded:bg-[var(--ds-bg-active)] aria-expanded:text-[var(--ds-text-1)]",
        destructive:
          "bg-[color-mix(in_srgb,var(--ds-red)_14%,transparent)] text-[var(--ds-red)] border-[color-mix(in_srgb,var(--ds-red)_25%,transparent)] hover:bg-[color-mix(in_srgb,var(--ds-red)_22%,transparent)] focus-visible:ring-[color-mix(in_srgb,var(--ds-red)_35%,transparent)]",
        link: "text-[var(--ds-accent)] underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*=size-])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-[12.5px] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*=size-])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 in-data-[slot=button-group]:rounded-lg [&_svg:not([class*=size-])]:size-3",
        "icon-sm": "size-7 in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);
export type ButtonVariants = VariantProps<typeof buttonVariants>;
