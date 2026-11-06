const baileys = require("@whiskeysockets/baileys");
const makeWASocket = baileys.default;

const {
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    DisconnectReason,
    Browsers
} = baileys;

const pino = require("pino");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const mega = require("./mega");

const SESSION_DIR = path.join(__dirname, "session");
const ARCHIVE = path.join(os.tmpdir(), "dark-dila-session.tar.gz");

const PAIRING_NUMBER = String(process.env.PAIRING_NUMBER || "")
    .replace(/\D/g, "");

const OWNER_NUMBER = String(
    process.env.OWNER_NUMBER || process.env.PAIRING_NUMBER || ""
).replace(/\D/g, "");

const logger = pino({ level: "silent" });

let sock;
let reconnectTimer;
let pairingStarted = false;
let sessionUploaded = false;
let stopping = false;

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function checkSettings() {
    if (!PAIRING_NUMBER) {
        throw new Error("PAIRING_NUMBER is missing in GitHub Actions inputs.");
    }

    if (!OWNER_NUMBER) {
        throw new Error("OWNER_NUMBER is missing in GitHub Actions inputs.");
    }

    if (!process.env.MEGA_EMAIL || !process.env.MEGA_PASSWORD) {
        throw new Error("MEGA_EMAIL or MEGA_PASSWORD secret is missing.");
    }
}

async function uploadSession() {
    if (sessionUploaded) return;

    try {
        // Allow Baileys to finish saving the latest credentials.
        await wait(2000);

        if (!fs.existsSync(path.join(SESSION_DIR, "creds.json"))) {
            throw new Error("Session credentials were not created.");
        }

        console.log("[SESSION] Creating session archive...");

        if (fs.existsSync(ARCHIVE)) {
            fs.unlinkSync(ARCHIVE);
        }

        execFileSync("tar", [
            "-czf",
            ARCHIVE,
            "-C",
            __dirname,
            "session"
        ]);

        console.log("[MEGA] Uploading session...");

        const url = await mega.upload(
            ARCHIVE,
            `DARK_DILA_MD_SESSION_${Date.now()}.tar.gz`
        );

        if (!url || typeof url !== "string") {
            throw new Error("MEGA did not return a valid file link.");
        }

        const sessionId = `DARK DILA-MD=${url}`;

        await sock.sendMessage(`${OWNER_NUMBER}@s.whatsapp.net`, {
            text:
                "✅ DARK DILA-MD Pairing Successful!\n\n" +
                "🔐 YOUR SESSION ID:\n\n" +
                sessionId +
                "\n\n⚠️ Keep this Session ID private. Do not share it with anyone."
        });

        sessionUploaded = true;

        fs.rmSync(ARCHIVE, { force: true });

        console.log("[SESSION] Session ID sent to your WhatsApp.");
        console.log("[DONE] Pairing and session upload completed.");

    } catch (error) {
        console.error("[SESSION ERROR]", error.message);
        throw error;
    }
}

async function startBot() {
    if (stopping) return;

    try {
        fs.mkdirSync(SESSION_DIR, { recursive: true });
        checkSettings();

        const { state, saveCreds } =
            await useMultiFileAuthState(SESSION_DIR);

        const { version } = await fetchLatestBaileysVersion();

        console.log("[WHATSAPP] Starting connection...");

        sock = makeWASocket({
            version,
            logger,
            auth: state,
            browser: Browsers.ubuntu("Chrome"),
            printQRInTerminal: false,
            syncFullHistory: false,
            markOnlineOnConnect: false
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async update => {
            const { connection, lastDisconnect } = update;

            if (connection === "connecting") {
                console.log("[WHATSAPP] Connecting...");
            }

            if (connection === "open") {
                console.log("[WHATSAPP] Connected successfully!");

                if (!sessionUploaded) {
                    try {
                        await uploadSession();
                    } catch (error) {
                        console.error("[UPLOAD ERROR]", error.message);
                    }
                }
            }

            if (connection === "close") {
                const status =
                    lastDisconnect?.error?.output?.statusCode;

                console.log("[WHATSAPP] Connection closed:", status);

                if (status === DisconnectReason.loggedOut) {
                    console.log("[STOP] WhatsApp session logged out.");
                    return;
                }

                if (stopping) return;

                if (!state.creds.registered) {
                    pairingStarted = false;
                }

                clearTimeout(reconnectTimer);

                reconnectTimer = setTimeout(() => {
                    startBot();
                }, 5000);
            }
        });

        if (!state.creds.registered && !pairingStarted) {
            pairingStarted = true;

            await wait(3000);

            console.log("[PAIR] Requesting Pair Code...");

            const code = await sock.requestPairingCode(PAIRING_NUMBER);

            console.log("");
            console.log("================================");
            console.log("       DARK DILA-MD");
            console.log("          PAIR CODE");
            console.log("================================");
            console.log(code);
            console.log("================================");
            console.log("Enter this code in WhatsApp Linked Devices.");
            console.log("================================");
            console.log("");
        }

    } catch (error) {
        console.error("[START ERROR]", error.message);

        if (!stopping) {
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(startBot, 10000);
        }
    }
}

process.on("SIGINT", () => {
    stopping = true;
    clearTimeout(reconnectTimer);
    if (sock) sock.end(undefined);
    process.exit(0);
});

process.on("SIGTERM", () => {
    stopping = true;
    clearTimeout(reconnectTimer);
    if (sock) sock.end(undefined);
    process.exit(0);
});

console.log("================================");
console.log("       DARK DILA-MD PAIR");
console.log("================================");

startBot();
