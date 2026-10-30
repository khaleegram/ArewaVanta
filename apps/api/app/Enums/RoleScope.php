<?php

namespace App\Enums;

enum RoleScope: string
{
    case Global = 'global';
    case Clan = 'clan';
    case Event = 'event';
}
