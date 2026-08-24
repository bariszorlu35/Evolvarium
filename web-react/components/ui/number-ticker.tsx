"use client";

import NumberFlow, { type Value } from "@number-flow/react";
import { cn } from "@/lib/utils";

type NumberTickerProps = {
  value: Value;
  label?: string;
  decimals?: number;
  className?: string;
  /** CSS colour for the live pulse. Defaults to the herbivore cyan. */
  pulseColor?: string;
  /** Hide the pulse for figures that are not live-updating. */
  pulse?: boolean;
};

/**
 * NumberTicker 05 - Stats Counter
 * High-fidelity statistics tracker.
 */
function NumberTicker({
  value,
  label,
  decimals = 0,
  className,
  pulseColor = "var(--herb)",
  pulse = true,
}: NumberTickerProps) {
  return (
    <div className={cn("inline-flex items-center gap-3", className)}>
      {pulse && (
        <span className="relative flex h-2 w-2 shrink-0">
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
            style={{ backgroundColor: pulseColor }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{ backgroundColor: pulseColor }}
          />
        </span>
      )}
      <NumberFlow
        value={value}
        format={{
          notation: "standard",
          compactDisplay: "short",
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        }}
        className={className}
      />
      {label && (
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-dim">
          {label}
        </span>
      )}
    </div>
  );
}

export default NumberTicker;

