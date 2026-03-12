<?php

trait LogsMessages
{
    public function logInfo(string $message): void
    {
        echo $message;
    }

    protected function decorate(string $message): string
    {
        return "[info] " . $message;
    }
}
