import "dotenv/config";
import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { PrismaClient, BookingStatus } from "@prisma/client";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT ?? 4000);
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";
const TOKEN_KEY = "cm_token";
const otpStore = new Map<string, { otp: string; expires: number }>();

const userSelect = {
  id: true,
  name: true,
  phone: true,
  teamName: true,
  captainQrData: true,
  role: true,
  isPlayer: true,
  isCaptain: true,
} as const;

const idParam = (req: express.Request, name: string): string => {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
};

const getUser = (id: string) =>
  prisma.user.findUnique({ where: { id }, select: userSelect });

const tokenFor = (user: any) =>
  jwt.sign(
    {
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      teamName: user.teamName,
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    (req as any).user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/auth/send-otp", async (req, res) => {
  try {
    const phone = z.string().min(8).max(30).parse(req.body.phone).trim();
    otpStore.set(phone, { otp: "123456", expires: Date.now() + 5 * 60_000 });
    return res.json({ ok: true, devOtp: "123456" });
  } catch {
    return res.status(400).json({ error: "Enter a valid phone number." });
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const body = z.object({
      phone: z.string().min(8).max(30),
      otp: z.string().length(6),
      name: z.string().min(2).optional(),
    }).parse(req.body);
    const phone = body.phone.trim();
    const stored = otpStore.get(phone);

    if (!stored || stored.expires < Date.now() || stored.otp !== body.otp) {
      return res.status(400).json({ error: "Invalid or expired OTP." });
    }

    let user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      user = await prisma.user.create({
        data: { phone, name: body.name ?? "New Player", role: "PLAYER", isPlayer: true },
      });
    }

    otpStore.delete(phone);
    await prisma.teamMember.updateMany({
      where: { invitedPhone: phone, userId: null },
      data: { userId: user.id },
    });

    return res.json({ token: tokenFor(user), user: await getUser(user.id) });
  } catch {
    return res.status(400).json({ error: "Invalid OTP request." });
  }
});

app.get("/me", auth, async (req, res) => {
  const user = await getUser((req as any).user.id);
  if (!user) return res.status(404).json({ error: "User not found." });
  return res.json(user);
});

app.put("/me/profile", auth, async (req, res) => {
  const body = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
  const user = await prisma.user.update({
    where: { id: (req as any).user.id },
    data: { name: body.name.trim() },
  });
  return res.json({ user: await getUser(user.id), token: tokenFor(user) });
});

app.post("/me/role", auth, async (req, res) => {
  const body = z.object({ role: z.enum(["PLAYER", "CAPTAIN"]) }).parse(req.body);
  const data = body.role === "PLAYER"
    ? { role: "PLAYER" as const, isPlayer: true }
    : { role: "CAPTAIN" as const, isCaptain: true };
  const user = await prisma.user.update({ where: { id: (req as any).user.id }, data });
  return res.json({ user: await getUser(user.id), token: tokenFor(user) });
});

app.post("/me/switch-role", auth, async (req, res) => {
  const id = (req as any).user.id;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return res.status(404).json({ error: "User not found." });
  if (!user.isPlayer || !user.isCaptain) {
    return res.status(400).json({ error: "Both Player and Captain modes must be enabled." });
  }
  const role = user.role === "CAPTAIN" ? "PLAYER" : "CAPTAIN";
  const updated = await prisma.user.update({ where: { id }, data: { role } });
  return res.json({ user: await getUser(id), token: tokenFor(updated), activeRole: role });
});

app.get("/schedule", auth, async (req, res) => {
  const playerId = (req as any).user.id;
  const [locks, bookings] = await Promise.all([
    prisma.scheduleLock.findMany({
      where: { playerId },
      orderBy: { startsAt: "asc" },
    }),
    prisma.matchBooking.findMany({
      where: { playerId, status: BookingStatus.PENDING },
      include: {
        match: { include: { captain: { select: { name: true, teamName: true } } } },
      },
      orderBy: { match: { startsAt: "asc" } },
    }),
  ]);
  return res.json({ locks, requests: bookings });
});

