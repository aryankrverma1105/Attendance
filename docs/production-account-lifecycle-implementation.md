# Sologix Energy Attendance — Production Account Lifecycle Runbook

**Prepared for:** Sologix Energy Pvt Ltd  
**Developer attribution:** Aryan Kumar Verma  
**Scope:** Firebase phone OTP activation, administrator-issued access, suspension/reactivation, and immutable Cloud SQL lifecycle audit events.

## 1. Use This Production Architecture

The secure implementation has three separate responsibilities. The Android app performs the user-facing phone OTP flow. A Sologix API running on Cloud Run validates Firebase identity tokens and makes authorization decisions. Cloud SQL for MySQL stores the organization-owned account, role, invitation, attendance, visit, route, and audit data.

> **Do not connect the Android app directly to Cloud SQL.** The app should send a Firebase ID token to the Sologix API over HTTPS. The API verifies the token, retrieves the Firebase UID, and then checks the matching Sologix account, organization, role, and account status. Firebase documents this backend token-verification pattern explicitly. [3]

| Layer | Responsibility | Must not do |
| --- | --- | --- |
| Android app | Start phone OTP after user consent, submit Firebase ID token, display account status, and sign out locally after access is revoked. | Store database passwords, Firebase Admin credentials, or make administrator decisions locally. |
| Cloud Run API | Verify Firebase tokens, enforce tenant/role checks, create invitations, enqueue Firebase operations, write application audit events, and issue signed upload permissions. | Trust a submitted role, organization, or user ID from the client without server-side validation. |
| Firebase Authentication | Verify the phone number through app-verified SMS OTP and manage the Firebase identity record. | Act as the Sologix authorization database. |
| Cloud SQL for MySQL | Hold the authoritative Sologix account lifecycle, permissions, invitation, and immutable audit data. | Be exposed to the Android app. |

## 2. Important OTP Design Decision

Firebase Phone Authentication does **not** provide a server-side “send an invitation OTP” operation for an administrator to trigger. The Firebase Admin SDK can create a user with a phone number **without** an SMS verification flow; that is different from a user proving possession of that number. [2]

The correct Sologix workflow is therefore: an administrator grants access by creating an **invitation record**; the employee opens the Sologix app and starts the Firebase phone OTP flow themselves; after Firebase verifies their phone, the Sologix API activates only the matching pending invitation. Firebase’s Android flow requires the Phone provider, an SMS-region policy, and Android app verification through Play Integrity where possible, with reCAPTCHA fallback requirements documented by Firebase. [1]

| Administrator action | What the server does | What the employee does |
| --- | --- | --- |
| **Create account** | Creates an `account_invitations` row with role, organization, normalized E.164 phone, expiry, and `pending` status. Adds an audit event. | Receives an informational notification by an approved channel, such as company email, SMS provider, or manager instruction. |
| **Issue access** | Marks the invitation as `issued`; never marks the account active solely because a button was tapped. Adds an audit event and queues an optional notification. | Opens the app, enters the invited phone number, and requests their Firebase OTP. |
| **Verify OTP** | Verifies the client Firebase ID token and matches its verified phone number with the pending invitation. Creates/links the Sologix user and activates the account in one database transaction. | Enters the code or completes Firebase auto-verification. |

## 3. Firebase Console Setup

Create a dedicated **production** Firebase project under the same Google Cloud organization as Sologix production. Do not reuse a development Firebase project for employees.

1. In Firebase Console, create or select the Sologix production project and register the Android application with the final package name from `app.config.ts`.
2. In **Authentication → Sign-in method**, enable **Phone**.
3. In **Authentication → Settings**, configure the **SMS region policy** to allow only the countries where Sologix operates. New Firebase projects can have no allowed regions by default. [1]
4. Add the Android **SHA-256** signing fingerprint for Play Integrity verification. Also retain the **SHA-1** fingerprint needed by relevant reCAPTCHA fallback scenarios. [1]
5. Add fictional development phone numbers in Firebase before testing; they avoid sending real SMS messages and avoid consuming production SMS quota during development. [1]
6. Review the consent copy before the user requests a code. Firebase notes that phone numbers are processed for spam and abuse prevention and that users should be informed about SMS verification and possible standard message rates. [1]

> **Privileged administrator accounts:** Do not rely on phone OTP alone for administrator authentication. Firebase notes that phone-only sign-in has security trade-offs. Add a stronger factor for administrators, such as an enterprise identity provider, verified work email with MFA, or a separate approval policy. [1]

