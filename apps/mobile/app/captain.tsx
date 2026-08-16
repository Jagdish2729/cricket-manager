import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

const API = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";

type AnyObj = any;

async function api(path: string, options: AnyObj = {}, token: string) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString([], { day: "numeric", month: "short" });

const formatTime = (value: string) =>
  new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export default function Captain() {
  const [token, setToken] = useState<string | null>(null);
  const [team, setTeam] = useState<AnyObj>(null);
  const [matches, setMatches] = useState<AnyObj[]>([]);
  const [fees, setFees] = useState<AnyObj[]>([]);
  const [tab, setTab] = useState("home");
  const [teamName, setTeamName] = useState("");
  const [phone, setPhone] = useState("");
  const [qr, setQr] = useState("");
  const [totalFee, setTotalFee] = useState("");
  const [paidPlayers, setPaidPlayers] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem("cm_token").then((storedToken) => {
      setToken(storedToken);
      if (storedToken) load(storedToken);
    });
  }, []);

  async function load(currentToken: string) {
    try {
      const [teamData, matchData, feeData] = await Promise.all([
        api("/captain/team", {}, currentToken),
        api("/captain/matches", {}, currentToken),
        api("/captain/fees", {}, currentToken),
      ]);

      setTeam(teamData);
      setMatches(matchData.matches ?? []);
      setFees(feeData.fees ?? []);
      setQr(teamData?.captainQrData ?? "");
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  }

  async function createTeam() {
    if (!token) return;
    try {
      await api(
        "/captain/team",
        { method: "POST", body: JSON.stringify({ name: teamName }) },
        token
      );
      await load(token);
      setTeamName("");
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  }

  async function addPlayer() {
    if (!token) return;
    try {
      await api(
        "/captain/team/players",
        { method: "POST", body: JSON.stringify({ phone }) },
        token
      );
      setPhone("");
      await load(token);
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  }

  async function saveQr() {
    if (!token) return;
    try {
      await api(
        "/captain/qr",
        { method: "PUT", body: JSON.stringify({ qrData: qr }) },
        token
      );
      Alert.alert("Saved", "Your payment QR details are saved.");
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  }

  async function settleFees(matchId: string) {
    if (!token) return;
    try {
      const result = await api(
        `/captain/matches/${matchId}/settle-fees`,
        {
          method: "POST",
          body: JSON.stringify({
            totalFee: Number(totalFee),
            paidPlayerIds: paidPlayers,
          }),
        },
        token
      );

      Alert.alert("Match settled", `₹${result.playerShare} per player`);
      setTotalFee("");
      setPaidPlayers([]);
      await load(token);
    } catch (error: any) {
      Alert.alert("Error", error.message);
    }
  }

  if (!token) {
    return (
      <SafeAreaView style={styles.page}>
        <Text style={styles.muted}>Please sign in first.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>CAPTAIN MODE</Text>
          <Text style={styles.title}>{team?.name || "Captain Home"}</Text>
        </View>
        <Text style={styles.ball}>🏏</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {tab === "home" && (
          <>
            <Text style={styles.sub}>Manage your cricket from one place</Text>

            <Pressable style={styles.card} onPress={() => setTab("team")}>
              <Text style={styles.icon}>👥</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>My Team</Text>
                <Text style={styles.muted}>
                  {team?.members?.length ?? 0} players · Add by phone number
                </Text>
              </View>
            </Pressable>

            <Pressable style={styles.card} onPress={() => setTab("matches")}>
              <Text style={styles.icon}>📅</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>My Matches</Text>
                <Text style={styles.muted}>
                  {matches.length} matches · Manage upcoming games
                </Text>
              </View>
            </Pressable>

            <Pressable style={styles.card} onPress={() => setTab("qr")}>
              <Text style={styles.icon}>▦</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>My QR Code</Text>
                <Text style={styles.muted}>Add your payment QR details</Text>
              </View>
            </Pressable>

            <Pressable style={styles.card} onPress={() => setTab("fees")}>
              <Text style={styles.icon}>₹</Text>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>Collect Match Fees</Text>
                <Text style={styles.muted}>
                  {fees.length} pending confirmations
                </Text>
              </View>
            </Pressable>
          </>
        )}

        {tab === "team" && (
          <>
            <Pressable onPress={() => setTab("home")}>
              <Text style={styles.back}>‹ Captain Home</Text>
            </Pressable>
            <Text style={styles.h2}>My Team</Text>

            {!team ? (
              <>
                <TextInput
                  placeholder="Team name"
                  value={teamName}
                  onChangeText={setTeamName}
                  style={styles.input}
                />
                <Pressable style={styles.primary} onPress={createTeam}>
                  <Text style={styles.primaryText}>Create Team</Text>
                </Pressable>
              </>
            ) : (
              <>
                {(team.members ?? []).map((member: AnyObj) => (
                  <View style={styles.player} key={member.id}>
                    <Text style={styles.avatar}>
                      {(member.user?.name || "P").charAt(0)}
                    </Text>
                    <View>
                      <Text style={styles.cardTitle}>
                        {member.user?.name || "New Player"}
                      </Text>
                      <Text style={styles.muted}>
                        {member.user?.phone || member.invitedPhone}
                      </Text>
                    </View>
                  </View>
                ))}

                <Text style={styles.label}>Add player by mobile number</Text>
                <TextInput
                  placeholder="9876543210"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  style={styles.input}
                />
                <Pressable style={styles.primary} onPress={addPlayer}>
                  <Text style={styles.primaryText}>Add Player</Text>
                </Pressable>
              </>
            )}
          </>
        )}

        {tab === "matches" && (
          <>
            <Pressable onPress={() => setTab("home")}>
              <Text style={styles.back}>‹ Captain Home</Text>
            </Pressable>
            <Text style={styles.h2}>My Matches</Text>

            {matches.length === 0 ? (
              <Text style={styles.muted}>No matches yet.</Text>
            ) : (
              matches.map((match) => (
                <View style={styles.match} key={match.id}>
                  <Text style={styles.cardTitle}>{match.title}</Text>
                  <Text style={styles.muted}>
                    {formatDate(match.startsAt)} · {formatTime(match.startsAt)}
                    {match.ground ? ` · ${match.ground}` : ""}
                  </Text>
                  <Text style={styles.label}>
                    Players: {match.bookings?.length ?? 0}
                  </Text>
                  <Text style={styles.muted}>
                    Select paid players after the match, then settle fees below.
                  </Text>
                </View>
              ))
            )}
          </>
        )}

        {tab === "qr" && (
          <>
            <Pressable onPress={() => setTab("home")}>
              <Text style={styles.back}>‹ Captain Home</Text>
            </Pressable>
            <Text style={styles.h2}>My QR Code</Text>
            <View style={styles.cardColumn}>
              <Text style={styles.muted}>
                Paste your UPI/payment QR data or payment link. Players will see
                it on their match details.
              </Text>
              <TextInput
                placeholder="UPI ID / payment QR data"
                value={qr}
                onChangeText={setQr}
                style={styles.input}
              />
              <Pressable style={styles.primary} onPress={saveQr}>
                <Text style={styles.primaryText}>Save QR</Text>
              </Pressable>
            </View>
          </>
        )}

        {tab === "fees" && (
          <>
            <Pressable onPress={() => setTab("home")}>
              <Text style={styles.back}>‹ Captain Home</Text>
            </Pressable>
            <Text style={styles.h2}>Collect Match Fees</Text>

            {matches.map((match) => (
              <View style={styles.match} key={match.id}>
                <Text style={styles.cardTitle}>{match.title}</Text>
                <Text style={styles.muted}>
                  {formatDate(match.startsAt)} · {match.bookings?.length ?? 0} players
                </Text>

                <TextInput
                  placeholder="Total match fee ₹"
                  value={totalFee}
                  onChangeText={setTotalFee}
                  keyboardType="numeric"
                  style={styles.input}
                />

                {(match.bookings ?? []).map((booking: AnyObj) => {
                  const selected = paidPlayers.includes(booking.player.id);
                  return (
                    <Pressable
                      key={booking.id}
                      style={styles.check}
                      onPress={() =>
                        setPaidPlayers((current) =>
                          selected
                            ? current.filter((id) => id !== booking.player.id)
                            : [...current, booking.player.id]
                        )
                      }
                    >
                      <Text>
                        {selected ? "☑" : "☐"} {booking.player.name}
                      </Text>
                    </Pressable>
                  );
                })}

                <Pressable
                  style={styles.primary}
                  onPress={() => settleFees(match.id)}
                >
                  <Text style={styles.primaryText}>Settle Match Fees</Text>
                </Pressable>
              </View>
            ))}

            {fees.length > 0 && (
              <Text style={styles.muted}>
                Players who mark payment done will appear here for captain
                confirmation.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#F5F7FB",
  },
  header: {
    padding: 20,
    paddingTop: 24,
    backgroundColor: "#171725",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.5,
    color: "#A78BFA",
  },
  title: {
    fontSize: 25,
    fontWeight: "900",
    color: "white",
    marginTop: 3,
  },
  ball: {
    fontSize: 34,
  },
  content: {
    padding: 18,
    paddingBottom: 40,
  },
  sub: {
    color: "#6B7280",
    marginBottom: 14,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    elevation: 2,
  },
  cardColumn: {
    backgroundColor: "white",
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
    elevation: 2,
  },
  cardBody: {
    flex: 1,
  },
  icon: {
    fontSize: 29,
    marginRight: 15,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 3,
  },
  muted: {
    fontSize: 13,
    color: "#6B7280",
  },
  h2: {
    fontSize: 23,
    fontWeight: "900",
    marginBottom: 15,
    color: "#111827",
  },
  back: {
    color: "#6D28D9",
    fontWeight: "900",
    marginBottom: 16,
  },
  input: {
    backgroundColor: "#EEF0F4",
    borderRadius: 12,
    padding: 13,
    fontSize: 15,
    marginVertical: 8,
  },
  primary: {
    backgroundColor: "#171725",
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginVertical: 8,
  },
  primaryText: {
    color: "white",
    fontWeight: "900",
  },
  player: {
    backgroundColor: "white",
    borderRadius: 14,
    padding: 13,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#EDE9FE",
    textAlign: "center",
    textAlignVertical: "center",
    paddingTop: 10,
    marginRight: 12,
    fontWeight: "900",
  },
  label: {
    fontWeight: "800",
    color: "#374151",
    marginTop: 10,
  },
  match: {
    backgroundColor: "white",
    borderRadius: 17,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
  },
  check: {
    backgroundColor: "#F8F8FA",
    padding: 12,
    borderRadius: 10,
    marginVertical: 3,
  },
});
