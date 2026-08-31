# Research Notes — Firebase and Cloud SQL Account Lifecycle

## Official Sources Consulted

| Topic | Source | Key implementation finding |
| --- | --- | --- |
| Android phone OTP | [Firebase phone authentication](https://firebase.google.com/docs/auth/android/phone-auth) | Phone sign-in sends an SMS verification code. Enable the Phone provider, define allowed SMS regions, register Android SHA-256 for Play Integrity, and retain SHA-1 support for relevant reCAPTCHA fallback flows. Firebase recommends clear user consent and notes that phone-only authentication has security trade-offs. |
| Firebase user administration | [Firebase Admin user management](https://firebase.google.com/docs/auth/admin/manage-users) | Server-side Admin SDK can create, look up, update, disable, and delete users. It supports provisioning disabled users and later controlling when they are enabled. User email or phone conflicts fail user creation. |
| Backend token verification | [Firebase Admin ID token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens) | A client sends its Firebase ID token over HTTPS; the trusted backend verifies it with the Admin SDK and derives the Firebase UID. Standard verification does not by itself check revocation, so higher-risk endpoints should use revocation-aware validation or a server-side active-account check. |
| Cloud SQL operational auditing | [Cloud SQL for MySQL audit logging](https://docs.cloud.google.com/sql/docs/mysql/audit-logging) | Cloud Audit Logs cover Cloud SQL administrative and access API activity. They complement, but do not replace, application-level admin audit records for user lifecycle actions. |

## Architecture Decisions for Sologix

1. The Android app should complete Firebase phone OTP locally, obtain the Firebase ID token, and call the Sologix Cloud Run API over HTTPS.
2. The Cloud Run API should verify the ID token, load the Sologix user by `firebase_uid` and `organization_id`, and reject inactive, suspended, removed, or unauthorized users before each protected operation.
3. Administrators should create an `account_invitation` in Cloud SQL first. The API creates or links the Firebase Auth user only from the secured administrator endpoint, then records the Firebase UID and account lifecycle event in one database transaction.
4. Suspension is preferred over deletion for ordinary employee offboarding. Set the Sologix account status to `suspended`, disable the Firebase Auth user, revoke refresh tokens, and retain attendance/visit/audit data. Use deletion only when policy or privacy requirements demand it.
5. Application-level `admin_audit_events` must be append-only. Database users used by the Cloud Run API should have no `UPDATE` or `DELETE` permission on that table. Cloud Audit Logs should additionally be routed to a protected retention destination for infrastructure oversight.

## URLs

1. https://firebase.google.com/docs/auth/android/phone-auth
2. https://firebase.google.com/docs/auth/admin/manage-users
3. https://firebase.google.com/docs/auth/admin/verify-id-tokens
4. https://docs.cloud.google.com/sql/docs/mysql/audit-logging