## 4. Android-to-API Activation Flow

The Android app should use Firebase native authentication, not a custom backend OTP generator. After the app receives a Firebase credential, it signs in locally and retrieves an ID token. Firebase documents retrieving the current user’s ID token and sending it to the backend over HTTPS. [3]

```text
Employee enters invited phone number
        ↓
Firebase Phone Auth validates app and sends/auto-verifies OTP
        ↓
Android signs in with Firebase credential
        ↓
Android obtains Firebase ID token
        ↓
POST /v1/auth/activate  Authorization: Bearer <Firebase ID token>
        ↓
Cloud Run verifies token, including revocation when required
        ↓
Cloud Run finds pending Sologix invitation matching normalized verified phone
        ↓
Cloud SQL transaction links Firebase UID, activates user, consumes invitation,
creates immutable audit event, and queues any welcome notification
        ↓
API returns Sologix account profile, organization, role, and policy version
```

The endpoint must never accept a client-supplied role or organization ID as authoritative. It uses the verified Firebase UID and phone claim, then resolves Sologix authorization from Cloud SQL.

### Recommended API Contract

| Endpoint | Caller | Required checks | Result |
| --- | --- | --- | --- |
| `POST /v1/admin/invitations` | Administrator | Verify Firebase token, require Sologix `admin` role, validate E.164 phone, prevent duplicate active invitation, scope to the administrator’s organization. | Creates pending invitation and audit event. |
| `POST /v1/admin/invitations/:id/issue` | Administrator | Same admin/organization checks; invitation must be unexpired and pending/issued. | Sets issue time, queues permitted notification, and adds audit event. |
| `POST /v1/auth/activate` | Invited employee | Verify Firebase ID token; confirm token is valid, unrevoked when required, and its phone number matches a pending invitation. | Links Firebase UID, activates account, consumes invitation, returns account profile. |
| `POST /v1/admin/users/:id/suspend` | Administrator | Verify token, admin role, target in same organization, prevent self-suspension without separate break-glass flow. | Suspends Sologix account, queues Firebase disable/revocation, adds audit event. |
| `POST /v1/admin/users/:id/reactivate` | Administrator | Verify token, admin role, target in same organization, and a valid reactivation reason. | Reactivates Sologix account, enables Firebase user, adds audit event. |

### Server-Side Pseudocode

```ts
async function activateInvitedUser(idToken: string) {
  const firebaseToken = await firebaseAuth.verifyIdToken(idToken, true);
  const verifiedPhone = normalizeE164(firebaseToken.phone_number);
  if (!verifiedPhone) throw new HttpError(403, "Phone verification is required");

  return database.transaction(async (tx) => {
    const invitation = await tx.invitation.findActiveForPhoneForUpdate(verifiedPhone);
    if (!invitation || invitation.expiresAt < new Date()) {
      throw new HttpError(403, "No active account invitation");
    }

    const user = await tx.users.createOrLink({
      organizationId: invitation.organizationId,
      firebaseUid: firebaseToken.uid,
      phoneE164: verifiedPhone,
      role: invitation.role,
      accountStatus: "active",
    });
    await tx.invitations.consume(invitation.id, user.id);
    await tx.audit.append({
      organizationId: invitation.organizationId,
      actorUserId: user.id,
      subjectUserId: user.id,
      action: "account.activated_after_phone_otp",
      requestId: requestContext.requestId,
    });
    return user;
  });
}
```

## 5. Suspension, Reactivation, and Deletion

For normal offboarding, **suspend rather than delete**. Suspension preserves attendance, visit, route, evidence, and audit records while stopping further access. The Firebase Admin SDK supports setting a Firebase user to disabled and later enabling them. [2]

Firebase documents that refresh tokens expire when a user is disabled, deleted, or experiences certain major account changes. It also provides `revokeRefreshTokens` and revocation-aware ID-token checks. [4]

| Lifecycle state | Sologix Cloud SQL state | Firebase Auth action | Access outcome |
| --- | --- | --- | --- |
| `invited` | Invitation is issued; no active Sologix user yet, or linked user remains pending. | Do not expect a Firebase server call to send the OTP. | User cannot access protected Sologix APIs. |
| `active` | User role and organization are active. | Firebase user enabled. | API permits only role-scoped operations. |
| `suspended` | Set account status and `suspended_at`, reason, and actor ID. | `updateUser(uid, { disabled: true })`, then revoke refresh tokens. | Existing clients are rejected by revocation-aware API validation and must sign out. |
| `reactivated` | Set account active; record reason and actor ID. | `updateUser(uid, { disabled: false })`. | User must sign in and complete OTP again; do not restore an old session. |
| `removed` | Soft-delete from active directory with `removed_at`; retain compliance data under policy. | Delete Firebase user only if your legal/privacy policy requires it. | No access; retained records are audit-only. |

