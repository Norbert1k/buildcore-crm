# BuildCore CRM
### Internal Subcontractor Management System

A full-stack CRM built for construction companies to manage subcontractors, track compliance documents (RAMS, insurances, certificates), and link subcontractors to projects — with live expiry alerts.

---

## What's Included

| Feature | Details |
|---|---|
| **Subcontractor Database** | Company details, contact info, trade, status, notes |
| **Document Tracking** | RAMS, insurances, CSCS, Gas Safe, NICEIC, CHAS, ISO certs, F10s + more |
| **Expiry Alerts** | Dashboard warnings for expired + expiring-within-30-days documents |
| **Project Tracking** | Projects with start/end dates, assigned PM, subcontractors per project |
| **User Roles** | Admin, Project Manager, Document Controller, Viewer |
| **Secure Login** | Supabase Auth — email/password, row-level security |

---

## Deployment (takes ~20 minutes)

### Step 1 — Create your Supabase project (free)

1. Go to **https://supabase.com** and click **Start for free**
2. Sign up and create a new project — name it "buildcore-crm"
3. Choose a region close to your team (e.g. Europe West)
4. Set a strong database password and save it somewhere safe
5. Wait ~2 minutes for the project to provision

### Step 2 — Set up the database

1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open the file `supabase/migrations/001_schema.sql` from this project
4. Paste the entire contents into the SQL editor
5. Click **Run** (green button)
6. You should see "Success. No rows returned" — your database is ready

### Step 3 — Get your API credentials

1. In Supabase, go to **Settings → API**
2. Copy the **Project URL** (looks like `https://abcdefgh.supabase.co`)
3. Copy the **anon / public** key (long string starting with `eyJ...`)
4. Keep these — you'll need them in the next step

### Step 4 — Configure the app

1. In the project folder, find the file `.env.example`
2. Make a copy of it called `.env` (in the same folder)
3. Fill in your credentials:

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

### Step 5 — Create your first admin user

1. In Supabase, go to **Authentication → Users**
2. Click **Add user → Create new user**
3. Enter your email and a password
4. Click **Create user**
5. Now go to **Table Editor → profiles**
6. Find your user row and click edit
7. Change the `role` column from `viewer` to `admin`
8. Save — you're now the admin

### Step 6 — Deploy to Vercel (free hosting)

**Option A — GitHub (recommended)**
1. Create a free account at **https://github.com** if you don't have one
2. Create a new repository called `buildcore-crm`
3. Upload all the project files to it
4. Go to **https://vercel.com** and sign in with GitHub
5. Click **New Project** and import your repository
6. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your Supabase anon key
7. Click **Deploy**
8. In ~2 minutes you'll have a live URL like `buildcore-crm.vercel.app`

**Option B — Vercel CLI (faster)**
1. Install Node.js from https://nodejs.org (LTS version)
2. Open a terminal in the project folder
3. Run these commands:
```bash
npm install
npm run build
npx vercel --prod
```
4. Follow the prompts — Vercel will ask you to log in and set env vars

### Step 7 — Add your team

1. Log in to the live app as admin
2. Go to **Settings**
3. Click **Add User** and enter their name, email and role
4. They'll receive an invitation email with a link to set their password

---

## Running Locally (for development)

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:3000
```

---

## User Roles

| Role | Subcontractors | Documents | Projects | Users |
|---|---|---|---|---|
| **Admin** | Add / Edit / Delete | Add / Edit / Delete | Add / Edit | Manage |
| **Project Manager** | Add / Edit | Add / Edit | Add / Edit | — |
| **Document Controller** | View only | Add / Edit | View only | — |
| **Viewer** | View only | View only | View only | — |

---

## Document Types Supported

**Insurance:** Public Liability, Employer's Liability, Professional Indemnity

**Health & Safety:** RAMS, Method Statement, Risk Assessment, F10 CDM Notification

**Certifications:** CSCS Card, Gas Safe, NICEIC, CHAS, Constructionline, Trade Certificates

**Quality & Environment:** ISO 9001, ISO 14001, ISO 45001

**Other:** Any custom document with an expiry date

---

## Expiry Alert Logic

| Status | Condition | Colour |
|---|---|---|
| **Expired** | Expiry date is in the past | 🔴 Red |
| **Expiring Soon** | Expires within 30 days | 🟡 Amber |
| **Valid** | Expires in 31+ days | 🟢 Green |
| **No Expiry** | No expiry date set | ⚪ Grey |

---

## Tech Stack

- **Frontend:** React 18 + Vite
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth
- **Hosting:** Vercel (recommended)
- **Styling:** Custom CSS (no framework dependency)

---

## Support & Customisation

This CRM was built specifically for your company. Common customisations:
- Add more document types → edit `DOCUMENT_TYPES` in `src/lib/utils.js`
- Add more trades → edit `TRADES` array in `src/lib/utils.js`
- Change expiry warning window (currently 30 days) → edit the `interval '30 days'` in `001_schema.sql` and `docStatusInfo` in `utils.js`
- Add email notifications → connect Supabase Edge Functions with Resend or SendGrid
