<?php
function calculateTax(float $amount, float $rate): float {
  if ($rate < 0 || $rate > 1) {
    throw new \InvalidArgumentException("Rate must be between 0 and 1");
  }
  return $amount * $rate;
}
function formatCurrency(float $amount, string $symbol = '$'): string {
  return $symbol . number_format($amount, 2);
}