### Do Not Rely Only on Disabling Firebase

The Sologix API must also check its own Cloud SQL `account_status` on every protected request. This protects the business system even if Firebase state changes are delayed or an account is blocked internally for a reason unrelated to Firebase. For high-risk administrator actions, use Firebase revocation-aware verification—`verifyIdToken(idToken, true)` in Node-style pseudocode—because ordinary token verification does not itself check revocation. [3] [4]

### Use an Outbox for Firebase Operations

Do not hold a Cloud SQL transaction open while calling Firebase. Instead, write the account-state change, immutable audit event, and an `account_action_outbox` record in one Cloud SQL transaction. A Cloud Run worker processes the outbox, calls Firebase, and stores the provider outcome. This makes retries controlled and prevents a network failure from leaving the Sologix database and Firebase in an unknown partial state.

```text
Admin presses Suspend
        ↓
Cloud SQL transaction: user status=suspended + audit event + outbox action
        ↓
Transaction commits
        ↓
Worker: disable Firebase user + revoke refresh tokens
        ↓
Worker marks outbox delivered or schedules an idempotent retry
```

## 6. Cloud SQL Schema for Account Lifecycle and Audit Events

Use one organization identifier on every tenant-owned record. The following MySQL-oriented schema is a foundation, not a substitute for a reviewed migration.

