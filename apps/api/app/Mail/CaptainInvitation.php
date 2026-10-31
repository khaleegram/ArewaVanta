<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

final class CaptainInvitation extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public string $clanName, public string $invitationUrl) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'You’re invited to lead on ArewaVanta');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.captain-invitation', text: 'emails.captain-invitation-text');
    }
}
