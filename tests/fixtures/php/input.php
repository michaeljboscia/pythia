<?php

namespace Vendor\Module;

class Greeter
{
    public function __construct(private string $name)
    {
    }

    public function render(): string
    {
        return "Hello " . $this->name;
    }
}

function helper(string $value): string
{
    return trim($value);
}