```sql
CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  firebase_uid VARCHAR(128) UNIQUE NULL,
  phone_e164 VARCHAR(20) NULL,
  display_name VARCHAR(160) NOT NULL,
  role ENUM('admin','manager','employee') NOT NULL,
  account_status ENUM('invited','active','suspended','removed') NOT NULL,
  access_issued_at DATETIME NULL,
  suspended_at DATETIME NULL,
  removed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_phone (organization_id, phone_e164),
  KEY ix_org_status (organization_id, account_status)
);

CREATE TABLE account_invitations (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  user_id CHAR(36) NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  role ENUM('admin','manager','employee') NOT NULL,
  status ENUM('pending','issued','consumed','expired','cancelled') NOT NULL,
  expires_at DATETIME NOT NULL,
  issued_at DATETIME NULL,
  consumed_at DATETIME NULL,
  created_by_user_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_invitation_lookup (organization_id, phone_e164, status, expires_at)
);

CREATE TABLE account_action_outbox (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  user_id CHAR(36) NOT NULL,
  action ENUM('firebase_disable','firebase_enable','firebase_revoke_tokens','notify_access_issued') NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  status ENUM('pending','processing','delivered','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  available_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## 7. Make Administrator Audit Events Append-Only

Cloud SQL Audit Logs record Google Cloud resource-level administrative and access activity. They are useful for instance, user, backup, and database API oversight, but they do not replace application events such as “Sologix administrator suspended employee 123” or “administrator viewed route evidence.” [5]

Create a separate application table for those business events. Include an event hash and previous hash to make unexpected modification detectable. Store sensitive values only as normalized identifiers or approved redacted summaries; never put OTPs, ID tokens, database passwords, raw evidence URLs, or full photo data in the audit payload.

```sql
CREATE TABLE audit_chain_heads (
  organization_id CHAR(36) PRIMARY KEY,
  last_event_id CHAR(36) NULL,
  last_event_hash BINARY(32) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE admin_audit_events (
  id CHAR(36) PRIMARY KEY,
  organization_id CHAR(36) NOT NULL,
  actor_user_id CHAR(36) NULL,
  subject_user_id CHAR(36) NULL,
  action VARCHAR(120) NOT NULL,
  reason_code VARCHAR(80) NULL,
  request_id VARCHAR(80) NOT NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json JSON NOT NULL,
  previous_event_hash BINARY(32) NULL,
  event_hash BINARY(32) NOT NULL,
  KEY ix_audit_org_time (organization_id, occurred_at),
  KEY ix_audit_subject_time (subject_user_id, occurred_at)
);

DELIMITER //
CREATE TRIGGER prevent_admin_audit_update
BEFORE UPDATE ON admin_audit_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'admin_audit_events are append-only';
END//

CREATE TRIGGER prevent_admin_audit_delete
BEFORE DELETE ON admin_audit_events
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'admin_audit_events are append-only';
END//
DELIMITER ;
```

When appending an event, lock the organization’s `audit_chain_heads` row with `SELECT ... FOR UPDATE`, calculate the new hash from canonical fields plus the previous hash, insert the event, and update only the chain-head row. Give the Cloud Run runtime database account `INSERT` and `SELECT` rights on `admin_audit_events`, but no `UPDATE` or `DELETE` rights. Use a separate, tightly controlled migration identity for schema changes.

> Append-only tables protect normal application behavior, but they do not make data universally unalterable from a database administrator. Combine application controls with least-privilege IAM, Cloud SQL backups, Cloud Audit Logs, protected log sinks, retention settings, and periodic hash-chain verification.

## 8. Cloud Run Service Account and Secrets

Run the API with a dedicated Cloud Run service account. Prefer attached service identity and Google Application Default Credentials over downloading Firebase Admin service-account JSON into the app or committing it to the repository.

| Configuration item | Where it belongs | Purpose |
| --- | --- | --- |
| `FIREBASE_PROJECT_ID` | Cloud Run environment configuration | Ties Admin SDK verification to the correct Firebase project. |
| Cloud Run service account | IAM | Needs the Firebase user-management permission set, Cloud SQL connection permission, and narrowly scoped Secret Manager access. |
| `DB_HOST` / Cloud SQL connection name | Cloud Run configuration | Routes the API to Cloud SQL through the selected secure connector/private path. |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Secret Manager | Database runtime credentials; never inside Android assets or source control. |
| `AUDIT_HASH_SECRET` | Secret Manager | Optional keyed-hash secret for application audit event chaining. |
| Android Firebase configuration | Native Android build configuration | Identifies the Android app to Firebase; it is not a substitute for server-side authorization. |

## 9. Deployment Sequence

| Stage | Deliverable | Exit check |
| --- | --- | --- |
| 1. Foundations | Production Firebase project, Cloud SQL MySQL instance, Cloud Run service account, Secret Manager configuration. | No secret is committed to the mobile repository or exposed to the Android bundle. |
| 2. Schema | Migrations for users, invitations, outbox, and audit records. | Migration runs in a staging database and audit update/delete triggers reject changes. |
| 3. API | Firebase token middleware, role guard, invitation activation, suspend/reactivate endpoints, outbox worker. | Unit tests prove cross-organization, non-admin, and self-removal requests are rejected. |
| 4. Android | Firebase native OTP flow, activation call, status-specific UI, forced sign-out handling. | Fictional numbers complete activation in staging; suspended account receives a sign-out/denial response. |
| 5. Security verification | Staging penetration/authorization review, audit-chain verification job, alerting. | Admin action appears in Sologix audit table and protected Cloud audit destination. |

## 10. Configuration Decisions Needed Before Connection

Please decide the following before the backend is connected. Do **not** paste secrets or database passwords into chat.

| Decision | Recommended initial choice |
| --- | --- |
| Google Cloud project ID and region | Dedicated Sologix production project in the closest operating region. |
| Database engine | Cloud SQL for MySQL, aligning with the current mobile backend dependency. |
| Final Android package and signing certificate | Use the production package and Google Play App Signing fingerprints before enabling live OTP. |
| OTP countries | Only the countries where Sologix has employees; enforce them through Firebase SMS region policy. |
| Admin authentication | Phone OTP plus an additional administrator factor or enterprise identity provider. |
| Suspension policy | Define who can suspend, approval requirements, reason codes, and maximum reactivation authority. |
| Audit retention | Define HR/compliance retention period, log export destination, and who may access evidence-view audit events. |
| Notification channel | Decide whether account-issued notice uses company email, an approved SMS provider, or a manager workflow; Firebase phone OTP itself is the employee-initiated verification step. |

## References

[1]: https://firebase.google.com/docs/auth/android/phone-auth "Firebase Authentication: Phone number sign-in for Android"

[2]: https://firebase.google.com/docs/auth/admin/manage-users "Firebase Authentication: Manage users with the Admin SDK"

[3]: https://firebase.google.com/docs/auth/admin/verify-id-tokens "Firebase Authentication: Verify ID tokens"

[4]: https://firebase.google.com/docs/auth/admin/manage-sessions "Firebase Authentication: Manage user sessions and token revocation"

[5]: https://docs.cloud.google.com/sql/docs/mysql/audit-logging "Google Cloud: Cloud SQL for MySQL audit logging"
