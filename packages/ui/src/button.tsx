import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "./cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md border text-sm font-semibold transition disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "border-accent bg-accent text-white hover:bg-[#1e40af]",
        secondary: "border-line bg-white text-ink hover:bg-canvas",
        ghost: "border-transparent bg-transparent text-ink hover:bg-canvas",
        danger: "border-[#b42318] bg-white text-[#b42318] hover:bg-[#fef3f2]",
      },
      size: {
        sm: "min-h-11 h-11 px-3",
        md: "min-h-11 h-11 px-3.5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
