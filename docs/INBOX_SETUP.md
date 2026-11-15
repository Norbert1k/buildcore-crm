# Inbox setup — automatic filing from Google Drive

Takes about 15 minutes. You need three files:

- `040_intake.sql`: the database tables and the 5-minute schedule
- `intake/index.ts`: the filing robot (a Supabase edge function)
- this guide

Nothing is filed until step 7, and Trial mode (on by default) only suggests where files
would go.

---

## 1. Google: create a read-only "robot" account (≈5 min)

1. Go to **console.cloud.google.com** and sign in with the Google account that owns the
   Drive folder.
2. Top bar › project picker › **New project** › name it `CCG CRM Inbox` › Create, then
   select it.
3. Search **"Google Drive API"** › **Enable**.
4. Left menu › **IAM & Admin › Service accounts** › **Create service account**
   - Name: `crm-inbox` › Create and continue › Done (no roles needed).
5. Click the new account › **Keys** tab › **Add key › Create new key › JSON** › Create.
   A `.json` file downloads. Keep it private; it's the robot's password.
6. Copy the account's email. It looks like `crm-inbox@ccg-crm-inbox.iam.gserviceaccount.com`.

## 2. Google Drive: share the folder with the robot

1. Open the folder your email automation saves attachments into.
2. **Share** › paste the robot's email › role **Viewer** › untick "Notify" › Share.
3. Copy the folder's link from the address bar. You'll paste it into the CRM in step 7.

> If Google Workspace blocks sharing outside cltd.co.uk, go to **admin.google.com › Apps ›
> Google Workspace › Drive and Docs › Sharing settings** and allow sharing outside the
> organisation for this folder's owner. Another option is to put the folder in a shared
> drive and add the robot as a Viewer there.

## 3. Supabase: add the secrets

**supabase.com › CRM project (tjelbvoeciklpfvapxvn) › Edge Functions › Secrets**, then add
these two:

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Open the downloaded `.json` file in Notepad/TextEdit and paste **all** of it |

(`ANTHROPIC_API_KEY` is already there from the other CRM functions.)

## 4. Supabase: deploy the robot

**Option A, in the dashboard (no installs):**
1. **Edge Functions › Deploy a new function › Via editor**
2. Name it exactly `intake`.
3. Delete the sample code and paste the whole of `intake/index.ts` › **Deploy**.
4. Open the function › **Details / Settings** › turn **"Enforce JWT verification" OFF** › Save.
   It checks who's calling it itself.

**Option B, from a terminal in the CRM repo:**
```
supabase functions deploy intake --no-verify-jwt --project-ref tjelbvoeciklpfvapxvn
```

## 5. (no longer needed: the schedule's pass is made by the database)

## 6. Supabase: create the tables and the 5-minute schedule

**SQL Editor › New query**: paste the whole of `040_intake.sql` › **Run**.
It's safe to run again. It doesn't change or delete anything that already exists.

(If it complains about `pg_cron` or `pg_net`, go to **Database › Extensions**, switch both
on, and run it again.)

## 7. CRM: switch it on

**crm.cltd.co.uk › Inbox › Settings**:
1. Paste the Drive folder link from step 2.
2. "Only files saved on or after" defaults to today. Earlier files are left alone.
3. Tick **"Check the folder every 5 minutes"**.
4. Leave **Trial** ticked › **Save**.
5. Press **Check now** at the top. Within a minute the new files appear under **To check**,
   each showing where it would go.

For the first few days, file each one by pressing **File**, or fix the guess first. When
the guesses look right, untick **Trial**. From then on, files Claude is sure about (85%+)
are filed automatically, and only the unsure ones wait in To check.

---

## What goes where

| File | Goes to |
|---|---|
| Drawings | Job › Documents › 01. Drawings |
| Surveys, reports, calcs | Job › Documents › 02. Surveys & Reports |
| RAMS / method statements | Job › Documents › 06. Health & Safety (and the subcontractor's Compliance if known) |
| Planning documents | Job › Documents › 09. Planning |
| Meeting minutes | Job › Documents › 11. Meetings |
| Our payment applications | Job › 02. Payment Application |
| Client payment notices | Job › 03. Payment Notice |
| Variations / instructions | Job › 04. Variations |
| Programmes | Job › 06. Project Programme |
| Insurance, certificates, CHAS/ISO | Subcontractor › Compliance, with expiry date |
| Subcontractor / supplier quotes | Job's quote request in Quotes, with the amount (net) |
| Invoices | Left alone (Xero) |
| Signatures, logos, calendar invites | Ignored |

These cases always wait in **To check**:
- The job, sender or type isn't clear.
- The sender isn't in the CRM yet. Add them in Subcontractors or Suppliers, then press File.
- A quote has no open quote request for that trade. "+ New request" creates one.
- A PA or payment notice is for a job with a folder per building, such as Merton.

Files filed into job Documents are **hidden from the client** until someone shows them.

## Good to know

- **Google Drive is only read.** Nothing there is moved, renamed or deleted.
- **Duplicates are skipped.** This covers the same file from two mailboxes and a file
  already in that CRM folder.
- **Cost:** about 3–6p of Claude per file. Signatures and duplicates cost nothing.
- **Turning it off:** untick "Check the folder every 5 minutes". Everything already
  filed stays where it is.