app.post("/schedule/lock", auth, async (req, res) => {
  const body = z.object({
    title: z.string().min(2),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  }).parse(req.body);
  if (body.endsAt <= body.startsAt) {
    return res.status(400).json({ error: "End time must be after start time." });
  }
  const playerId = (req as any).user.id;
  const conflict = await prisma.scheduleLock.findFirst({
    where: { playerId, startsAt: { lt: body.endsAt }, endsAt: { gt: body.startsAt } },
  });
  if (conflict) return res.status(409).json({ error: "You already have something scheduled then." });
  const lock = await prisma.scheduleLock.create({
    data: { playerId, title: body.title, startsAt: body.startsAt, endsAt: body.endsAt },
  });
  return res.status(201).json(lock);
});

app.post("/bookings/:bookingId/respond", auth, async (req, res) => {
  const bookingId = idParam(req, "bookingId");
  const body = z.object({ accept: z.boolean() }).parse(req.body);
  const booking = await prisma.matchBooking.findFirst({
    where: { id: bookingId, playerId: (req as any).user.id },
  });
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  const updated = await prisma.matchBooking.update({
    where: { id: booking.id },
    data: { status: body.accept ? BookingStatus.ACCEPTED : BookingStatus.DECLINED },
  });
  return res.json(updated);
});

app.get("/player/teams", auth, async (req, res) => {
  const memberships = await prisma.teamMember.findMany({
    where: { userId: (req as any).user.id },
    include: { team: { include: { captain: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ teams: memberships });
});

app.get("/player/matches", auth, async (req, res) => {
  const bookings = await prisma.matchBooking.findMany({
    where: { playerId: (req as any).user.id, status: BookingStatus.ACCEPTED },
    include: { match: { include: { captain: { select: { id: true, name: true, teamName: true, captainQrData: true } } } } },
    orderBy: { match: { startsAt: "asc" } },
  });
  return res.json({ matches: bookings });
});

app.get("/player/pending-fees", auth, async (req, res) => {
  const fees = await prisma.matchBooking.findMany({
    where: { playerId: (req as any).user.id, status: BookingStatus.ACCEPTED, feePaid: false, feeAmount: { gt: 0 } },
    include: { match: { include: { captain: { select: { name: true, teamName: true, captainQrData: true } } } } },
    orderBy: { match: { startsAt: "desc" } },
  });
  return res.json({ fees, total: fees.reduce((sum, fee) => sum + fee.feeAmount, 0) });
});

app.post("/player/fees/:id/pay", auth, async (req, res) => {
  const id = idParam(req, "id");
  const booking = await prisma.matchBooking.findFirst({
    where: { id, playerId: (req as any).user.id, feePaid: false },
  });
  if (!booking) return res.status(404).json({ error: "Pending fee not found." });
  const updated = await prisma.matchBooking.update({
    where: { id },
    data: { paymentMarkedByPlayer: true, paymentMarkedAt: new Date() },
  });
  return res.json(updated);
});

app.post("/player/fees/:id/payment-done", auth, async (req, res) => {
  const id = idParam(req, "id");
  const booking = await prisma.matchBooking.findFirst({
    where: { id, playerId: (req as any).user.id, feePaid: false },
  });
  if (!booking) return res.status(404).json({ error: "Pending fee not found." });
  const updated = await prisma.matchBooking.update({
    where: { id },
    data: { paymentMarkedByPlayer: true, paymentMarkedAt: new Date() },
  });
  return res.json(updated);
});

app.get("/captain/team", auth, async (req, res) => {
  const team = await prisma.team.findUnique({
    where: { captainId: (req as any).user.id },
    include: { members: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, phone: true, role: true } } } } },
  });
  return res.json(team);
});

