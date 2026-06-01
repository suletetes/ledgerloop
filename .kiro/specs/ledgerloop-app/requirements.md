# Requirements Document

## Introduction

LedgerLoop is a multi-region group expense ledger (a Splitwise-style application) where shared balances stay correct even when group members in different regions edit at the same instant. Members create or join groups, record shared expenses split equally, by percentage, or by exact amount, view who owes whom, simplify tangled debts into the minimum number of payments, and record settlements when debts are paid back. The Minimum Viable Product (MVP) tracks and simplifies debt but does not move real money.

The system is a layered serverless monolith: a Next.js App Router frontend and API layer on Vercel, a Ledger Service that owns all domain logic and writes, and a single Aurora DSQL database. The ledger is append-only (expenses, expense splits, and settlements are immutable inserts), and balances are always derived from that ledger rather than stored as mutable truth. Correctness rests on a set of invariants: each expense's splits sum exactly to the expense amount, every group's member balances sum to zero, no concurrent edit is double-counted, money is stored as integer minor units, settlements cannot exceed what is owed, and referential integrity is enforced in the application layer because Aurora DSQL has no foreign keys.

This document covers the three core MVP features (expense splitting, debt simplification, settlement recording) plus group creation and joining, balance viewing, and multi-currency display. It also captures a deep user-experience foundation (personas, key journeys, usability, accessibility, responsive and mobile-first behavior, and performance), the frontend stack expectations, and the correctness, authorization, and data-minimization requirements tied to the architecture's invariants.

This requirements set deliberately stays solution-free where possible; concrete data models, algorithms, and connection details belong in the design document and are already drafted in `LEDGERLOOP_ARCHITECTURE.md`.

## Glossary

- **LedgerLoop**: The complete application, including frontend, API layer, Ledger Service, and database. Used when a requirement applies to the system as a whole.
- **Web_UI**: The Next.js App Router frontend (Server Components, Client Components, and route handlers / server actions) that members interact with through a browser.
- **Ledger_Service**: The domain-logic component that owns all writes to the ledger and all balance derivation. All financial mutations pass through this component.
- **Split_Calculator**: The Ledger_Service sub-component that computes per-member shares for an expense from a split type and inputs, including deterministic remainder distribution.
- **Balance_Engine**: The Ledger_Service sub-component that derives each member's net position in a group from the append-only ledger.
- **Debt_Simplifier**: The Ledger_Service sub-component that computes a minimum-payment transfer plan from derived net balances.
- **Settlement_Validator**: The Ledger_Service sub-component that validates a settlement before it is recorded.
- **Currency_Display**: The component that converts stored amounts to a viewer's preferred currency at read time for display.
- **Auth_Guard**: The authorization component that confirms a caller is a member of a group before any group-scoped read or write proceeds.
- **Persistence**: The Aurora DSQL database and the data-access module that reads from and writes to it.
- **Member**: A registered user who belongs to one or more groups. The actor for most requirements.
- **Group**: A named container that holds members and a shared ledger, with a base currency.
- **Membership**: The relationship recording that a member belongs to a group.
- **Expense**: An immutable record that a member paid an amount in a currency on behalf of a group, with a description and a split type.
- **Expense_Split**: An immutable record of one member's share of one expense, in minor units.
- **Settlement**: An immutable record that one member paid another member an amount to reduce a debt.
- **Balance**: A member's derived net position in a group, where a positive value means the member is owed money (creditor) and a negative value means the member owes money (debtor). Balance is an output, never stored as truth.
- **Net_Position**: A synonym for Balance, expressed in minor units.
- **Simplified_Plan**: The set of transfers produced by the Debt_Simplifier that reduces a group's debts to the minimum number of payments.
- **Minor_Units**: The smallest indivisible unit of a currency (for example cents for USD, kobo for NGN), stored as a 64-bit integer.
- **Split_Type**: One of `equal`, `percent`, or `exact`, describing how an expense amount is divided among members.
- **Base_Currency**: The currency assigned to a group at creation, used as the reference currency for the group.
- **Currency_Preference**: A member's chosen display currency, expressed as an ISO-4217 three-letter code.
- **FX_Rate**: A cached foreign-exchange rate used to convert a stored currency to a display currency.
- **OCC_Conflict**: A write-write conflict surfaced by Aurora DSQL as `SQLSTATE 40001` under snapshot isolation with optimistic concurrency control.
- **OCC_Retry**: The Ledger_Service behavior of re-attempting an aborted transaction against fresh state after an OCC_Conflict.
- **INV-1 through INV-6**: The six correctness invariants defined in the architecture document, referenced throughout these requirements.
- **WCAG 2.1 AA**: The Web Content Accessibility Guidelines version 2.1, conformance level AA.
- **Core_Web_Vitals**: Google's user-centric performance metrics: Largest Contentful Paint (LCP), Interaction to Next Paint (INP), and Cumulative Layout Shift (CLS).
- **PII**: Personally Identifiable Information.

