# Inbox — automatic filing from Google Drive

Your email automation saves attachments into a Google Drive folder. The CRM reads that
folder every 5 minutes, has Claude read each new file, and files it:

| What it is | Where it goes |
|---|---|
| Drawings, surveys/reports, RAMS, planning, minutes | Job › Documents (01 Drawings, 02 Surveys, 06 H&S, 09 Planning, 11 Meetings) |
| Our PAs, client payment notices, VOs, programmes | Job › 02 / 03 / 04 / 06 folders |
| Insurance, certificates, accreditations | Subcontractor › Compliance (with expiry date) |
| Subcontractor / supplier quotes | Job's quote request in Quotes (amount filled in) |
| Invoices | Left alone — Xero handles them |
| Signatures, logos, calendar files | Ignored |

Anything it isn't sure about (job, sender, type), or a job with a folder per building,
waits in **Inbox › To check** with its best guess, so filing it is one tap.
Files it puts into job Documents are **hidden from the client** until someone shows them.
Google Drive is only ever read, so your Quant keeps seeing the same folder.

## One-time setup (≈15 min)

1. **Google service account**: in Google Cloud Console, open a project and enable the
   **Google Drive API**. Go to IAM › Service accounts › Create, then Keys › Add key › JSON
   and download the file. Copy the account's email (`…@….iam.gserviceaccount.com`).
2. **Share the Drive folder** with that email as **Viewer**. If you're on Google Workspace
   and it won't share outside cltd.co.uk, allow it in Admin › Drive sharing, or use a
   shared drive.
3. **Supabase › Edge Functions › Secrets** (CRM project tjelbvoeciklpfvapxvn):
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: paste the whole JSON file.
   - `INTAKE_CRON_KEY`: any long random string.
4. **Deploy the function**: `supabase functions deploy intake --no-verify-jwt`
   (it checks who's calling itself).
5. **Supabase › Project Settings › Vault**: add a secret named `intake_cron_key` with the
   same value as `INTAKE_CRON_KEY`.
6. **SQL Editor**: run `supabase-sql/040_intake.sql`.
7. **CRM › Inbox › Settings**:
   - Paste the Drive folder link and set "Only files saved on or after" (default today).
   - Tick "Check the folder every 5 minutes".
   - Leave **Trial** on. In trial everything lands in To check with where it *would* go.
   - When the guesses look right (a few days), untick Trial so sure files are filed
     automatically.

## Cost
About 3–6p of Claude per file (Sonnet, job list cached across a run). Signatures and
duplicates are skipped without calling Claude.
