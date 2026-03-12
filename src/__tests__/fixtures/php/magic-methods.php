<?php
class MagicContainer {
  private array $data = [];
  public function __construct(array $initial = []) { $this->data = $initial; }
  public function __destruct() { $this->data = []; }
  public function __toString(): string { return json_encode($this->data); }
}
