<?php

namespace App\Enums;

enum Role: string
{
    case ClanCaptain = 'clan_captain';
    case Organizer = 'organizer';
    case PlatformAdmin = 'platform_admin';
}