## User Personas

These research-backed personas frame the user-experience requirements. Confidence is "directional" for the MVP because they are derived from the Splitwise problem space and the architecture's stated audience (group members across Lagos, London, and Toronto) rather than from primary interviews; they are flagged for validation through usability testing.

- **Persona A — Tobi, the Trip Organizer (primary).** Coordinates a multi-person trip, pays for many shared costs up front, and needs to record expenses fast on mobile, often offline-ish on poor connections, and trust that everyone sees the same balances. Goals: add an expense in under a minute, see who owes what, and get a short list of who pays whom at the end. Frustrations: fiddly split entry, balances that look wrong, currency confusion across countries.
- **Persona B — Maria, the Casual Settler (primary).** Belongs to one or two groups, opens the app occasionally to check what she owes and to mark that she has paid someone back. Goals: glance at her own balance, settle up with minimal steps. Frustrations: cluttered screens, jargon, uncertainty about whether a payment was recorded.
- **Persona C — Dapo, the Multi-Currency Member (secondary).** Lives in a different country from the rest of the group and thinks in a different currency. Goals: see amounts in his own currency without doing mental math, while trusting the original amount is preserved. Frustrations: apps that hide the original currency or convert opaquely.
- **Persona D — Ada, the Accessibility-Reliant Member (cross-cutting).** Uses a screen reader and keyboard navigation. Goals: complete every core task (join, add expense, view balances, settle) without a mouse and with clear announcements. Frustrations: unlabeled controls, focus traps, color-only status cues.

## Requirements

### Requirement 1: Member Account and Identity

**User Story:** As a new user, I want to create an account with minimal personal information, so that I can join groups and track shared expenses without exposing sensitive data.

#### Acceptance Criteria

1. WHEN a user submits a registration with a display name of 1 to 100 characters after leading and trailing whitespace is trimmed and an email address of at most 254 characters in valid email format, THE LedgerLoop SHALL create a Member record and SHALL associate a Currency_Preference defaulted to the deterministic default code USD.
2. THE LedgerLoop SHALL store only display name, email address, home region, and Currency_Preference for each Member.
3. IF a registration submission omits the display name, provides a display name that is empty or consists only of whitespace after trimming, or provides a display name longer than 100 characters, THEN THE LedgerLoop SHALL reject the registration, SHALL NOT create a Member record, and SHALL return a message identifying the display-name field as the cause.
4. IF a registration submission omits the email address, provides an email address longer than 254 characters, or provides an email address that does not conform to the email format, THEN THE LedgerLoop SHALL reject the registration, SHALL NOT create a Member record, and SHALL return a validation message identifying the email field as the cause.
5. WHEN a Member updates the Currency_Preference to a valid ISO-4217 three-letter code, THE LedgerLoop SHALL persist the updated Currency_Preference.
6. THE LedgerLoop SHALL identify each Member by an application-generated unique identifier.
7. IF a Member submits a Currency_Preference update with a value that is not a valid ISO-4217 three-letter code, THEN THE LedgerLoop SHALL reject the update, SHALL leave the existing Currency_Preference unchanged, and SHALL return a validation message indicating that the supplied code is invalid.

### Requirement 2: Authentication and Session