app.post("/captain/team", auth, async (req, res) => {
  const id = (req as any).user.id;
  const body = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user?.isCaptain) return res.status(403).json({ error: "Captain access required." });
  const existing = await prisma.team.findUnique({ where: { captainId: id } });
  if (existing) return res.status(409).json({ error: "You already have a team." });
  const team = await prisma.team.create({ data: { name: body.name.trim(), captainId: id } });
  await prisma.user.update({ where: { id }, data: { teamName: team.name, role: "CAPTAIN", isCaptain: true } });
  return res.status(201).json(team);
});

app.post("/captain/team/players", auth, async (req, res) => {
  const captainId = (req as any).user.id;
  const phone = z.string().min(8).max(30).parse(req.body.phone).trim();
  const team = await prisma.team.findUnique({ where: { captainId } });
  if (!team) return res.status(400).json({ error: "Create your team first." });
  const existing = await prisma.teamMember.findUnique({ where: { teamId_invitedPhone: { teamId: team.id, invitedPhone: phone } } });
  if (existing) return res.status(409).json({ error: "This number is already in your team." });

  let player = await prisma.user.findUnique({ where: { phone } });
  let createdProfile = false;
  if (!player) {
    player = await prisma.user.create({ data: { phone, name: "New Player", role: "PLAYER", isPlayer: true } });
    createdProfile = true;
  } else if (!player.isPlayer) {
    player = await prisma.user.update({ where: { id: player.id }, data: { isPlayer: true } });
  }
  const member = await prisma.teamMember.create({ data: { teamId: team.id, userId: player.id, invitedPhone: phone } });
  return res.status(201).json({ createdProfile, devOtp: createdProfile ? "123456" : null, member });
});

app.put("/captain/qr", auth, async (req, res) => {
  const body = z.object({ qrData: z.string().min(3).max(2000) }).parse(req.body);
  const user = await prisma.user.update({ where: { id: (req as any).user.id }, data: { captainQrData: body.qrData, isCaptain: true } });
  return res.json({ user: await getUser(user.id) });
});

app.get("/captain/matches", auth, async (req, res) => {
  const matches = await prisma.match.findMany({
    where: { captainId: (req as any).user.id },
    include: { bookings: { include: { player: { select: { id: true, name: true, phone: true } } } } },
    orderBy: { startsAt: "asc" },
  });
  return res.json({ matches });
});

app.post("/captain/matches", auth, async (req, res) => {
  const captainId = (req as any).user.id;
  const body = z.object({ title: z.string().min(2), ground: z.string().min(2).optional(), startsAt: z.coerce.date(), endsAt: z.coerce.date() }).parse(req.body);
  if (body.endsAt.getTime() - body.startsAt.getTime() < 3 * 60 * 60 * 1000) return res.status(400).json({ error: "Cricket matches must be at least 3 hours." });
  const conflict = await prisma.match.findFirst({ where: { captainId, startsAt: { lt: body.endsAt }, endsAt: { gt: body.startsAt } } });
  if (conflict) return res.status(409).json({ error: "You already have a match at this time." });
  const match = await prisma.match.create({ data: { title: body.title, ground: body.ground ?? null, startsAt: body.startsAt, endsAt: body.endsAt, captainId } });
  return res.status(201).json(match);
});

