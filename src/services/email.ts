import crypto from 'crypto';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || 'Safroi <noreply@safroi.com>';
const APP_URL = process.env.APP_URL || process.env.VITE_API_URL || 'https://safroi.onrender.com';

export function generateResetToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
  return { token, hash, expiresAt };
}

export function hashResetToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function buildResetEmail(userName: string, resetUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#050B10;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#0B1219;border-radius:20px;border:1px solid rgba(255,255,255,0.1);overflow:hidden;">
    <div style="padding:32px 24px;text-align:center;border-bottom:1px solid rgba(255,255,255,0.05);">
      <div style="font-size:28px;font-weight:900;font-style:italic;text-transform:uppercase;color:#fff;">
        Saf<span style="color:#E0FEF6">r</span><span style="color:#38BDF8">o</span><span style="color:#E0FEF6">i</span>
      </div>
    </div>
    <div style="padding:32px 24px;">
      <h2 style="color:#fff;font-size:20px;font-weight:900;text-align:center;margin:0 0 12px;">Reset Your Password</h2>
      <p style="color:rgba(255,255,255,0.5);font-size:14px;text-align:center;margin:0 0 24px;line-height:1.5;">
        Hi ${userName}, we received a request to reset your Safroi password. Click the button below to set a new one.
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${resetUrl}" style="display:inline-block;background:#E0FEF6;color:#050B10;font-weight:800;font-size:14px;padding:14px 32px;border-radius:12px;text-decoration:none;">
          Reset Password
        </a>
      </div>
      <p style="color:rgba(255,255,255,0.3);font-size:11px;text-align:center;margin:0 0 8px;">
        This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>
    </div>
    <div style="padding:16px 24px;border-top:1px solid rgba(255,255,255,0.05);text-align:center;">
      <p style="color:rgba(255,255,255,0.15);font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin:0;">
        AI-Powered Legal Intelligence
      </p>
    </div>
  </div>
</body>
</html>`;
}

export async function sendPasswordResetEmail(
  toEmail: string,
  userName: string,
  resetToken: string
): Promise<boolean> {
  const resetUrl = `${APP_URL}/reset-password?token=${resetToken}`;
  console.log(`[Email] Password reset for ${toEmail}: ${resetUrl}`);

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log('[Email] SMTP not configured. Reset link logged above. Set SMTP_HOST, SMTP_USER, SMTP_PASS to enable email.');
    return true; // Return true so the flow continues even without SMTP
  }

  try {
    const html = buildResetEmail(userName, resetUrl);

    // Try nodemailer if available, otherwise fall back to raw SMTP
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: SMTP_HOST,
        port: SMTP_PORT,
        secure: SMTP_PORT === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      });

      await transporter.sendMail({
        from: SMTP_FROM,
        to: toEmail,
        subject: 'Reset Your Safroi Password',
        html,
        text: `Hi ${userName},\n\nReset your Safroi password: ${resetUrl}\n\nThis link expires in 1 hour.\nIf you didn't request this, ignore this email.`,
      });

      console.log(`[Email] Reset email sent to ${toEmail}`);
      return true;
    } catch {
      // nodemailer not installed — try raw socket
      console.log('[Email] nodemailer not available, using raw SMTP...');
    }

    // Raw SMTP fallback (STARTTLS on port 587)
    const { default: net } = await import('net');
    const tls = await import('tls');

    const result = await new Promise<boolean>((resolve, reject) => {
      const socket = net.createConnection({ host: SMTP_HOST, port: SMTP_PORT });
      let step = 0;
      const lines: string[] = [];
      let buf = '';

      socket.on('data', (data) => {
        buf += data.toString();
        const parts = buf.split('\r\n');
        buf = parts.pop() || '';
        for (const line of parts) {
          lines.push(line);
          processLine(line);
        }
      });

      function send(cmd: string) { socket.write(cmd + '\r\n'); }

      function processLine(line: string) {
        try {
          if (step === 0 && line.startsWith('220')) {
            send('EHLO safroi.com');
            step = 1;
          } else if (step === 1 && line.startsWith('250')) {
            // Wait for last 250 response
            if (lines.length > 1 && !lines[lines.length - 2]?.startsWith('250')) return;
            send(`STARTTLS`);
            step = 2;
          } else if (step === 2 && line.startsWith('220')) {
            const secureSocket = tls.connect({ socket, rejectUnauthorized: false }, () => {
              send('EHLO safroi.com');
              step = 3;
            });
            secureSocket.on('data', (d) => {
              buf += d.toString();
              const p = buf.split('\r\n');
              buf = p.pop() || '';
              for (const l of p) processLine(l);
            });
            return;
          } else if (step === 3 && line.startsWith('250')) {
            if (lines.length > 1 && !lines[lines.length - 2]?.startsWith('250')) return;
            send(`AUTH LOGIN`);
            step = 4;
          } else if (step === 4 && line.startsWith('334')) {
            send(Buffer.from(SMTP_USER).toString('base64'));
            step = 5;
          } else if (step === 5 && line.startsWith('334')) {
            send(Buffer.from(SMTP_PASS).toString('base64'));
            step = 6;
          } else if (step === 6 && line.startsWith('235')) {
            send(`MAIL FROM:<${SMTP_FROM.match(/<(.+)>/)?.[1] || SMTP_USER}>`);
            step = 7;
          } else if (step === 7 && line.startsWith('250')) {
            send(`RCPT TO:<${toEmail}>`);
            step = 8;
          } else if (step === 8 && line.startsWith('250')) {
            send('DATA');
            step = 9;
          } else if (step === 9 && line.startsWith('354')) {
            const encodedHtml = html.replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..');
            send(`From: ${SMTP_FROM}\r\nTo: ${toEmail}\r\nSubject: Reset Your Safroi Password\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${encodedHtml}\r\n.`);
            step = 10;
          } else if (step === 10 && line.startsWith('250')) {
            send('QUIT');
            step = 11;
            socket.end();
            resolve(true);
          } else if (line.startsWith('5') || line.startsWith('4')) {
            reject(new Error(`SMTP error: ${line}`));
          }
        } catch (e) {
          reject(e);
        }
      }

      socket.on('error', reject);
      socket.setTimeout(15000, () => { socket.destroy(); reject(new Error('SMTP timeout')); });
    });

    return result;
  } catch (err) {
    console.error('[Email] Failed to send reset email:', err);
    return false;
  }
}