**User Story:** As a Member, I want to sign in securely, so that only I can act on my behalf in my groups.

#### Acceptance Criteria

1. WHEN a registered Member submits valid credentials, THE LedgerLoop SHALL establish an authenticated session for that Member.
2. IF a sign-in submission presents credentials that do not match a registered Member, THEN THE LedgerLoop SHALL reject the sign-in and return an authentication-failure message that does not reveal whether the email address exists.
3. WHILE a Member's session is not actively established (including a session that has expired or been terminated without an explicit sign-out), THE LedgerLoop SHALL restrict access to group-scoped screens and actions and SHALL redirect the request to the sign-in screen.
4. WHEN an authenticated Member signs out, THE LedgerLoop SHALL terminate the session and SHALL require re-authentication for subsequent group-scoped actions.

### Requirement 3: Group Creation

**User Story:** As a Member, I want to create a group with a name and a base currency, so that I can start tracking shared expenses with others.

#### Acceptance Criteria

1. WHEN an authenticated Member submits a group name and a Base_Currency, THE Ledger_Service SHALL create a Group and SHALL record the creating Member as a Membership of that Group.
2. THE Ledger_Service SHALL require the Base_Currency to be a valid ISO-4217 three-letter code.
3. IF a group-creation submission omits the group name, THEN THE Ledger_Service SHALL reject the submission and return a message identifying the missing field.
4. WHEN a Group is created, THE Ledger_Service SHALL assign the Group an application-generated unique identifier.
5. WHEN a Group is created, THE Web_UI SHALL present the creating Member with a means to invite or add other members to the Group.

### Requirement 4: Group Joining and Membership

**User Story:** As a Member, I want to join an existing group, so that my shared expenses are tracked together with the rest of the group.

#### Acceptance Criteria

1. WHEN an authenticated Member accepts a valid invitation to a Group, THE Ledger_Service SHALL create a Membership linking that Member to that Group.
2. IF a Member who is already a Membership of a Group attempts to join the same Group again, THEN THE Ledger_Service SHALL reject the duplicate join and SHALL leave the existing single Membership unchanged.
3. IF a join request references a Group that does not exist, THEN THE Ledger_Service SHALL reject the request and return a not-found message.
4. WHEN a Member joins a Group, THE Web_UI SHALL display the Group in that Member's list of groups.
5. THE Ledger_Service SHALL record the timestamp at which each Membership is created.

### Requirement 5: Group Membership Authorization

**User Story:** As a Member, I want group data and actions restricted to group members, so that no one outside my group can read or change our shared ledger.

#### Acceptance Criteria

1. WHEN any group-scoped read or write is requested, THE Auth_Guard SHALL confirm that the requesting Member holds a Membership in the target Group before the operation proceeds, and IF that Membership is absent, THEN THE Auth_Guard SHALL explicitly block the operation.
2. IF the requesting Member does not hold a Membership in the target Group, THEN THE Auth_Guard SHALL deny the operation and return an authorization-failure response without disclosing the Group's contents.
3. WHEN an expense is recorded, THE Auth_Guard SHALL confirm that the paying Member holds a Membership in the target Group before the expense is written, and IF the paying Member lacks that Membership, THEN THE Auth_Guard SHALL block the expense so that it is not written.
4. WHEN a settlement is recorded, THE Auth_Guard SHALL confirm that both the paying Member and the receiving Member hold a Membership in the target Group before the settlement is written, and IF either Member lacks that Membership, THEN THE Auth_Guard SHALL explicitly prevent the settlement from being written.
5. WHERE an expense assigns a share to a Member, THE Auth_Guard SHALL confirm that the assigned Member holds a Membership in the target Group before the expense is written, and IF any assigned Member lacks that Membership, THEN THE Auth_Guard SHALL block the entire expense operation so that no Expense and no Expense_Split is written.

### Requirement 6: Record an Expense with a Split

**User Story:** As a Member, I want to record an expense and split it among group members, so that the group ledger reflects what was paid and who owes a share.

#### Acceptance Criteria

