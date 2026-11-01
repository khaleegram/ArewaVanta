@extends('emails.layout')

@section('title', 'ArewaVanta organizer invitation')
@section('preheader', 'You’ve been invited to join the ArewaVanta organizer team.')
@section('content')
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr><td style="padding:34px 28px 30px;">
            <p style="margin:0 0 14px;color:#f29178;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">AREWAVANTA ORGANIZER INVITATION</p>
            <h1 style="margin:0;color:#f5f2e8;font-size:30px;line-height:1.15;letter-spacing:-1px;">Help run<br>ArewaVanta<span style="color:#f16a51;">.</span></h1>
            <p style="margin:20px 0 0;color:#d4ddce;font-size:15px;line-height:1.7;">You’ve been invited to join the ArewaVanta organizer team. This invite was sent from <strong style="color:#ffffff;">{{ $competitionName }}</strong>.</p>
            <p style="margin:12px 0 24px;color:#b5c4ae;font-size:14px;line-height:1.7;">After accepting, you’ll be able to manage all competitions, weekly scrims, clans, squads and results. Platform administration remains separate.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:#dc4934;"><a href="{{ $invitationUrl }}" style="display:inline-block;padding:15px 22px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;">Accept organizer invite &nbsp; →</a></td></tr></table>
            <p style="margin:24px 0 0;color:#aebca5;font-size:12px;line-height:1.6;">This link stays active until accepted and can be used once.</p>
        </td></tr>
        <tr><td style="padding:18px 28px;background-color:#111910;border-top:1px solid #35432e;">
            <p style="margin:0 0 8px;color:#bdcab5;font-size:12px;line-height:1.6;">Button not working? Copy this link into your browser:</p>
            <a href="{{ $invitationUrl }}" style="color:#f29178;font-size:11px;line-height:1.6;word-break:break-all;">{{ $invitationUrl }}</a>
        </td></tr>
    </table>
@endsection
