# FieldPulse Production Configuration Runbook

**Prepared by Manus AI**

## Recommended Production Architecture

FieldPulse should use **Firebase Authentication Phone OTP**, **Firebase Cloud Messaging**, **Google Cloud Storage**, a **Cloud Run API**, and **Cloud SQL for MySQL** in one production Google Cloud project. Firebase provides the Android-facing identity and push services, while Cloud SQL remains the relational system of record for organizations, user roles, attendance, visits, customer data, route events, and audit history.

> **Critical boundary:** The Android application must authenticate to a server API. The server API must authenticate to Cloud SQL. Do not place Cloud SQL credentials, service-account credentials, OTP administration secrets, or unrestricted Maps keys in the Android application.

| Requirement | Recommended service | Reason |
| --- | --- | --- |
| OTP sign-in | Firebase Authentication Phone provider | Supports Android SMS phone verification with required app-verification protections. |
| Workforce API | Cloud Run | Verifies ID tokens, enforces roles, validates payloads, and controls Cloud SQL access. |
| Operational records | Cloud SQL for MySQL | Fits FieldPulse’s relational attendance, visit, role, and audit data. |
| Photos/documents | Cloud Storage | Stores evidence separately from SQL while SQL controls references and authorization. |
| Push notifications | Firebase Cloud Messaging | Supports attendance reminders, assignment alerts, sync warnings, and team communication notifications. |
| Customer/route maps | Google Maps Platform | Provides Android map, customer pin, and navigation capabilities with restricted keys. |

## 1. Create the Production Google Cloud and Firebase Project

Create a dedicated production project rather than reusing a personal or development project. Attach billing, set a billing budget alert, and enable Cloud SQL Admin API, Cloud Run Admin API, Artifact Registry API, Secret Manager API, Cloud Storage, Firebase Authentication, Firebase Cloud Messaging, Maps SDK for Android, and only the optional Maps APIs you actually need.

Create separate identities for deployment, runtime, and database migration. The Cloud Run runtime service account needs only the roles required to connect to Cloud SQL, retrieve narrowly scoped secrets, issue controlled storage operations, and send notifications. A deployment identity may deploy new Cloud Run revisions, but it should not become the API runtime identity.

| Identity | Minimum responsibility |
| --- | --- |
| Cloud Run runtime service account | Cloud SQL Client; least-privilege Secret Manager and Cloud Storage access. |
| Deployment identity | Artifact Registry and Cloud Run deployment operations only. |
| Migration identity | Database schema/migration changes only. |
| Firebase administrator | Authentication provider, app registration, fictional-number testing, and notification project settings. |

## 2. Provision Cloud SQL for MySQL

FieldPulse should use **Cloud SQL for MySQL** because the current project includes a MySQL-oriented backend. Place Cloud Run and Cloud SQL in the same region. Google recommends this placement to reduce latency, some networking costs, and cross-region failure exposure. [2]

1. In Google Cloud Console, enable **Cloud SQL Admin API** and create a Cloud SQL for MySQL instance.
2. Select the required availability and backup settings, then enable automated backups and point-in-time recovery before loading employee information.
3. Create a database such as `fieldpulse_prod`, followed by a non-root application user such as `fieldpulse_api`.
4. Prefer **private IP** with Direct VPC egress or Serverless VPC Access for production. If starting with Cloud Run’s Cloud SQL connection path, attach the instance to Cloud Run and grant the runtime service account the **Cloud SQL Client** IAM role. [2]
5. Store database user, password, database name, and instance connection name in **Secret Manager**. The Android client must never receive these values.
6. Apply migrations for `organizations`, `users`, `roles`, `user_roles`, `device_sessions`, `attendance_records`, `attendance_evidence`, `route_points`, `customers`, `visits`, `visit_evidence`, `chat_channels`, `chat_messages`, `notification_devices`, `sync_operations`, and `audit_events`.

Google’s Cloud Run documentation requires the Cloud Run service identity to receive the Cloud SQL Client role for this connection path. It also documents private-IP connectivity through Direct VPC egress or Serverless VPC Access. [2]

## 3. Configure Firebase Phone OTP

Firebase Phone Authentication is the preferred initial OTP solution because FieldPulse also needs Firebase for Android notification delivery. Firebase documents that Phone Authentication sends a one-time SMS code; it also requires an application-verification path and supports an SMS region policy. [1]

1. Register the final FieldPulse Android application in Firebase using the final package ID.
2. Add the development and release SHA fingerprints as needed. Add SHA-256 for Play Integrity verification and preserve applicable SHA-1 support for reCAPTCHA fallback flows.
3. In **Firebase Console → Authentication → Sign-in method**, enable **Phone**.
4. In **Authentication → Settings**, set the permitted SMS regions. Start with only countries where employees work.
5. Use fictional phone numbers in Firebase for development and integration testing before allowing real SMS traffic.
6. After successful Firebase OTP verification, send the Firebase ID token to the FieldPulse API. The API verifies the token, resolves the FieldPulse organization and role in Cloud SQL, and issues the authorized application session.

Phone ownership alone is not a sufficient administrator security control. Firebase notes that phone-based authentication has security trade-offs. Require a stronger administrator factor, such as a password plus OTP, passkey, or corporate identity provider, before enabling the admin role in production. [1]