1. WHEN a Member submits an expense with a Group, a paying Member, an amount in Minor_Units, a currency, a description, a Split_Type, and the set of members sharing the expense, THE Ledger_Service SHALL record one Expense and its Expense_Split records in a single atomic transaction.
2. THE Ledger_Service SHALL require the expense amount to be a positive integer in Minor_Units between 1 and 9,223,372,036,854,775,807 inclusive.
3. THE Ledger_Service SHALL require the expense currency to be a valid ISO-4217 three-letter code.
4. IF an expense submission omits the amount, the currency, the description, the Split_Type, or the set of sharing members, supplies an empty set of sharing members, or supplies a description that is empty, contains only whitespace, or exceeds 500 characters, THEN THE Ledger_Service SHALL reject the submission and return a message identifying the offending field.
5. WHEN an expense submission provides all required fields and is otherwise valid, THE Ledger_Service SHALL accept the submission without returning a missing-field message.
6. WHEN an Expense and its Expense_Split records are recorded, THE Ledger_Service SHALL treat the Expense and its Expense_Split records as immutable.
7. IF a Member requests a correction to a recorded Expense, THEN THE Ledger_Service SHALL record the correction as a new reversing Expense rather than modifying the original Expense.
8. WHEN an Expense is recorded, THE Ledger_Service SHALL assign the Expense an application-generated unique identifier.
9. IF an expense submission supplies an amount that is not a positive integer in Minor_Units or that exceeds 9,223,372,036,854,775,807, THEN THE Ledger_Service SHALL reject the submission and return a validation message identifying the amount as invalid.
10. IF an expense submission supplies a currency that is not a valid ISO-4217 three-letter code, THEN THE Ledger_Service SHALL reject the submission and return a validation message identifying the currency as invalid.
11. IF recording an Expense and its Expense_Split records cannot complete as a single atomic transaction, THEN THE Ledger_Service SHALL persist neither the Expense nor any of its Expense_Split records and SHALL return an error indicating that the expense was not recorded.

### Requirement 7: Split Calculation and Sum Invariant (INV-1)

**User Story:** As a Member, I want each expense's shares to add up exactly to the expense amount, so that the ledger is always internally consistent.

#### Acceptance Criteria

1. WHEN the Split_Type is `equal` and the set of sharing members is non-empty, THE Split_Calculator SHALL divide the expense amount across the sharing members so that the sum of the Expense_Split shares equals the expense amount exactly.
2. WHERE an equal split does not divide evenly into Minor_Units, THE Split_Calculator SHALL distribute the remaining Minor_Units across the sharing members such that the sum of shares equals the expense amount exactly, no two members' shares differ by more than one Minor_Unit, and identical inputs (the same amount, currency, and ordered set of members) always yield identical per-member shares.
3. WHEN the Split_Type is `percent`, THE Split_Calculator SHALL compute each member's share from the supplied percentages and SHALL assign any rounding drift so that the sum of shares equals the expense amount exactly.
4. IF the Split_Type is `percent` and the supplied percentages do not sum to 100 percent, THEN THE Ledger_Service SHALL reject the expense, SHALL record no Expense and no Expense_Split so that the ledger is left unchanged, and SHALL return a validation message.
5. WHEN the Split_Type is `exact` and the supplied exact shares sum to the expense amount, THE Ledger_Service SHALL accept the shares and record the Expense.
6. IF the Split_Type is `exact` and the supplied exact shares do not sum to the expense amount, THEN THE Ledger_Service SHALL reject the expense, SHALL record no Expense and no Expense_Split so that the ledger is left unchanged, and SHALL return a validation message.
7. IF the set of sharing members for an expense is empty, THEN THE Ledger_Service SHALL reject the expense, SHALL record no Expense and no Expense_Split so that the ledger is left unchanged, and SHALL return a validation message requiring at least one sharing member.
8. THE Split_Calculator SHALL produce each Expense_Split share as a non-negative integer in Minor_Units.
9. FOR ALL recorded Expenses, THE Ledger_Service SHALL maintain the property that the sum of an Expense's Expense_Split shares equals that Expense's amount (INV-1).

### Requirement 8: Record a Settlement

