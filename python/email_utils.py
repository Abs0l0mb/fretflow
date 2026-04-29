import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

SMTP_HOST     = os.environ.get("SMTP_HOST", "")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_FROM     = os.environ.get("SMTP_FROM", "") or SMTP_USER


def send_verification_email(to_email: str, verification_link: str):
    if not SMTP_HOST or not SMTP_USER:
        raise RuntimeError("SMTP not configured — set SMTP_HOST, SMTP_USER, SMTP_PASSWORD in .env")

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "Verify your FretFlow account"
    msg["From"]    = SMTP_FROM
    msg["To"]      = to_email

    text = (
        f"Welcome to FretFlow!\n\n"
        f"Click the link below to verify your email address:\n{verification_link}\n\n"
        f"This link expires in 24 hours. If you didn't create an account, ignore this email."
    )
    html = f"""<!DOCTYPE html>
<html><body style="font-family:sans-serif;max-width:480px;margin:40px auto;color:#1a1a1a">
  <h2 style="margin-bottom:8px">Welcome to FretFlow!</h2>
  <p style="color:#555">Click the button below to verify your email address.</p>
  <a href="{verification_link}"
     style="display:inline-block;margin:20px 0;padding:12px 24px;background:#4f46e5;
            color:#fff;border-radius:6px;text-decoration:none;font-weight:600">
    Verify my email
  </a>
  <p style="font-size:12px;color:#999">
    Link expires in 24 hours.<br>
    If you didn't create an account, you can ignore this email.
  </p>
</body></html>"""

    msg.attach(MIMEText(text, "plain"))
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM, to_email, msg.as_string())
