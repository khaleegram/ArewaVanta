<?php

namespace App\Notifications;

use App\Models\User;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

final class PasswordResetNotification extends Notification
{
    public function __construct(public readonly string $token) {}

    /** @return array<int, string> */
    public function via(User $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(User $notifiable): MailMessage
    {
        $resetUrl = rtrim((string) config('app.frontend_url'), '/')
            .'/reset-password?'.http_build_query([
                'token' => $this->token,
                'email' => $notifiable->getEmailForPasswordReset(),
            ]);

        return (new MailMessage)
            ->subject('Reset your ArewaVanta password')
            ->view([
                'html' => 'emails.password-reset',
                'text' => 'emails.password-reset-text',
            ], [
                'resetUrl' => $resetUrl,
                'expiryMinutes' => config('auth.passwords.users.expire'),
            ]);
    }
}
