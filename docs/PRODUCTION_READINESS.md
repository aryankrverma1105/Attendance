# FieldPulse Attendance & Workforce Platform — Production Readiness & Deployment Runbook

> **Verification Policy**: Production readiness is evaluated across five distinct verification tiers:
> 1. **CODE VERIFIED** (Static analysis, architectural review, `tsc --noEmit`)
> 2. **TEST VERIFIED** (Automated Vitest integration suites, Playwright E2E, and production-grade Smoke Tests)
> 3. **EMULATOR VERIFIED** (Android Studio / Expo Go emulator runtime)
> 4. **PHYSICAL DEVICE VERIFIED** (Hardware installation on physical Android devices)
> 5. **LIVE PRODUCTION VERIFIED** (Deployment to Google Cloud SQL & Compute Engine behind reverse proxy)

---

## VERIFIED ARCHITECTURAL CONTROLS

- **Strict Production Port Binding & Reverse Proxy Compatibility** [CODE VERIFIED, TEST VERIFIED]:
  - In production (`NODE_ENV === "production"`), the server strictly binds to `process.env.PORT` (defaulting to 3000).
  - If the port is occupied, the server immediately fails startup (`process.exit(1)`) with a descriptive error instead of silently switching ports.
  - Reverse proxy upstream mapping (`reverse_proxy 127.0.0.1:3000`) is guaranteed never to suffer from silent 502 Bad Gateway outages.
  - Development retains automatic port incrementing for local convenience.

- **Real Database Readiness Probe (`/api/ready`)** [CODE VERIFIED, TEST VERIFIED]:
  - `/api/ready` actively verifies live database connectivity via `checkDbReadiness()` (`SELECT 1`).
  - DB Reachable → Returns **HTTP 200** `{ ready: true, dbConnected: true, timestamp, uptime }`.
  - DB Unreachable → Returns **HTTP 503** `{ ready: false, dbConnected: false, error: "Database unreachable" }`.
  - Reverse proxies, Kubernetes, and load balancers can safely rely on this probe for traffic routing.

- **Complete User-Bound Idempotency System** [CODE VERIFIED, TEST VERIFIED]:
  - Dedicated `idempotency_keys` table tracks all offline-queued mutations across the entire platform.
  - Every operation ID is strictly bound to:
    1. Authenticated User ID (`userId`)
    2. Operation Type (`operationType`)
    3. Resulting Record ID (`recordId`)
    4. Serialized response payload (`responsePayload`)
  - Cross-user rejection: If User B submits an `operationId` previously registered by User A, the server rejects it with `403 FORBIDDEN` instead of returning User A's record.
  - Replay handling: If the same user retries with the same `operationId`, the server returns the cached response without creating duplicate rows.
  - Enforced across all 14 queued WRITE operations:
    1. `ATTENDANCE_CHECK_IN`
    2. `ATTENDANCE_CHECK_OUT`
    3. `GPS_POINT`
    4. `TASK_CREATE`
    5. `TASK_UPDATE`
    6. `CUSTOMER_CREATE`
    7. `CUSTOMER_UPDATE`
    8. `VISIT_CREATE`
    9. `VISIT_CHECK_IN`
    10. `VISIT_COMPLETE`
    11. `VISIT_UPDATE_NOTES`
    12. `VISIT_EVIDENCE`
    13. `EXPENSE_CREATE`
    14. `CHAT_MESSAGE`

- **Visit Evidence Deduplication** [CODE VERIFIED, TEST VERIFIED]:
  - `visit_evidence` table includes a dedicated unique `operationId` column (`visit_evidence_operationId_unique`).
  - Retrying an evidence upload operation returns the existing evidence record and never duplicates rows.

- **Dynamic Chat Channel & Counterpart Resolution** [CODE VERIFIED, TEST VERIFIED]:
  - Eradicated all hardcoded fallback values (such as `targetUserId: 1`).
  - When an offline chat message is queued without a `channelId`:
    - The client forwards `targetUserId` if known from route context.
    - If `targetUserId` is omitted, the server dynamically resolves the counterpart from the authenticated user's organization hierarchy (assigned `managerId` for employees, or active system admin).
    - If no hierarchy exists, it cleanly fails with a resolution requirement error rather than assuming an arbitrary user.

- **Server-Authoritative RBAC & IDOR Defenses** [CODE VERIFIED, TEST VERIFIED]:
  - `protectedProcedure` and `adminProcedure` enforce role checks across all tRPC procedures.
  - Administrative routes require admin authentication; passwords and hashes are never exposed.
  - Wage updates are restricted exclusively to `admin`.
  - Employee dashboard metrics (`getEmployeeDashboard`) strictly derive identity from the authenticated session (`ctx.user`).
  - Expense approvals enforce independent review (self-approval prohibited).

