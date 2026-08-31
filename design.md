# FieldPulse Attendance — Mobile Design Plan

## Product Intent

FieldPulse Attendance is an Android-first field workforce application for employees who need to prove attendance and customer visits reliably while working in the field. The experience is designed for **portrait, one-handed use**, with the most frequent actions—checking in, starting a route, completing a visit, and viewing the next task—reachable from the lower half of the screen.

The visual language uses a **bright field-operations palette**: cool white surfaces, mist-blue background layers, restrained slate text, and an electric-teal action color. The visual direction is inspired by the supplied FieldSense navigation reference without duplicating its brand: compact icon-and-label navigation, cool blue-gray inactive controls, and a crisp teal active state. Motion remains functional rather than decorative: cards gently lift on touch, the attendance status ring responds to check-in progress, and success states use short haptic-confirmed animations.

## Screen List

| Screen | Primary content and functionality |
| --- | --- |
| Welcome and sign-in | Mobile number or email entry, password option, OTP request and verification, device-trust notice, and role-aware routing. |
| Home dashboard | Today’s attendance state, next customer visit, pending task count, travel distance, expense summary, notifications, and a prominent check-in or check-out action. |
| Attendance capture | GPS accuracy and geofence status, live timestamp, required selfie/photo capture, check-in/check-out confirmation, and reason capture for an exception. |
| Attendance history | Daily and monthly list of attendance records, verified status, late/early labels, photo thumbnail, location accuracy, and sync state. |
| Live tracking | Start/stop toggle, consent state, current coordinates, distance travelled, route timeline, battery-conscious sampling state, and last sync time. |
| Visit planner | Today, upcoming, and completed visits grouped by time; each item shows the customer, route distance, appointment state, and required actions. |
| Visit completion | Customer-location verification, check-in/check-out, meeting outcome, follow-up date, notes, custom form fields, and photo/document attachments. |
| Customer directory | Searchable customer list, customer contact profile, address, map pin, previous visits, and create-customer flow with location selection. |
| Customer detail | Phone, address, map location, visit history, related tasks, navigation shortcut, and customer feedback. |
| Activity and reports | Meeting summaries, submitted feedback, pending follow-ups, completed forms, photo evidence, and date-based filtering. |
| Team chat | Direct manager conversation, assigned-team group, attachment capability, delivery/sync state, and message notifications. |
| Notifications | Attendance reminders, assigned visits, chat alerts, sync errors, policy reminders, and status updates. |
| Profile and security | Identity details, role, biometric re-authentication setting, trusted-device list, privacy/permission explanation, and logout. |
| Offline queue | Plain-language list of pending attendance, visits, forms, messages, and media uploads; retry state and conflict resolution notice. |

## Key User Flows

| Flow | Steps |
| --- | --- |
| OTP sign-in | Employee enters a mobile number or email → requests a one-time code → enters the code → server validates the code, device, and rate limit → secure session is stored on the device → role-based dashboard opens. |
| Photo-verified check-in | Employee opens the dashboard → taps **Check in** → app checks location permission, GPS accuracy, and configured geofence → employee captures a photo → evidence is timestamped and added to the encrypted local sync queue → a confirmation state is shown and server sync occurs when available. |
| Customer visit | Employee opens Today’s visits → chooses a customer → launches navigation → checks in at the customer location → completes notes, meeting outcome, follow-up, and attachments → checks out → visit record is saved locally and synchronized. |
| Offline work | Device loses connectivity → employee continues check-ins, visits, forms, and photos → records receive ordered queue IDs and immutable client timestamps → connectivity returns → app sends records idempotently → server returns accepted/conflict status → employee receives a clear status update. |
| Manager communication | Employee opens Team chat → sends message or attachment → message is queued if offline → server delivers to manager/channel when online → recipient notification and delivery status update are shown. |

## Navigation and Interaction Model

The bottom navigation contains **Home**, **Visits**, **Track**, **Reports**, and **Profile**. It is a floating, rounded **liquid-glass** capsule that uses approximately **88%** of the mobile screen width rather than spanning edge to edge. The material combines translucent white blur, a fine inner highlight, and a soft suspended shadow. The selected item receives a compact teal-tinted inner capsule that scales and fades in over 220 ms, while inactive compact icon-and-label pairs remain cool blue-gray. Attendance is a high-emphasis contextual action on the Home tab, avoiding a permanently elevated central button that could obstruct one-handed use. Long forms open as focused full-height screens or sheets with persistent save/submit controls above the Android navigation area. Destructive actions require confirmation and every networked mutation shows a local pending, synced, or retryable state.

## Brand and Color Choices