**User Story:** As a Member, I want to record that I paid someone back, so that the ledger reflects the reduced debt between us.

#### Acceptance Criteria

1. WHEN a Member submits a Settlement with a Group, a paying Member, a receiving Member, an amount in Minor_Units, and a currency, THE Ledger_Service SHALL record one immutable Settlement.
2. THE Ledger_Service SHALL require the Settlement amount to be a positive integer in Minor_Units.
3. THE Ledger_Service SHALL require the Settlement currency to be a valid ISO-4217 three-letter code.
4. IF a Settlement submission provides an amount that is not a positive integer in Minor_Units, or a currency that is not a valid ISO-4217 three-letter code, THEN THE Ledger_Service SHALL reject the Settlement, return a validation message identifying the invalid field, and SHALL leave the Group's ledger unchanged.
5. IF a Settlement submission omits the Group, the paying Member, the receiving Member, the amount, or the currency, THEN THE Ledger_Service SHALL reject the Settlement, return a message identifying the missing field, and SHALL leave the Group's ledger unchanged.
6. THE Settlement_Validator SHALL require that the Settlement amount does not exceed the amount the paying Member currently owes the receiving Member, where the amount owed is derived from the Group's append-only ledger of Expenses, Expense_Splits, and Settlements (INV-5).
7. IF a Settlement amount exceeds the amount currently owed as derived from the Group's append-only ledger, THEN THE Settlement_Validator SHALL reject the Settlement, return a message stating the maximum amount that can be settled, and SHALL leave the Group's ledger unchanged.
8. IF a Settlement names the same Member as both payer and receiver, THEN THE Ledger_Service SHALL reject the Settlement, return a validation message, and SHALL leave the Group's ledger unchanged.
9. WHEN a Settlement is recorded, THE Ledger_Service SHALL assign the Settlement an application-generated unique identifier and SHALL record its creation timestamp.

### Requirement 9: Balance Derivation and Zero-Sum Invariant (INV-2)

**User Story:** As a Member, I want to see who owes whom in my group, so that I understand my current position at a glance.

#### Acceptance Criteria

1. WHEN a Member views a Group's balances, THE Balance_Engine SHALL derive each member's Net_Position from the Group's Expenses, Expense_Splits, and Settlements rather than from any stored balance value.
2. THE Balance_Engine SHALL compute each Member's Net_Position in a Group, expressed in Minor_Units, as the sum of amounts the Member paid for that Group's Expenses, minus the sum of the Member's Expense_Split shares in that Group, plus the sum of Settlements the Member sent within that Group, minus the sum of Settlements the Member received within that Group.
3. FOR ALL Groups, THE Balance_Engine SHALL maintain the property that the integer sum of all members' Net_Positions in the Group equals exactly zero (INV-2).
4. WHEN a Member records a Settlement of a given amount to another Member within a Group, THE Balance_Engine SHALL increase the paying Member's derived Net_Position by that Settlement amount and SHALL decrease the receiving Member's derived Net_Position by that Settlement amount.
5. WHEN a Member views a Group's balances, THE Web_UI SHALL indicate for each member whether that member is a creditor who is owed money or a debtor who owes money using a text or symbolic indicator that does not rely on color alone.
6. WHEN an Expense or a Settlement is recorded in a Group that the Member is currently viewing, THE Web_UI SHALL present the updated Net_Positions for that Group within 2 seconds of the record being committed and without requiring the Member to manually reload the application.
7. WHILE a Group has no recorded Expenses and no recorded Settlements, THE Balance_Engine SHALL derive a Net_Position of zero in Minor_Units for every member of that Group.

### Requirement 10: Debt Simplification (Simplified_Plan)

**User Story:** As a Trip Organizer, I want the group's tangled debts reduced to the fewest payments, so that everyone settles up with the least effort.

#### Acceptance Criteria

