<?php
trait Timestampable {
  private \DateTime $createdAt;
  public function getCreatedAt(): \DateTime { return $this->createdAt; }
  public function setCreatedAt(\DateTime $dt): void { $this->createdAt = $dt; }
}
