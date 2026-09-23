# Cricket Manager — MVP Foundation

A mobile-first cricket player & captain management app for Android and iOS.

## Product goal

Keep a player's cricket commitments in one place so they do not accidentally accept overlapping matches.

### MVP

- Email/password authentication
- Player / Captain onboarding
- Player calendar and upcoming matches
- Captain team creation
- Player invitations with accept/reject
- Match conflict detection
- Match reminders
- Match location with Google Maps
- Basic player profile
- Team and 1-to-1/team chat foundation

### Later phases

- Tournament management and points tables
- Match/player statistics
- Cricket profile/reels
- Match fees and online payments
- Pro subscription and ads
- WhatsApp notifications
- AI cricket assistant and video analysis

## Repository

- `apps/mobile` — Expo + React Native + TypeScript
- `apps/api` — Node.js + TypeScript API
- `apps/api/prisma` — database schema

## Local setup

### Requirements

- Node.js 20+
- Git
- Android Studio/emulator or Expo Go
- PostgreSQL for the API

### Mobile

```bash
cd apps/mobile
npm install
copy .env.example .env
npx expo start
```

### API

```bash
cd apps/api
npm install
copy .env.example .env
npx prisma generate
npm run dev
```

Do not commit real credentials or `.env` files.

## Development order

1. Auth + onboarding
2. Player profile
3. Calendar/matches
4. Captain team + invitations
5. Conflict detection
6. Notifications
7. Location
8. Chat
9. Payments/subscription
10. Cricket profile/reels

The first implementation is intentionally kept small so each milestone can be tested before the next one is added.
