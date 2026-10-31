@extends('emails.layout')

@section('title', 'Competition organizer invitation')
@section('preheader', 'You’ve been invited to help organize a competition on ArewaVanta.')
@section('content')
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr><td style="padding:34px 28px 30px;">
            <p style="margin:0 0 14px;color:#f29178;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">COMPETITION ORGANIZER INVITATION</p>
            <h1 style="margin:0;color:#f5f2e8;font-size:30px;line-height:1.15;letter-spacing:-1px;">Help run the<br>competition<span style="color:#f16a51;">.</span></h1>
            <p style="margin:20px 0 0;color:#d4ddce;font-size:15px;line-height:1.7;">You’ve been invited to organize <strong style="color:#ffffff;">{{ $competitionName }}</strong> on ArewaVanta.</p>
            <p style="margin:12px 0 24px;color:#b5c4ae;font-size:14px;line-height:1.7;">Accept the invitation to create your account or confirm your existing account. You’ll be able to manage this competition with the other organizers.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:#dc4934;"><a href="{{ $invitationUrl }}" style="display:inline-block;padding:15px 22px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;">Accept organizer invite &nbsp; →</a></td></tr></table>
            <p style="margin:24px 0 0;color:#aebca5;font-size:12px;line-height:1.6;">This invitation is valid for <strong style="color:#e2e9dc;">7 days</strong> and can be used once.</p>
        </td></tr>
        <tr><td style="padding:18px 28px;background-color:#111910;border-top:1px solid #35432e;">
            <p style="margin:0 0 8px;color:#bdcab5;font-size:12px;line-height:1.6;">Button not working? Copy this link into your browser:</p>
            <a href="{{ $invitationUrl }}" style="color:#f29178;font-size:11px;line-height:1.6;word-break:break-all;">{{ $invitationUrl }}</a>
        </td></tr>
    </table>
@endsection
