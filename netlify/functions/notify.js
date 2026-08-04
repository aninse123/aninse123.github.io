// Douro Partners — Investor Notification Function
// Sends batch emails via Resend API when admin notifies investors.
// Auth: x-notify-secret header must match NOTIFY_SECRET env var.
// Requires env vars: RESEND_API_KEY, NOTIFY_SECRET

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_SECRET  = process.env.NOTIFY_SECRET;
const PORTAL_URL     = 'https://douropartners.pt/portal/investor.html';
// Always the production domain (like PORTAL_URL above), regardless of which
// branch's function actually sends the email — the asset only needs to exist
// on main/production to resolve for recipients.
const LOGO_URL        = 'https://douropartners.pt/assets/logo-transparent.png';
// Generous enough to never throttle a real "Send Update" blast to all
// portal investors — just a backstop against the endpoint being abused as
// an open mass-mailer if the secret ever leaked, not a real-world cap.
const MAX_RECIPIENTS = 250;

// Server-side allow-list — the client sends a key (never a raw address), so
// a tampered payload can never make this function send from an arbitrary
// "from" address, only one of these three verified domain identities.
const SENDERS = {
  andre:   { email: 'andre.rocha@douropartners.pt',      name: 'André Rocha' },
  antonio: { email: 'antonio.carvalho@douropartners.pt',  name: 'António Carvalho' },
  noreply: { email: 'noreply@douropartners.pt',           name: 'Douro Partners' },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  // Only accept POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // Validate secret
  const secret = event.headers['x-notify-secret'];
  if (!NOTIFY_SECRET || !secret || secret !== NOTIFY_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { recipients, subject, message, docName, docCategory, docDescription, docUrl, from, kind, combined } = body;

  if (!recipients?.length || !subject?.trim() || !message?.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields: recipients, subject, message' }) };
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return { statusCode: 400, body: JSON.stringify({ error: `Too many recipients (max ${MAX_RECIPIENTS})` }) };
  }
  const badEmail = recipients.find(r => !r?.email || !EMAIL_RE.test(r.email));
  if (badEmail) {
    return { statusCode: 400, body: JSON.stringify({ error: `Invalid recipient email: ${badEmail?.email || '(missing)'}` }) };
  }

  const sender = SENDERS[from] || SENDERS.noreply;
  const isOutreach = kind === 'outreach';
  const outreachDocFields = { docName, docCategory, docDescription, docUrl };
  const html = isOutreach
    ? buildOutreachHtml({ message: message.trim(), ...outreachDocFields })
    : null; // per-recipient investor template built below, needs each r.name

  // Whichever of André/António did NOT send it gets CC'd on outreach sends
  // (single or combined) so both partners stay looped in on the thread —
  // applies to outreach only, not official investor Notify/Blast sends,
  // which stay CC-free even when a named sender is picked for those.
  const other = isOutreach
    ? (from === 'andre' ? SENDERS.antonio : from === 'antonio' ? SENDERS.andre : null)
    : null;

  // combined: true sends ONE email with every recipient in "to" (so they see
  // each other — for a firm's whole team at one investor/company). Otherwise
  // (default) send one separate email per recipient, as today.
  let emails;
  if (combined) {
    emails = [{
      from: `${sender.name} <${sender.email}>`,
      to:   recipients.map(r => r.email),
      ...(other ? { cc: [`${other.name} <${other.email}>`] } : {}),
      subject: subject.trim(),
      html: html || buildOutreachHtml({ message: message.trim(), ...outreachDocFields }),
    }];
  } else {
    emails = recipients.map(r => ({
      from: `${sender.name} <${sender.email}>`,
      to:   [r.email],
      ...(other ? { cc: [`${other.name} <${other.email}>`] } : {}),
      subject: subject.trim(),
      html: html || buildHtml({
        investorName:   r.name,
        message:        message.trim(),
        docName:        docName        || '',
        docCategory:    docCategory    || 'Document',
        docDescription: docDescription || '',
      }),
    }));
  }

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

  // Document card is optional — omit when no docName provided
  const docCard = docName ? `
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
            </table>` : '';

  const messageHtml = esc(message).replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(docName || 'Update')} — Douro Partners</title>
</head>
<body style="margin:0;padding:0;background:#F7F3EC;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#F7F3EC;padding:40px 0;">
    <tr><td align="center" style="padding:0 16px;">

      <table width="560" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:560px;width:100%;">

        <!-- ── Logo strip (outside the branded card — the logo's navy/gold
             coloring needs a light background, so it sits here rather than
             inside the dark header banner below) ── -->
        <tr>
          <td style="padding:0 4px 14px;text-align:left;">
            <img src="${LOGO_URL}" alt="Douro Partners" width="110" style="display:block;border:0;">
          </td>
        </tr>

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

            ${docCard}

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
              or
              <a href="mailto:antonio.carvalho@douropartners.pt"
                 style="color:#9CA3AF;">antonio.carvalho@douropartners.pt</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>

</body>
</html>`;
}

// Lighter template for free-form outreach (Search CRM company contacts,
// Investor CRM contacts) — same visual shell as buildHtml above, but no
// investor-portal framing: no auto-greeting, no "View in Investor Portal"
// CTA, no "registered investor" footer line. The sender's real name (shown
// in the From header) does the signing-off; the body is genuinely free text.
// docName/docCategory/docDescription/docUrl are all optional — when
// docName is set, an attached-document card renders below the message
// (used by the Investor CRM's "attach a document" picker). This function
// (not buildHtml) is what actually renders for combined/"Email All" sends,
// since buildHtml needs one investorName per recipient and combined sends
// have no single recipient to address.
function buildOutreachHtml({ message, docName, docCategory, docUrl, docDescription }) {
  const messageHtml = esc(message).replace(/\n/g, '<br>');

  const docDescRow = docDescription
    ? `<p style="margin:8px 0 0;font-size:13px;color:#6B7280;line-height:1.6;">${esc(docDescription)}</p>`
    : '';
  const docLinkRow = docUrl
    ? `<p style="margin:12px 0 0;"><a href="${esc(docUrl)}" style="color:#4A6B8A;font-size:13px;font-weight:600;text-decoration:none;">View Document &rarr;</a></p>`
    : '';
  const docCard = docName ? `
            <!-- Document card -->
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
                   style="background:#F7F3EC;border-radius:8px;margin-top:24px;">
              <tr>
                <td style="padding:20px 24px;">
                  <p style="margin:0 0 4px;font-size:10px;font-weight:700;
                            text-transform:uppercase;letter-spacing:0.1em;color:#6B7280;">
                    ${esc(docCategory || 'Document')}
                  </p>
                  <p style="margin:0;font-size:17px;font-weight:600;color:#2C2C2C;">
                    ${esc(docName)}
                  </p>
                  ${docDescRow}
                  ${docLinkRow}
                </td>
              </tr>
            </table>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Douro Partners</title>
</head>
<body style="margin:0;padding:0;background:#F7F3EC;font-family:'Helvetica Neue',Arial,sans-serif;-webkit-text-size-adjust:100%;">

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#F7F3EC;padding:40px 0;">
    <tr><td align="center" style="padding:0 16px;">

      <table width="560" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:560px;width:100%;">

        <!-- ── Logo strip (outside the branded card — see buildHtml's comment) ── -->
        <tr>
          <td style="padding:0 4px 14px;text-align:left;">
            <img src="${LOGO_URL}" alt="Douro Partners" width="110" style="display:block;border:0;">
          </td>
        </tr>

        <!-- ── Header ── -->
        <tr>
          <td style="background:#1E2A38;padding:28px 40px;border-radius:8px 8px 0 0;text-align:center;">
            <p style="margin:0;font-family:Georgia,'Times New Roman',serif;
                      font-size:22px;color:#FFFFFF;font-weight:bold;letter-spacing:0.02em;">
              Douro Partners
            </p>
          </td>
        </tr>

        <!-- ── Body ── -->
        <tr>
          <td style="background:#FFFFFF;padding:36px 40px;">
            <p style="margin:0;font-size:15px;color:#2C2C2C;line-height:1.75;">
              ${messageHtml}
            </p>
            ${docCard}
          </td>
        </tr>

        <!-- ── Footer — always signed with both partners' names, since the
             firm is a two-person team even when only one of them sent it ── -->
        <tr>
          <td style="background:#F7F3EC;padding:20px 40px;border-radius:0 0 8px 8px;text-align:center;
                     border-top:1px solid #D8D3C8;">
            <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.8;">
              André Rocha &amp; António Carvalho &middot;<br>
              <a href="https://douropartners.pt" style="color:#9CA3AF;text-decoration:none;">
                douropartners.pt
              </a>
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