1. WHEN a Member requests debt simplification for a Group, THE Debt_Simplifier SHALL compute a Simplified_Plan of transfers from the Group's derived Net_Positions.
2. THE Debt_Simplifier SHALL produce a Simplified_Plan in which the sum of transfers received minus transfers sent for each Member equals that Member's Net_Position.
3. THE Debt_Simplifier SHALL produce a Simplified_Plan containing at most one fewer transfer than the number of members holding a non-zero Net_Position.
4. WHILE every Member in a Group holds a Net_Position of zero, THE Debt_Simplifier SHALL produce an empty Simplified_Plan.
5. WHEN a Member views the Simplified_Plan, THE Web_UI SHALL present each transfer as the paying Member, the receiving Member, and the transfer amount, with the transfer amount shown in the viewing Member's Currency_Preference.
6. THE Debt_Simplifier SHALL compute the Simplified_Plan on the read path without acquiring locks on or writing to the ledger.
7. THE Debt_Simplifier SHALL produce each transfer in the Simplified_Plan as a positive integer amount in Minor_Units from one paying Member to a distinct receiving Member.
8. WHERE no FX_Rate is available for a transfer's currency and the viewing Member's Currency_Preference, THE Web_UI SHALL display the transfer's original currency and amount and SHALL indicate that conversion is unavailable.

### Requirement 11: Concurrency Correctness (INV-3)

**User Story:** As a Member, I want simultaneous edits from people in different regions to never corrupt our balances, so that I can trust the ledger under real-world use.

#### Acceptance Criteria

1. WHEN two writes to the same Group conflict under Persistence's snapshot isolation, THE Persistence SHALL abort one write with an OCC_Conflict rather than allow a lost update.
2. WHEN a write fails with an OCC_Conflict, THE Ledger_Service SHALL retry the write against fresh state up to a bounded number of attempts (OCC_Retry).
3. WHILE retrying after an OCC_Conflict, THE Ledger_Service SHALL apply a bounded backoff between attempts.
4. IF the bounded retry attempts are exhausted, THEN THE Ledger_Service SHALL return an error to the Web_UI indicating that the operation could not be completed and SHALL leave the ledger unchanged for that operation.
5. FOR ALL concurrent writes to a Group, THE Ledger_Service SHALL ensure that no Expense and no Settlement is counted more than once in derived balances (INV-3).
6. WHEN an OCC_Retry succeeds after one or more conflicts, THE Web_UI SHALL present the same successful outcome as for a write that committed on the first attempt.

### Requirement 12: Money Representation (INV-4)

**User Story:** As a Member, I want monetary amounts to be exact, so that rounding never makes my balance wrong.

#### Acceptance Criteria

1. THE LedgerLoop SHALL represent every monetary amount as an integer in Minor_Units (INV-4).
2. THE LedgerLoop SHALL NOT represent any stored or computed monetary amount, including zero amounts, as a floating-point number.
3. WHEN the Web_UI displays a monetary amount, THE Web_UI SHALL format the integer Minor_Units into the correct major and minor unit presentation for the displayed currency.
4. WHEN a Member enters a monetary amount in the Web_UI, THE Web_UI SHALL convert the entered value into integer Minor_Units before submission to the Ledger_Service.

### Requirement 13: Referential Integrity in the Application Layer (INV-6)

**User Story:** As a Member, I want every ledger record to reference real groups and members, so that the data stays trustworthy even though the database enforces no foreign keys.

#### Acceptance Criteria

1. WHEN an Expense is recorded, THE Ledger_Service SHALL confirm that the referenced Group exists and that the paying Member and every member assigned an Expense_Split hold a Membership in that Group before the write proceeds (INV-6).
2. WHEN a Settlement is recorded, THE Ledger_Service SHALL confirm that the referenced Group exists and that the paying and receiving members hold a Membership in that Group before the write proceeds.
3. IF a ledger write references a Group, Member, or Membership that does not exist, THEN THE Ledger_Service SHALL reject the write and return a referential-integrity error.
4. THE Ledger_Service SHALL prevent the creation of duplicate Membership records for the same Member and Group pair.

### Requirement 14: Multi-Currency Display

**User Story:** As a Multi-Currency Member, I want to see amounts in my own currency while the original is preserved, so that I understand my position without losing the source of truth.

#### Acceptance Criteria

