# Cricket Manager MVP v3

This version follows the product flow agreed for the first release.

## User journey

### First-time user
Sign in / sign up with mobile number -> OTP -> choose:
- I am a Player
- I am a Captain

### Returning user
If logged in, open directly into the app. Logout returns to sign-in.

### Player
- My Schedule
- Lock their own time slots
- See captain match requests
- Confirm / decline captain requests
- A captain cannot request a player during a locked or confirmed time slot

### Captain
- Enter team name
- See:
  - Book Player
  - Manage Ground Fees

Those captain features are intentionally placeholders for the next phase.

## Development OTP

OTP is currently `123456` for development only. Replace with Firebase Phone Auth, MSG91, Twilio, or another provider before production.

## Run API

```bash
cd apps/api
npm install
npx prisma generate
npx prisma migrate dev --name v3
npm run seed
npm run dev
```

## Run mobile

```bash
cd apps/mobile
npm install
npx expo start
```

For web, press `w`.

Set `apps/mobile/.env`:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.14:4000
```

Use the current LAN IP of the computer when testing on a phone.

## Calendar UX
The player schedule is intentionally calendar-first, similar to an Outlook-style meeting calendar. Players can select a date, see blocked slots, and block their own time. Captain requests appear separately for confirmation.

## v5 calendar UI
The player home is now an Outlook-style calendar: Work week, Week, Day and Month views, hourly time grid, navigation, Today button, event blocks, captain confirmation cards, and click-to-block time slots.

## v6 profile + phone-based team onboarding
- First OTP login creates a placeholder profile until the player/captain enters a full name.
- Mobile number is the primary identity.
- Captains create their team first.
- Captains add players by mobile number.
- Existing numbers are linked to their profile; new numbers get a player profile immediately and can complete their profile later.
