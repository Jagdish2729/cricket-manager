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

type TokenUser = { id: string; name: string; phone: string; role?: string | null; teamName?: string | null };

function token(user: TokenUser) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: "30d" });
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
  try {
    (req as any).user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

async function publicUser(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { id: true, name: true, phone: true, role: true, teamName: true } });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

const otpStore = new Map<string, { otp: string; expires: number }>();

app.post("/auth/send-otp", async (req, res) => {
  const phone = z.string().min(8).parse(req.body.phone).trim();
  otpStore.set(phone, { otp: "123456", expires: Date.now() + 5 * 60_000 });
  res.json({ ok: true, devOtp: "123456" });
});

app.post("/auth/verify-otp", async (req, res) => {
  const body = z.object({ phone: z.string().min(8), otp: z.string().length(6), name: z.string().min(2).optional() }).parse(req.body);
  body.phone = body.phone.trim();
  const stored = otpStore.get(body.phone);
  if (!stored || stored.expires < Date.now() || stored.otp !== body.otp) {
    return res.status(400).json({ error: "Invalid or expired OTP." });
  }

  let user = await prisma.user.findUnique({ where: { phone: body.phone } });
  if (!user) {
    user = await prisma.user.create({ data: { phone: body.phone, name: body.name ?? "New Player" } });
  } else if (body.name && user.name === "New Player") {
    user = await prisma.user.update({ where: { id: user.id }, data: { name: body.name } });
  }

  otpStore.delete(body.phone);

  await prisma.teamMember.updateMany({
    where: { invitedPhone: body.phone, userId: null },
    data: { userId: user.id }
  });

  res.json({ token: token(user), user: await publicUser(user.id) });
});

app.get("/me", auth, async (req, res) => {
  res.json(await publicUser((req as any).user.id));
});

app.put("/me/profile", auth, async (req, res) => {
  const body = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
  const user = await prisma.user.update({ where: { id: (req as any).user.id }, data: { name: body.name.trim() } });
  res.json({ user: await publicUser(user.id), token: token(user) });
});

app.post("/me/role", auth, async (req, res) => {
  const body = z.object({ role: z.enum(["PLAYER", "CAPTAIN"]) }).parse(req.body);
  const user = await prisma.user.update({ where: { id: (req as any).user.id }, data: { role: body.role } });
  res.json({ user: await publicUser(user.id), token: token(user) });
});

app.get("/captain/team", auth, async (req, res) => {
  const captainId = (req as any).user.id;
  const team = await prisma.team.findUnique({
    where: { captainId },
    include: { members: { orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, name: true, phone: true, role: true } } } } }
  });
  res.json(team);
});

app.post("/captain/team", auth, async (req, res) => {
  const captainId = (req as any).user.id;
  const body = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
  const captain = await prisma.user.findUnique({ where: { id: captainId } });
  if (!captain || captain.role !== "CAPTAIN") return res.status(403).json({ error: "Captain access required." });
  const existing = await prisma.team.findUnique({ where: { captainId } });
  if (existing) return res.status(409).json({ error: "You already have a team." });
  const team = await prisma.team.create({ data: { name: body.name.trim(), captainId } });
  await prisma.user.update({ where: { id: captainId }, data: { teamName: team.name } });
  res.status(201).json(team);
});

app.post("/captain/team/players", auth, async (req, res) => {
  const captainId = (req as any).user.id;
  const body = z.object({ phone: z.string().min(8).max(30) }).parse(req.body);
  const phone = body.phone.trim();
  const team = await prisma.team.findUnique({ where: { captainId } });
  if (!team) return res.status(400).json({ error: "Create your team first." });

  const existingMember = await prisma.teamMember.findUnique({ where: { teamId_invitedPhone: { teamId: team.id, invitedPhone: phone } } });
  if (existingMember) return res.status(409).json({ error: "This number is already in your team." });

  let player = await prisma.user.findUnique({ where: { phone } });
  let createdProfile = false;
  if (!player) {
    player = await prisma.user.create({ data: { phone, name: "New Player", role: "PLAYER" } });
    createdProfile = true;
  } else if (!player.role) {
    player = await prisma.user.update({ where: { id: player.id }, data: { role: "PLAYER" } });
  }

  const member = await prisma.teamMember.create({ data: { teamId: team.id, userId: player.id, invitedPhone: phone } });
  res.status(201).json({ createdProfile, member: { id: member.id, phone: player.phone, name: player.name, userId: player.id } });
});