app.post("/captain/matches/:matchId/players", auth, async (req, res) => {
  const captainId = (req as any).user.id;
  const matchId = idParam(req, "matchId");
  const body = z.object({ phone: z.string().min(8).optional(), playerId: z.string().optional() }).parse(req.body);
  const match = await prisma.match.findFirst({ where: { id: matchId, captainId } });
  if (!match) return res.status(404).json({ error: "Match not found." });
  let player = body.playerId ? await prisma.user.findUnique({ where: { id: body.playerId } }) : body.phone ? await prisma.user.findUnique({ where: { phone: body.phone.trim() } }) : null;
  let createdProfile = false;
  if (!player && body.phone) {
    player = await prisma.user.create({ data: { phone: body.phone.trim(), name: "New Player", role: "PLAYER", isPlayer: true } });
    createdProfile = true;
  }
  if (!player) return res.status(404).json({ error: "Player not found." });
  const existing = await prisma.matchBooking.findUnique({ where: { matchId_playerId: { matchId, playerId: player.id } } });
  if (existing) return res.status(409).json({ error: "Player is already added to this match." });
  const booking = await prisma.matchBooking.create({ data: { matchId, playerId: player.id, status: BookingStatus.ACCEPTED } });
  return res.status(201).json({ createdProfile, devOtp: createdProfile ? "123456" : null, booking });
});

app.get("/captain/matches/:matchId/fees", auth, async (req, res) => {
  const matchId = idParam(req, "matchId");
  const match = await prisma.match.findFirst({
    where: { id: matchId, captainId: (req as any).user.id },
    include: { bookings: { where: { status: BookingStatus.ACCEPTED }, include: { player: { select: { id: true, name: true, phone: true } } } } },
  });
  if (!match) return res.status(404).json({ error: "Match not found." });
  return res.json({ match, players: match.bookings });
});

app.post("/captain/matches/:matchId/settle-fees", auth, async (req, res) => {
  const matchId = idParam(req, "matchId");
  const body = z.object({ totalFee: z.coerce.number().positive(), paidPlayerIds: z.array(z.string()).default([]) }).parse(req.body);
  const match = await prisma.match.findFirst({ where: { id: matchId, captainId: (req as any).user.id }, include: { bookings: { where: { status: BookingStatus.ACCEPTED } } } });
  if (!match) return res.status(404).json({ error: "Match not found." });
  if (match.bookings.length === 0) return res.status(400).json({ error: "Add players to the match first." });
  const ids = new Set(match.bookings.map((b) => b.playerId));
  if (body.paidPlayerIds.some((id) => !ids.has(id))) return res.status(400).json({ error: "One or more paid players are not in this match." });
  const share = Math.round((body.totalFee / match.bookings.length) * 100) / 100;
  const paid = new Set(body.paidPlayerIds);
  await prisma.$transaction([
    prisma.match.update({ where: { id: matchId }, data: { totalFee: body.totalFee, feeSettled: true } }),
    ...match.bookings.map((booking) => prisma.matchBooking.update({ where: { id: booking.id }, data: { feeAmount: share, feePaid: paid.has(booking.playerId), paymentMarkedByPlayer: false, paymentMarkedAt: null } })),
  ]);
  return res.json({ totalFee: body.totalFee, playerShare: share, paidPlayers: body.paidPlayerIds.length, pendingPlayers: match.bookings.length - body.paidPlayerIds.length });
});

app.get("/captain/fees", auth, async (req, res) => {
  const rows = await prisma.matchBooking.findMany({
    where: { match: { captainId: (req as any).user.id }, feeAmount: { gt: 0 }, feePaid: false },
    include: { player: { select: { id: true, name: true, phone: true } }, match: { select: { id: true, title: true, startsAt: true } } },
    orderBy: { match: { startsAt: "asc" } },
  });
  return res.json({ fees: rows, total: rows.reduce((sum, row) => sum + row.feeAmount, 0) });
});

app.post("/captain/fees/:id/confirm", auth, async (req, res) => {
  const id = idParam(req, "id");
  const booking = await prisma.matchBooking.findFirst({ where: { id, match: { captainId: (req as any).user.id }, paymentMarkedByPlayer: true, feePaid: false } });
  if (!booking) return res.status(404).json({ error: "Payment confirmation not found." });
  const updated = await prisma.matchBooking.update({ where: { id }, data: { feePaid: true } });
  return res.json(updated);
});

app.listen(PORT, () => console.log(`🏏 Cricket Manager API: http://localhost:${PORT}`));
