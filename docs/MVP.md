# Cricket Manager MVP Specification

## Core rule

A confirmed match belongs on the player's schedule. Before a player accepts another invitation, the API must check whether the requested time interval overlaps an existing confirmed match.

Overlap rule:

```
newStart < existingEnd && newEnd > existingStart
```

A touching boundary is not considered an overlap.

## Roles

A single account can act as a Player and/or Captain. The onboarding choice controls the initial experience; it must not create duplicate accounts.

## Match lifecycle

```
DRAFT -> INVITED -> ACCEPTED
                 \-> DECLINED

ACCEPTED -> CANCELLED
```

## Player

- View month/week schedule
- View upcoming matches
- Accept/reject invitations
- See conflict warnings
- View team and captain details
- Receive reminder notification one hour before match

## Captain

- Create team
- Invite players
- Create/edit/cancel matches
- See invitation status
- See team members
- Set match venue/location

## Core data

- User
- PlayerProfile
- Team
- TeamMember
- Match
- MatchPlayer / Invitation
- Venue
- Notification
- Conversation
- Message

Future entities:

- Tournament
- Video
- Subscription
- Payment
- PlayerStatistic

## UX principle

The next match should be visible immediately after opening the app. Calendar is the primary navigation destination for a player.

## Non-goals for MVP

No tournament scoring engine, auction workflow, AI video analysis, WhatsApp automation, or payment collection in the first milestone.
