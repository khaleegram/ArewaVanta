<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

final class CompetitionOrganizerInvitation extends Mailable
{
    use Queueable, SerializesModels;

    public function __construct(public string $competitionName, public string $invitationUrl) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: 'You’re invited to organize on ArewaVanta');
    }

    public function content(): Content
    {
        return new Content(view: 'emails.competition-organizer-invitation', text: 'emails.competition-organizer-invitation-text');
    }
}
