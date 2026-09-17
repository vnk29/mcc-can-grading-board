# Design & Implementation Notes

This document outlines the key UX trade-offs, edge cases handled, and future improvements for the Can Grading Board application.

## Key UX Trade-Offs

1. **Optimistic UI vs. Guaranteed Consistency**
   - **Trade-off**: The grading intake screen is designed for maximum speed. Operators process dozens of cans per hour, meaning blocking network requests would severely disrupt operations.
   - **Solution**: We implemented an aggressive "offline-first" architecture using IndexedDB (`idb-keyval`). Submissions are instantly acknowledged locally and queued for background synchronization, allowing the operator to immediately move to the next farmer without waiting for the network.
2. **Simplified Correction Workflow over Full "Dispute" Portal**
   - **Trade-off**: Rather than building a separate, complex dispute submission app for farmers and an admin resolution dashboard, we localized the dispute resolution flow to the physical booth. 
   - **Solution**: The Farmer can look up their batch using their phone (or operator's screen). The booth operator has an authenticated "Submit Correction" flow on the reference slip itself, allowing immediate, face-to-face resolution of incorrect volumes or contested fat/SNF readings.
3. **Implicit Authentication**
   - **Trade-off**: Managing sessions on shared devices in rural areas is error-prone. Operators often forget to log out, leading to misattributed audits.
   - **Solution**: Operators are required to input their PIN contextually when performing destructive/override actions (like overriding a rejection or submitting a correction), rather than maintaining a persistent authenticated session.

## Edge Cases Handled

- **Network Flakiness & Concurrent Syncs**: In rural areas, the network connection rapidly drops and reconnects. We implemented a serialized promise queue for the background sync process. This guarantees that concurrent triggers (e.g., coming back online while the user manually clicks "retry") don't result in race conditions or duplicate submissions.
- **Reference Code Stability**: If an operator enters invalid reading data, the application generates a local reference code. We ensured this reference code is stable across local form validations, so the farmer doesn't get confused by changing reference codes while the operator corrects typos in the intake form.
- **RPC Signature Mismatches & Data Integrity**: When corrections are made, the backend strictly relies on the server's existing row data (`old_values`) via an RPC call, rather than trusting the client to accurately report what the previous values were, preventing client-side forgery.
- **Zero-Volume Inputs**: Properly handling cases where volume defaults to `0` or is intentionally omitted, ensuring it is explicitly treated as missing data rather than a valid 0L can.

## Future Improvements

1. **Cryptographic PIN Storage**
   - **Current State**: Operator PINs are currently stored in plaintext and evaluated via a loosely timed comparison as this is a rapid prototype.
   - **Future**: Implement salted bcrypt/Argon2 hashing for PINs and constant-time string comparison for the RPC functions to prevent timing attacks.
2. **Dashboard & Analytics**
   - **Current State**: Focus has been strictly on the intake flow and operator-farmer dispute resolution.
   - **Future**: A separate protected route for center managers to view macro-level statistics: total liters collected, average fat content by village, and rejection rates by cause (water adulteration vs. low SNF).
3. **SMS Integration**
   - **Current State**: The farmer takes a photo of the screen or writes down the reference code.
   - **Future**: Integrate an SMS gateway (like Twilio or AWS SNS) to automatically text the farmer their reference code and slip URL the moment the can is graded. 
