import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const captain = await prisma.user.upsert({
    where: { phone: "9999999999" },
    update: { name: "Rahul Captain", role: "CAPTAIN", teamName: "Delhi Warriors" },
    create: { name: "Rahul Captain", phone: "9999999999", role: "CAPTAIN", teamName: "Delhi Warriors" }
  });

  const player = await prisma.user.upsert({
    where: { phone: "8888888888" },
    update: { name: "Aman Player", role: "PLAYER" },
    create: { name: "Aman Player", phone: "8888888888", role: "PLAYER" }
  });

  console.log(`Seeded: ${captain.name} and ${player.name}`);
}

main().finally(() => prisma.$disconnect());
