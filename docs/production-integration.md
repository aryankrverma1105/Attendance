# FieldPulse Production Integration Checklist

## Security Boundary

The Android client must not connect directly to Cloud SQL or any external OTP provider. Deploy an authenticated API service between the mobile application and Cloud SQL. The API enforces tenant membership, role-based authorization, request validation, audit events, rate limits, and server-authoritative timestamps. It then uses a private or tightly restricted database connection and parameterized queries to access Cloud SQL.

## Required Configuration Decisions

| Service | Required decision | Production minimum |
| --- | --- | --- |
| Cloud SQL | MySQL or PostgreSQL, region, high-availability requirement, private/IP connectivity model | Private connectivity or narrowly restricted IP access, automated backups, point-in-time recovery, separate application database user. |
| OTP | SMS/email provider and sender identity | Six-digit, single-use codes; short expiry; attempt and resend rate limits; hashed OTP storage; generic failure messages. |
| API hosting | Runtime and region close to the Cloud SQL instance | TLS-only endpoint, service identity, secret manager, structured audit logs, HTTP request size limits. |
| Object storage | Attendance/visit evidence bucket and retention policy | Per-object access controls, short-lived upload permissions, malware/media validation, lifecycle retention policy. |
| Maps | Google Maps Platform project and restricted Android API key | Android package and certificate restrictions, billing alerts, server-side route APIs where sensitive. |
| Notifications | Firebase Cloud Messaging project | Server-side token registration with authenticated user/tenant ownership checks. |

## Cloud SQL Schema Domains

The production schema should contain a tenant or organization key across every operational record. The minimum domains are `users`, `roles`, `employee_profiles`, `device_sessions`, `otp_challenges`, `attendance_records`, `attendance_evidence`, `customers`, `customer_locations`, `visits`, `visit_evidence`, `visit_forms`, `follow_up_tasks`, `route_points`, `expenses`, `chat_channels`, `chat_messages`, `notifications`, `sync_operations`, and `audit_events`.

Attendance and visit submissions should include an immutable client operation ID. The server places a unique index on tenant ID plus operation ID so retries from the offline queue cannot create duplicates. Evidence files are stored in object storage; Cloud SQL stores only references, media hashes, server-side validation results, timestamps, and access-control metadata.

## Authentication and Authorization Flow

1. The employee enters a mobile number or email address.
2. The API applies account, IP, and device-based rate limits before sending a code through the OTP provider.
3. The API hashes the one-time code, records a short expiry and attempt count, and returns a generic response to prevent account enumeration.
4. On successful verification, the server creates a short-lived access token and rotating refresh token bound to the user, tenant, role, and trusted device record.
5. The native client stores credentials only in Android Keystore/iOS Keychain-backed secure storage. Offline work data remains separate from credentials.
6. Every API call verifies token signature, expiration, tenant ownership, role permissions, input schema, and resource ownership before processing.

## Evidence and Tracking Policy

The backend should calculate any configurable attendance geofence distance using authoritative customer/office coordinates and the submitted accuracy radius. Client coordinates are evidence, not unquestioned truth. Persist device time, client time, server receive time, location accuracy, route plausibility signals, and a manager-review status for anomalies such as mocked locations, weak accuracy, impossible speed, or stale captures.

Customer and attendance photos should be resized on-device, uploaded through a short-lived single-purpose upload permission, validated for MIME type and file size, scanned according to organizational policy, and retained only as long as compliance policy requires. Production tracking must show ongoing Android foreground-service notification and be switchable off by the employee where permitted by company policy.

## Secrets to Configure at Deployment

The production environment will need a Cloud SQL connection or connector configuration, a strong server-side token-signing secret, OTP provider credentials, a cloud storage service identity, Firebase credentials, and restricted Google Maps key(s). Do not embed any of these values in the Android bundle or commit them to source control.