1. WHEN an Expense is recorded, THE Ledger_Service SHALL store the Expense in its original currency and original Minor_Units without converting the amount at write time.
2. WHEN a Member views amounts, THE Currency_Display SHALL convert each stored amount to the viewing Member's Currency_Preference using a cached FX_Rate at read time.
3. WHEN the Currency_Display presents a converted amount, THE Web_UI SHALL also make the original currency and original amount available to the Member.
4. WHERE no FX_Rate is available for a stored currency and a Member's Currency_Preference, THE Web_UI SHALL display the original currency and amount and SHALL indicate that conversion is unavailable.
5. THE Currency_Display SHALL NOT alter any stored Expense, Expense_Split, or Settlement amount when performing display conversion.

### Requirement 15: Add-Expense User Journey and Usability

**User Story:** As a Trip Organizer, I want to add and split an expense quickly on my phone, so that I can keep the ledger current in the moment.

#### Acceptance Criteria

1. WHEN a Member opens the add-expense flow, THE Web_UI SHALL present amount, currency, description, payer, Split_Type, and participant selection within a single primary flow.
2. WHEN a Member selects the `equal` Split_Type, THE Web_UI SHALL display each participant's computed share before the Member submits the Expense.
3. WHEN a Member selects the `percent` or `exact` Split_Type, THE Web_UI SHALL display a running total of entered shares against the expense amount and SHALL indicate whether the shares currently reconcile to the amount.
4. IF a Member attempts to submit an Expense whose shares do not reconcile to the amount, THEN THE Web_UI SHALL block submission and SHALL present the difference that must be resolved.
5. WHEN a Member submits a valid Expense, THE Web_UI SHALL confirm the recorded Expense and SHALL return the Member to the Group view showing updated balances.
6. WHEN the Ledger_Service rejects an Expense, THE Web_UI SHALL preserve the Member's entered values and SHALL present the rejection reason next to the relevant field.

### Requirement 16: View-Balances and Settle-Up User Journeys

**User Story:** As a Casual Settler, I want to glance at what I owe and mark a payment with minimal steps, so that settling up is effortless.

#### Acceptance Criteria

1. WHEN a Member opens a Group, THE Web_UI SHALL present that Member's own Net_Position prominently before other members' positions.
2. WHEN a Member views a Group's balances, THE Web_UI SHALL present who owes whom in a form readable without financial expertise.
3. WHEN a Member initiates a settle-up from a displayed debt, THE Web_UI SHALL pre-fill the settle-up form with the payer, receiver, and the amount owed.
4. WHEN a Member confirms a settle-up, THE Web_UI SHALL present a confirmation of the recorded Settlement and the resulting balances.
5. WHERE a Member has no non-zero Net_Position in a Group, THE Web_UI SHALL present a settled-up state for that Member.

### Requirement 17: Accessibility (WCAG 2.1 AA)

**User Story:** As an Accessibility-Reliant Member, I want to complete every core task with a keyboard and a screen reader, so that the application is usable regardless of ability.

#### Acceptance Criteria

1. THE Web_UI SHALL conform to WCAG 2.1 AA success criteria for all core flows: registration, sign-in, group creation, group joining, adding an expense, viewing balances, simplifying debts, and recording a settlement.
2. THE Web_UI SHALL provide text and non-text contrast ratios that meet WCAG 2.1 AA minimums of 4.5:1 for normal text and 3:1 for large text and user-interface components.
3. WHEN a Member navigates using only a keyboard, THE Web_UI SHALL make every interactive control reachable and operable and SHALL present a visible focus indicator on the focused control.
4. THE Web_UI SHALL associate every form control with a programmatically determinable label.
5. WHEN form validation fails, THE Web_UI SHALL convey each error through text that is programmatically associated with the relevant control and not through color alone.
6. WHEN balances or the Simplified_Plan update without a full reload, THE Web_UI SHALL announce the update to assistive technologies.
7. THE Web_UI SHALL provide a mechanism to bypass repeated blocks of content so that keyboard and screen-reader users can reach the main content directly.

### Requirement 18: Responsive and Mobile-First Layout

**User Story:** As a Trip Organizer, I want the app to work well on my phone first, so that I can use it wherever expenses happen.