app.get("/schedule", auth, async (req, res) => {
  const userId = (req as any).user.id;
  const locks = await prisma.scheduleLock.findMany({ where: { playerId: userId }, include: { captain: { select: { name: true, teamName: true } } }, orderBy: { startsAt: "asc" } });
  const bookings = await prisma.matchBooking.findMany({ where: { playerId: userId, status: BookingStatus.PENDING }, include: { match: { include: { captain: { select: { name: true, teamName: true } } } } }, orderBy: { match: { startsAt: "asc" } } });
  res.json({ locks, requests: bookings });
});

app.post("/schedule/lock", auth, async (req, res) => {
  const userId = (req as any).user.id;
  const body = z.object({ title: z.string().min(2), startsAt: z.coerce.date(), endsAt: z.coerce.date() }).parse(req.body);
  if (body.endsAt <= body.startsAt) return res.status(400).json({ error: "End time must be after start time." });
  const conflicts = await prisma.scheduleLock.findMany({ where: { playerId: userId, startsAt: { lt: body.endsAt }, endsAt: { gt: body.startsAt }, status: "LOCKED" } });
  if (conflicts.length) return res.status(409).json({ error: "This time is already locked in your schedule.", conflicts });
  const bookingConflicts = await prisma.matchBooking.findMany({ where: { playerId: userId, status: BookingStatus.ACCEPTED, match: { startsAt: { lt: body.endsAt }, endsAt: { gt: body.startsAt } } }, include: { match: true } });
  if (bookingConflicts.length) return res.status(409).json({ error: "You already have a confirmed match at this time.", conflicts: bookingConflicts });
  const lock = await prisma.scheduleLock.create({ data: { playerId: userId, title: body.title, startsAt: body.startsAt, endsAt: body.endsAt, source: "PLAYER" } });
  res.status(201).json(lock);
});

app.delete("/schedule/lock/:id", auth, async (req, res) => {
  const lock = await prisma.scheduleLock.findFirst({ where: { id: req.params.id, playerId: (req as any).user.id } });
  if (!lock) return res.status(404).json({ error: "Schedule lock not found." });
  await prisma.scheduleLock.delete({ where: { id: lock.id } });
  res.json({ ok: true });
});

app.post("/captain/book-player", auth, async (req, res) => {
  const captainId = (req as any).user.id;
  const body = z.object({ playerId: z.string(), title: z.string().min(2), startsAt: z.coerce.date(), endsAt: z.coerce.date() }).parse(req.body);
  const player = await prisma.user.findUnique({ where: { id: body.playerId } });
  if (!player) return res.status(404).json({ error: "Player not found." });
  const lockConflict = await prisma.scheduleLock.findMany({ where: { playerId: body.playerId, status: "LOCKED", startsAt: { lt: body.endsAt }, endsAt: { gt: body.startsAt } } });
  const confirmedConflict = await prisma.matchBooking.findMany({ where: { playerId: body.playerId, status: BookingStatus.ACCEPTED, match: { startsAt: { lt: body.endsAt }, endsAt: { gt: body.startsAt } } }, include: { match: true } });
  if (lockConflict.length || confirmedConflict.length) return res.status(409).json({ error: "Player is not available for this time.", scheduleLocks: lockConflict, confirmedMatches: confirmedConflict });
  const match = await prisma.match.create({ data: { title: body.title, startsAt: body.startsAt, endsAt: body.endsAt, captainId, bookings: { create: { playerId: body.playerId, status: BookingStatus.PENDING } } }, include: { bookings: true } });
  res.status(201).json(match);
});

app.post("/bookings/:id/respond", auth, async (req, res) => {
  const playerId = (req as any).user.id;
  const body = z.object({ accept: z.boolean() }).parse(req.body);
  const booking = await prisma.matchBooking.findUnique({ where: { id: req.params.id }, include: { match: true } });
  if (!booking || booking.playerId !== playerId) return res.status(404).json({ error: "Request not found." });
  if (!body.accept) return res.json(await prisma.matchBooking.update({ where: { id: booking.id }, data: { status: BookingStatus.DECLINED } }));
  const conflicts = await prisma.scheduleLock.findMany({ where: { playerId, status: "LOCKED", startsAt: { lt: booking.match.endsAt }, endsAt: { gt: booking.match.startsAt } } });
  if (conflicts.length) return res.status(409).json({ error: "You already locked this time in your schedule.", conflicts });
  const confirmed = await prisma.matchBooking.findMany({ where: { playerId, status: BookingStatus.ACCEPTED, match: { startsAt: { lt: booking.match.endsAt }, endsAt: { gt: booking.match.startsAt } } } });
  if (confirmed.length) return res.status(409).json({ error: "You already have a confirmed match at this time.", conflicts: confirmed });
  const updated = await prisma.matchBooking.update({ where: { id: booking.id }, data: { status: BookingStatus.ACCEPTED } });
  res.json(updated);
});

app.listen(PORT, () => console.log(`🏏 Cricket Manager API: http://localhost:${PORT}`));
