@extends('emails.layout')

@section('title', 'Reset your ArewaVanta password')
@section('preheader', 'Use this secure link to choose a new ArewaVanta password.')
@section('content')
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
        <tr><td style="padding:34px 28px 30px;">
            <p style="margin:0 0 14px;color:#f29178;font-size:11px;font-weight:800;letter-spacing:1.4px;text-transform:uppercase;">ACCOUNT SECURITY</p>
            <h1 style="margin:0;color:#f5f2e8;font-size:32px;line-height:1.15;letter-spacing:-1px;">Reset your<br>password<span style="color:#f16a51;">.</span></h1>
            <p style="margin:20px 0 0;color:#d4ddce;font-size:15px;line-height:1.7;">We received a request to reset the password for your ArewaVanta account.</p>
            <p style="margin:12px 0 24px;color:#b5c4ae;font-size:14px;line-height:1.7;">Choose a new password using the secure link below. It expires in <strong style="color:#e2e9dc;">{{ $expiryMinutes }} minutes</strong> and can be used once.</p>
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:#dc4934;"><a href="{{ $resetUrl }}" style="display:inline-block;padding:15px 22px;color:#ffffff;text-decoration:none;font-size:13px;font-weight:bold;">Choose a new password &nbsp; →</a></td></tr></table>
            <p style="margin:24px 0 0;color:#aebca5;font-size:12px;line-height:1.6;">If you didn’t request this, you can safely ignore this email. Your password will not change.</p>
        </td></tr>
        <tr><td style="padding:18px 28px;background-color:#111910;border-top:1px solid #35432e;">
            <p style="margin:0 0 8px;color:#bdcab5;font-size:12px;line-height:1.6;">Button not working? Copy this link into your browser:</p>
            <a href="{{ $resetUrl }}" style="color:#f29178;font-size:11px;line-height:1.6;word-break:break-all;">{{ $resetUrl }}</a>
        </td></tr>
    </table>
@endsection
