import { forwardRef } from "react";

type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", ...props }, ref) => (
    <input
      ref={ref}
      className={`h-11 w-full rounded-xl border border-border bg-background/60 px-4 text-sm text-foreground placeholder:text-muted/70 transition-colors focus:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${className}`}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export function Label({
  className = "",
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={`text-sm font-medium text-foreground/90 ${className}`}
      {...props}
    />
  );
}

export default Input;