#### Acceptance Criteria

1. THE Web_UI SHALL render all core flows usably at a viewport width of 320 pixels and progressively enhance the layout for tablet and desktop widths.
2. THE Web_UI SHALL provide interactive touch targets of at least 44 by 44 pixels in the core flows.
3. WHEN the viewport width changes across the defined breakpoints, THE Web_UI SHALL reflow content without horizontal scrolling of any content, including secondary elements such as sidebars and toolbars, and without loss of information or functionality.
4. WHEN a Member uses the Web_UI on a touch device, THE Web_UI SHALL support the core flows without requiring hover-only interactions.

### Requirement 19: Frontend Stack and Component Foundation

**User Story:** As the engineering team, I want a modern, accessible, type-safe frontend foundation, so that the product is fast to build, consistent, and maintainable.

#### Acceptance Criteria

1. THE Web_UI SHALL be implemented with Next.js using the App Router.
2. THE Web_UI SHALL be implemented in TypeScript with type checking enforced in the build.
3. THE Web_UI SHALL apply styling through Tailwind CSS using a shared design-token configuration for color, typography, and spacing.
4. THE Web_UI SHALL compose its interface from an accessible component foundation whose interactive components implement keyboard and assistive-technology support by default.
5. WHERE initial content can be rendered on the server, THE Web_UI SHALL use Server Components for that initial render and reserve Client Components for interactive behavior.
6. THE Web_UI SHALL route all financial mutations through the API layer to the Ledger_Service and SHALL NOT write to Persistence directly from the browser.

### Requirement 20: Performance and Core Web Vitals

**User Story:** As a Member, I want the app to feel fast and stable, so that recording and checking expenses is frictionless.

#### Acceptance Criteria

1. WHEN the Group dashboard loads on a representative mobile profile, THE Web_UI SHALL achieve a Largest Contentful Paint of at most 2.5 seconds at the 75th percentile.
2. WHEN a Member interacts with a control, THE Web_UI SHALL achieve an Interaction to Next Paint of at most 200 milliseconds at the 75th percentile.
3. THE Web_UI SHALL maintain a Cumulative Layout Shift of at most 0.1 at the 75th percentile across the core flows.
4. WHEN a Member submits an Expense or a Settlement under normal (non-conflicting) conditions, THE Web_UI SHALL present the confirmed result within 2 seconds at the 75th percentile.
5. WHILE a submitted operation is in progress, THE Web_UI SHALL present a progress indication and SHALL prevent duplicate submission of the same operation.

### Requirement 21: Data Minimization and PII Handling

**User Story:** As a privacy-conscious Member, I want the app to collect as little personal data as possible, so that my exposure stays small.

#### Acceptance Criteria

1. THE LedgerLoop SHALL NOT collect or store payment card data, bank account data, or other financial-account credentials in the MVP.
2. THE LedgerLoop SHALL limit stored Member data to a Member's display name, email address, and home region, and SHALL NOT store any other Member-related data beyond these three fields.
3. WHEN LedgerLoop logs operational events, THE LedgerLoop SHALL exclude email addresses and other PII from log entries.
4. WHERE an error or diagnostic message is presented to a Member, THE Web_UI SHALL exclude another Member's email address from that message.

### Requirement 22: Error Handling and Resilience

**User Story:** As a Member, I want clear feedback when something goes wrong, so that I know whether my action took effect and what to do next.

#### Acceptance Criteria

1. IF a ledger write fails for a reason other than an OCC_Conflict, THEN THE Ledger_Service SHALL leave the ledger unchanged for that operation and SHALL return an error describing the failure category.
2. WHEN the Ledger_Service returns an error, THE Web_UI SHALL present an actionable message and SHALL indicate whether the operation took effect.
3. IF Persistence is unavailable, THEN THE Web_UI SHALL present an unavailability state and SHALL allow the Member to retry without losing entered data.
4. WHEN a validation error occurs, THE Web_UI SHALL present the error without discarding the Member's in-progress input.
5. WHEN an operation completes successfully, THE Web_UI MAY clear the Member's input for that operation.
