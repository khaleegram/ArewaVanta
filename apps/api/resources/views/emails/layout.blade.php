<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <meta name="supported-color-schemes" content="dark">
    <title>@yield('title', 'ArewaVanta')</title>
</head>
<body style="margin:0;padding:0;background-color:#0b100c;color:#f4f1e9;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;">
    <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">@yield('preheader')</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background-color:#0b100c;">
        <tr><td align="center" style="padding:28px 16px 36px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width:560px;">
                <tr><td style="padding:6px 0 24px;">
                    <span style="display:inline-block;font-size:22px;font-weight:900;letter-spacing:-1px;color:#f3f1e9;">arewa<span style="color:#f16a51;">vanta.</span></span>
                    <span style="display:block;margin-top:8px;color:#9eac97;font-size:10px;font-weight:bold;letter-spacing:1.4px;text-transform:uppercase;">AREWA CODM &nbsp; / &nbsp; BATTLE ROYALE</span>
                </td></tr>
                <tr><td style="background-color:#182117;border:1px solid #35432e;border-top:3px solid #e4553e;">
                    @yield('content')
                </td></tr>
                <tr><td style="padding:23px 2px 0;color:#9eac97;font-size:11px;line-height:1.6;">
                    <strong style="color:#c8d2bf;">ArewaVanta</strong><br>
                    Built for the Arewa CODM community.
                </td></tr>
            </table>
        </td></tr>
    </table>
</body>
</html>
