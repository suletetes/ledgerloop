"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../utils/cn";

/**
 * Accessible label built on the Radix headless primitive (Req 19.4).
 *
 * Demonstrates the component foundation: Radix provides correct labelling and
 * association semantics; the app layer adds shared design-token styling. App
 * forms (registration, sign-in, add-expense) compose primitives like this so
 * every control is programmatically labelled (Req 17.4).
 */
const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-sm font-medium text-neutral-700",
      "peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
      className,
    )}
    {...props}
  />
));
Label.displayName = "Label";

export { Label };
