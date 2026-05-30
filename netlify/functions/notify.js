// Douro Partners — Investor Notification Function
// Sends batch emails via Resend API when admin notifies investors.
// Auth: x-notify-secret header must match NOTIFY_SECRET env var.
// Requires env vars: RESEND_API_KEY, NOTIFY_SECRET

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_SECRET  = process.env.NOTIFY_SECRET;
const FROM_EMAIL     = 'noreply@douropartners.pt';
const FROM_NAME      = 'Douro Partners';
const PORTAL_URL     = 'https://douropartners.pt/portal/investor.html';

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Validate secret
  const secret = event.headers['x-notify-secret'];
  if (!NOTIFY_SECRET || !secret || secret !== NOTIFY_SECRET) {
    return { statusCode: 401, body: JSON.stringify({
      error: 'Unauthorized',
      debug: {
        envSet:    !!NOTIFY_SECRET,
        envLen:    NOTIFY_SECRET ? NOTIFY_SECRET.length : 0,
        headerSet: !!secret,
        headerLen: secret ? secret.length : 0,
        match:     secret === NOTIFY_SECRET
      }
    })};
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { recipients, subject, message, docName, docCategory, docDescription } = body;

  if (!recipients?.length || !subject?.trim() || !message?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: recipients, subject, message' }) };
  }

  // Build one email per recipient
  const emails = recipients.map(r => ({
    from: `${FROM_NAME} <${FROM_EMAIL}>`,
    to:   [r.email],
    subject: subject.trim(),
    html: buildHtml({
      investorName:   r.name,
      message:        message.trim(),
      docName:        docName        || '',
      docCategory:    docCategory    || 'Document',
      docDescription: docDescription || '',
    }),
  }));

  // Send via Resend batch API
  try {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(emails),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend error:', errText);
      return { statusCode: 502, body: JSON.stringify({ error: `Resend API error: ${errText}` }) };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sent: emails.length }),
    };
  } catch (err) {
    console.error('notify function error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

// ── Email HTML template ────────────────────────────────────────────────────────
function buildHtml({ investorName, message, docName, docCategory, docDescription }) {
  const greeting = investorName
    ? `<p style="margin:0 0 20px;font-size:15px;color:#2C2C2C;">Dear <strong>${esc(investorName)}</strong> team,</p>`
    : '';

  const descriptionRow = docDescription
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6B7280;line-height:1.6;">${esc(docDescription)}</p>`
    : '';

  const messageHtml = esc(message).replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(docName)} — Douro Partners</title>
</head>
<body style="margin:0;padding:0;background:#F7F3EC;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#F7F3EC;padding:40px 0;">
    <tr><td align="center" style="padding:0 16px;">

      <table width="560" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:560px;width:100%;">

        <!-- ── Header ── -->
        <tr>
          <td style="background:#1E2A38;padding:28px 40px;border-radius:8px 8px 0 0;text-align:center;">
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;
                      font-size:22px;color:#FFFFFF;font-weight:bold;letter-spacing:0.02em;">
              Douro Partners
            </p>
            <p style="margin:6px 0 0;font-size:11px;color:rgba(255,255,255,0.5);
                      letter-spacing:0.1em;text-transform:uppercase;">
              Investor Portal
            </p>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:#FFFFFF;padding:36px 40px;">

            ${greeting}

            <!-- Admin message -->
            <p style="margin:0 0 28px;font-size:15px;color:#2C2C2C;line-height:1.75;">
              ${messageHtml}
            </p>

            <!-- Document card -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                   style="background:#F7F3EC;border-radius:8px;margin-bottom:28px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 4px;font-size:10px;font-weight:700;
                            text-transform:uppercase;letter-spacing:0.1em;color:#6B7280;">
                    ${esc(docCategory)}
                  </p>
                  <p style="margin:0;font-size:17px;font-weight:600;color:#2C2C2C;">
                    ${esc(docName)}
                  </p>
                  ${descriptionRow}
                </td>
              </tr>
            </table>

            <!-- CTA button -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="center">
                  <a href="${PORTAL_URL}"
                     style="display:inline-block;background:#4A6B8A;color:#FFFFFF;
                            text-decoration:none;font-size:14px;font-weight:600;
                            padding:14px 32px;border-radius:8px;letter-spacing:0.02em;">
                    View in Investor Portal &rarr;
                  </a>
                </td>
              </tr>
            </table>

          </td>
        </tr>

        <!-- ── Footer ── -->
        <tr>
          <td style="background:#F7F3EC;padding:20px 40px;border-radius:0 0 8px 8px;text-align:center;
                     border-top:1px solid #D8D3C8;">
            <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.8;">
              <a href="https://douropartners.pt" style="color:#9CA3AF;text-decoration:none;">
                douropartners.pt
              </a>
              &nbsp;&middot;&nbsp;
              You are receiving this as a registered investor.<br>
              To update your contact details, reach us at
              <a href="mailto:andre.rocha@douropartners.pt"
                 style="color:#9CA3AF;">andre.rocha@douropartners.pt</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