## 4. Configure Evidence Storage in Cloud Storage

Create non-public buckets or controlled prefixes for attendance evidence, visit evidence, and exports. Enable **uniform bucket-level access** and public-access prevention for employee photo/document buckets. Google recommends uniform bucket-level access for sensitive data because it allows IAM-only permission management and avoids the complexity of parallel ACL policies. [5]

The evidence sequence must be server-authorized:

1. The mobile app captures evidence and queues it locally under a unique operation ID.
2. The authenticated API verifies the user, organization, role, evidence type, maximum file size, MIME type, and related attendance/visit record.
3. The API issues a short-lived write authorization for an object key limited to that operation.
4. The app uploads over TLS and reports object metadata to the API.
5. The API stores the media reference, content hash, timestamps, validation state, and audit event in Cloud SQL.
6. An authorized administrator retrieves evidence through the API, which issues a short-lived read authorization only after the server checks access.

Cloud Storage signed URLs can grant time-limited object access, and signed policy documents can constrain upload characteristics such as size and content type. [5]

## 5. Configure Firebase Cloud Messaging

Add Firebase Cloud Messaging to the Android build after the Firebase project is created. Create an explanation screen before asking for notification permission on Android 13 or newer. Firebase documents that Android 13+ requires runtime `POST_NOTIFICATIONS` permission, and that device registration identifiers can change and should be sent to the app server when updated. [3]

When the device permission is granted, register the device token with the authenticated FieldPulse API. Store the token with `organization_id`, `user_id`, device metadata, and the last-updated timestamp. Invalidate or unlink it at sign-out. Send only minimal notification text; do not send OTP codes, customer addresses, GPS coordinates, documents, or photos inside notification payloads.

| Notification | Delivery rule |
| --- | --- |
| Attendance reminder | To the assigned employee, based on server time/policy. |
| Visit assignment/change | To the relevant employee/manager after server authorization. |
| Team message | To the authorized channel members. |
| Sync failure | To the record owner or designated manager, without exposing private evidence. |
| Account invitation | To the invited user only after account/role creation is committed by the API. |

## 6. Restrict Google Maps Platform Keys

Create at least two Maps credentials: one Android-restricted key for the FieldPulse app and a separate server credential for any route/geocoding calls that must happen on the API. Do not reuse the Android key on Cloud Run.

1. Enable **Maps SDK for Android**. Enable Routes, Geocoding, or Places only if the corresponding feature is used.
2. Create an Android key and choose **Application restrictions → Android apps**.
3. Enter the FieldPulse package ID and the SHA-1 certificate fingerprint for each release signing identity.
4. Add **API restrictions** to permit only the enabled Maps services the Android app needs.
5. Create a separate server key or supported server-side OAuth identity. Apply server-appropriate restrictions, monitor usage, and set budget alerts.

Google Maps Platform advises using both application and API restrictions. Its Android restriction uses the application package and SHA-1 signing certificate. Google also warns that unrestricted keys can create unauthorized billing exposure. [4]

## 7. Implement Server-Side Role Controls

The mobile UI may hide restricted actions, but it is not a security boundary. The Cloud Run API must verify the Firebase ID token, map identity to a FieldPulse user and organization in Cloud SQL, then enforce the role and resource ownership on every request.

| Role | Authorized production scope |
| --- | --- |
| Field employee | Own profile, own attendance/evidence, assigned customers/visits, own routes, assigned channels. |
| Manager | Authorized team’s attendance, routes, visits, assignments, and manager channels. |
| Administrator | Organization user invitations, role management, authorized workforce records, controlled exports, and audit review. |

All operational records must include `organization_id`. Offline operations must include a client-generated operation ID with a unique database constraint on `organization_id + operation_id` so retries cannot create duplicate attendance or visits. Record immutable audit events for account creation, role changes, sensitive administrator views, evidence access, attendance edits, and exports.

## Configuration Decisions Required Before Connection

Provide these **decisions through secure configuration inputs**, not passwords or keys in ordinary chat:

| Decision | Required value |
| --- | --- |
| Google Cloud project | Production project ID. |
| Deployment region | One primary region for Cloud Run and Cloud SQL. |
| Database | Confirm Cloud SQL for MySQL. |
| Android identity | Final package ID and confirmation of Play App Signing use. |
| OTP coverage | Countries permitted to receive OTP SMS. |
| Workforce policy | Final roles, departments, organization/tenant structure, and manager reporting relationships. |
| Evidence policy | Photo/document retention duration and access policy. |
| Maps scope | Maps SDK only, or Maps plus Routes/Places/Geocoding. |

## References

[1]: https://firebase.google.com/docs/auth/android/phone-auth "Firebase: Authenticate with Firebase on Android using a Phone Number"
[2]: https://docs.cloud.google.com/sql/docs/mysql/connect-run "Google Cloud: Connect from Cloud Run to Cloud SQL for MySQL"
[3]: https://firebase.google.com/docs/cloud-messaging/android/client "Firebase: Get started with Firebase Cloud Messaging in Android apps"
[4]: https://developers.google.com/maps/api-security-best-practices "Google Maps Platform security guidance"
[5]: https://cloud.google.com/storage/docs/access-control "Google Cloud Storage: Overview of access control"
