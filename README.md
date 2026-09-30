# God's Grace Ministry (GGM) Instrumentalists Attendance Portal

An enterprise-grade mobile attendance and member management application built for the Instrumentalists Department of **God's Grace Ministry Int'l Headquarters, Warri, Delta State, Nigeria**.

---

## 🏛️ Overview

The portal automates and secures departmental attendance for the **First Tuesday** monthly cleaning, maintenance, and sound-check sessions. It features cryptographic geofencing, live selfie verification, offline queueing, an official monthly PDF report generator, and a 3-tier role management system.

---

## 🔐 3-Role Architecture

Access control is enforced directly at the database layer via PostgreSQL **Row Level Security (RLS)** and the security definer function `public.get_my_role()`.

| Role | Access Scope | Key Capabilities |
|---|---|---|
| **`super_admin`** | Full Department Administration | • Access Super Admin Dashboard<br>• View live session summaries & historical records<br>• Download/archive official monthly PDF reports with photos<br>• View 3-month Top Performers service rankings (100% / 70% / 40%)<br>• Manage roles (promote to Sub-Admin, demote to Member, transfer Super Admin)<br>• Review & approve offline sync submissions<br>• Inspect system security audit logs |
| **`sub_admin`** | View-Only Session Supervision | • Access Sub-Admin Portal<br>• View today's attendance list in real time with member selfie photos (signed URLs)<br>• Verified participant totals<br>• Cannot modify records, export PDFs, or alter roles |
| **`member`** | Self-Service | • Live biometric selfie check-in (restricted to church HQ 120m radius)<br>• Offline check-in queueing with background synchronization<br>• Personal attendance history & profile management<br>• In-app push notifications & reminders |

---

## 📱 Mobile Application (Expo SDK 57 / React Native)

### Brand Theme & Aesthetics
- **Primary Navy:** `#173B70`
- **Dark Navy:** `#0E2547`
- **Surface & Backgrounds:** White `#FFFFFF`, Slate `#F8FAFC`
- **Borders & Dividers:** `#E2E8F0`
- **Accents:** Green `#15803D`, Amber `#B45309`, Red `#DC2626`
- **Brand Mark:** Official church emblem (`assets/logo.png`)

### Screen Directory
- **Authentication & Onboarding:**
  - `LoginScreen.js`: Phone or email login with synthetic fallback.
  - `RegisterScreen.js`: New member registration with live password strength meter.
  - `CompleteProfileScreen.js`: Mandatory password reset / onboarding flow.
- **Member Screens:**
  - `HomeScreen.js`: Dynamic role-conditional home portal with notification bell.
  - `CheckInScreen.js`: Camera capture, location verification, and live submission.
  - `MemberHistoryScreen.js`: Member's personal check-in logs.
  - `ProfileScreen.js`: Avatar photo management and secured password change.
  - `NotificationsScreen.js`: Department announcements and reminders.
- **Super Admin & Sub-Admin Screens:**
  - `SuperAdminDashboardScreen.js`: Real-time session metrics, quick actions, and PDF downloads.
  - `SubAdminAttendanceScreen.js`: Read-only attendee roster with member photos.
  - `TopPerformersScreen.js`: 3-month service evaluation (100% Gold, 70% Silver, 40% Bronze).
  - `ManageRolesScreen.js`: Admin appointment & demotion with safeguard against last super-admin deletion.
  - `AllAttendanceScreen.js`: Multi-session attendance filterable by instrument and search query.
  - `AuditLogScreen.js`: Immutable security log of administrative actions.
  - `PendingReviewScreen.js`: Approval desk for offline check-ins.

---

## ⚡ Supabase Backend

### Database Migrations
- `phase6_upgrade.sql`: Main upgrade migration. Contains:
  - Role helper: `public.get_my_role()`.
  - Integrity triggers: `check_last_super_admin()` and `prevent_self_role_change()`.
  - Role management RPCs: `promote_to_sub_admin()`, `demote_to_member()`, `transfer_super_admin()`.
  - Top Performers RPC: `get_top_performers()` (evaluates the last 3 finalized activities).
  - Strict RLS policies across all tables.

### Supabase Edge Functions (`supabase/functions/`)
1. **`generate-attendance-pdf`**:
   - Deno function powered by `pdf-lib`.
   - Generates official letterhead, participant table with embedded member photos, session statistics, and signature lines for Department Leader and Pastor.
   - Archives PDF to private `reports` storage bucket.
2. **`send-reminder`**:
   - Batch delivers push notifications (via Expo Push API) on Monday 6:00 PM WAT (Eve reminder) and Tuesday 5:30 AM WAT (Session opening).
3. **`auto-create-activity`**:
   - Computes the First Tuesday of each month and auto-schedules the session.
4. **`send-otp` & `verify-otp`**:
   - Email verification code handler.

### Automated Cron Schedules
See `cron_schedules.sql` for setup with `pg_cron` and `pg_net`.

---

## 🚀 Deployment Instructions

### 1. Database Setup
1. In your Supabase Dashboard, navigate to the **SQL Editor**.
2. Run `phase6_upgrade.sql` to install all tables, functions, triggers, and RLS policies.
3. Configure the password policy under **Authentication → Providers → Email** (Minimum 6 characters, containing letters and numbers).

### 2. Deploy Edge Functions
1. Set the shared `CRON_SECRET` in **Supabase Dashboard -> Project Settings -> Edge Functions -> Secrets**.
2. Deploy the functions (PDF requires JWT, cron jobs use shared secret):
```bash
# PDF generator: JWT verification enabled (Super Admin authenticated)
npx supabase functions deploy generate-attendance-pdf

# Scheduled functions: invoked via cron webhooks with x-cron-secret header
npx supabase functions deploy send-reminder --no-verify-jwt
npx supabase functions deploy auto-create-activity --no-verify-jwt
```

### 3. Run the Mobile App Locally
```bash
# Install dependencies
npm install

# Start development server
npx expo start
```

### 4. Build Production Release (EAS)
```bash
# Build Android APK / App Bundle
npx eas-cli build --platform android --profile production

# Build iOS Release
npx eas-cli build --platform ios --profile production
```

---

## 🛡️ Security Guidelines
- **Zero Client Role Trust:** Client-side role variables only toggle UI elements; PostgreSQL RLS and security definer functions are the actual security wall.
- **Biometric Telemetry:** Photos in the `selfies` storage bucket are strictly private and accessible only via time-limited signed URLs (1 hour expiry).
- **Audit Logging:** Administrative promotions and role transfers are permanently recorded in `public.audit_logs`.
