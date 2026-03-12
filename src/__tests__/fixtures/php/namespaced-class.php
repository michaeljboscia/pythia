<?php
namespace App\Models;
class Product {
  public function __construct(private string $sku, private float $price) {}
  public function getPrice(): float { return $this->price; }
}
