<?php
interface Repository {
  public function find(int $id): ?object;
  public function findAll(): array;
  public function save(object $entity): void;
}