| Token | Value | Usage |
| --- | --- | --- |
| Operations ink | `#17354A` | Headline and primary information text. |
| Signal teal | `#13C5B8` | Primary actions, verified states, and active navigation. |
| Cloud background | `#F3F8FA` | App canvas and low-contrast background layer. |
| Pure surface | `#FFFFFF` | Cards, forms, and liquid-glass base material. |
| Mist border | `#E1EBF0` | Card boundaries and input separation. |
| Verified green | `#22B573` | Confirmed attendance and completed visits. |
| Alert amber | `#E5A23A` | Late/early flags and attention items. |
| Incident red | `#DD5B67` | Failed verification, errors, and destructive actions. |

## Data and Synchronization Model

The mobile client is **local-first**. Attendance actions, visit updates, forms, messages, and media metadata are stored on the device with a stable local operation ID before the user sees success. A sync coordinator transmits operations in order when a verified connection is available. The server accepts idempotency keys so a retry cannot create duplicate attendance or visit records. Server time remains authoritative for compliance while the client timestamp, GPS accuracy, and device metadata are preserved for audit investigation.

Photo files are staged locally, stripped of unnecessary metadata where policy permits, uploaded over TLS through short-lived upload permissions, and linked to the signed attendance or visit event only after the server confirms receipt. Customer information and user-visible chat content must never be embedded in application logs or analytics events.

## Cloud SQL-Ready Architecture

The requested Cloud SQL database will be treated as the authoritative operational store. The Android app will never connect directly to Cloud SQL. Instead, a server API validates authenticated requests, validates ownership and role permissions, signs limited media-upload operations, and performs parameterized database queries using a private or tightly restricted Cloud SQL connection.

| Approach | Trade-offs | Cost | Setup complexity |
| --- | --- | --- | --- |
| Dedicated API service with Google Cloud SQL | Best separation between mobile clients and data, supports custom OTP vendor, Cloud Storage media, role controls, audit events, and scalable real-time features. Requires Cloud Run/API hosting and initial cloud configuration. | Cloud charges depend on database size, runtime, egress, storage, and OTP messages. | Moderate to high. |
| Managed application backend connected to Cloud SQL | Faster prototype delivery with type-safe APIs, while preserving a future connection to Cloud SQL through server configuration. Some cloud-networking and provider features need later configuration. | Lower prototype setup cost; Cloud SQL and OTP charges still apply once connected. | Low to moderate. |

The application foundation will use the second option initially so functionality can be built and tested before cloud credentials exist. Before production use, the first option is the recommended target because it permits private database access, a dedicated OTP delivery integration, stricter audit controls, and predictable operational monitoring.

## Security Baseline

No mobile application can honestly guarantee that it “cannot be hacked.” FieldPulse will instead use layered controls that reduce common attack paths and provide evidence when misuse occurs. The production backend should enforce short-lived signed sessions, device-safe token storage, rate-limited OTP attempts, OTP expiry and single-use enforcement, password hashing with a modern adaptive algorithm, strict role and tenant checks on every request, Zod-based request validation, parameterized SQL, request-size limits, media type/size checks, TLS, secure headers, audit trails, server-authoritative timestamps, and idempotency keys.

On the device, session credentials belong in the platform keystore, not plain local storage. Offline operational records will be protected by platform encryption where supported, and sensitive views can require biometrics or device credentials after inactivity. GPS/photo validation is not treated as infallible: the API records accuracy, detects implausible routes or timestamps, enforces configured geofences, and flags anomalies for manager review rather than silently trusting client claims. Root/jailbreak indicators and device-integrity attestations can be added for higher-risk deployments, but they should be considered risk signals, not absolute proof.

## Production Integrations Required Later

| Integration | Purpose | Decision needed |
| --- | --- | --- |
| Cloud SQL for MySQL or PostgreSQL | Authoritative users, attendance, visits, customers, reports, messages, and audit data. | Select engine and region; provision private or restricted API access. |
| OTP provider | Sends verification codes over SMS or email. | Choose Firebase Authentication, Twilio Verify, MSG91, AWS SNS, or another regional provider. |
| Object storage | Stores attendance selfies, visit photos, and documents. | Choose Cloud Storage or compatible object storage; define retention policy. |
| Maps and navigation | Displays customer locations and opens route navigation. | Choose Google Maps Platform configuration and API-key restrictions. |
| Push notifications | Delivers visit, chat, and attendance reminders. | Configure Firebase Cloud Messaging for Android. |

## MVP Acceptance Criteria

The first usable release must let a field employee sign in through a demonstrable OTP flow, view a status-rich dashboard, record attendance with GPS evidence and a photo, view attendance history, manage customer visits, capture visit outcomes, and continue saving work when offline. It must clearly show sync state and protect session data. Production OTP delivery, Cloud SQL credentials, live background tracking, map keys, and production push notifications require the selected service credentials and cloud configuration.