- **Production-Grade Smoke Testing** [TEST VERIFIED]:
  - `scripts/smoke-test.ts` executes real end-to-end verification against the live database:
    1. Database connectivity check (aborts with `DB TEST NOT EXECUTED` if DB is offline).
    2. Real database login and JWT session generation.
    3. Real attendance check-in record insertion.
    4. Duplicate retry using the identical `operationId`, verifying server-side idempotency.
    5. Manager query of team attendance verifying visibility of team records.
    6. Logout / session revocation by bumping `tokenVersion` in MySQL.
    7. Verification that the old session token is rejected by the server.
  - Errors are never swallowed; failures halt execution immediately with non-zero exit codes.

---

## DEPLOYMENT GUIDE

### Step 1: Environment Configuration
Create `.env` based on `.env.example`:
```bash
NODE_ENV=production
PORT=3000
DATABASE_URL=mysql://attendance_user:StrongPassword@127.0.0.1:3306/attendance_db
JWT_SECRET=super-secure-random-64-character-production-jwt-key
ALLOWED_ORIGINS=https://attendance.sologix.energy
SUPER_ADMIN_PHONE=+919876543210
FIREBASE_SERVICE_ACCOUNT=./firebase-service-account.json
ALLOW_INSECURE_DEV=false
```

### Step 2: Database Schema Upgrades
Execute the additive migrations:
```bash
# Apply additive database migration
npx tsx scripts/apply-schema.ts
```
Migrations included:
- `drizzle/0000_elite_eternals.sql` — Base user schema
- `drizzle/0001_light_lilith.sql` — Core tables
- `drizzle/0002_wage_and_attendance.sql` — Daily wages and attendance audit
- `drizzle/0003_odd_toxin.sql` — Customers, visits, chat, expenses, notifications
- `drizzle/0004_security_and_idempotency.sql` — `idempotency_keys` table and `visit_evidence.operationId`

### Step 3: Reverse Proxy Setup (Caddy / Nginx)
Production domains:
- Production API: `https://attendance.sologix.energy`
- Preview API: `https://preview-attendance.sologix.energy`

#### Caddyfile:
```caddy
attendance.sologix.energy {
    reverse_proxy 127.0.0.1:3000
}
```

#### Nginx:
```nginx
server {
    server_name attendance.sologix.energy;
    listen 443 ssl http2;
    
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Step 4: PM2 Process Management
```bash
# Build production bundle
npm run build

# Start with PM2
pm2 start dist/index.js --name "attendance-backend" -i max
pm2 save
```

### Step 5: EAS Mobile App Builds
Mobile build profiles are configured in `eas.json` with HTTPS production endpoints:
```bash
# Production Android App Bundle (AAB) for Google Play:
eas build -p android --profile production

# Preview APK for direct distribution and technician QA:
eas build -p android --profile preview
```

---

## ROLLBACK POLICY

### Non-Destructive Code Rollback
All database migrations are purely additive (`CREATE TABLE IF NOT EXISTS`, nullable columns with defaults, dedicated indexes).
Destructive statements (`DROP TABLE`, `DROP COLUMN`) are strictly prohibited in production.

If a code rollback is required:
```bash
git checkout <PREVIOUS_STABLE_TAG>
npm install --production
npm run build
pm2 restart attendance-backend --update-env
```
Older code safely ignores newly added columns and tables without error.

---

## DISASTER RECOVERY

### 1. Pre-Deployment Cloud SQL Backup
```bash
gcloud sql backups create \
  --instance=attendance-mysql \
  --description="Pre-deployment backup"
```

### 2. Point-in-Time Recovery
```bash
gcloud sql backups restore <BACKUP_ID> --restore-instance=attendance-mysql
```

---

## REMAINING RISKS & MITIGATIONS

1. **Android OEM Aggressive Battery Optimization**:
   - *Risk*: Background GPS tracking may be killed by OEM battery savers (Xiaomi, Samsung) after 15 minutes of screen inactivity.
   - *Mitigation*: In-app guidance prompt advises field workers to disable battery optimization in Android App Info.
2. **Push Notifications in Air-Gapped Environments**:
   - *Risk*: Devices without Google Play Services cannot receive FCM notifications.
   - *Mitigation*: In-app short-polling and local notifications ensure timely alerts regardless of FCM status.
