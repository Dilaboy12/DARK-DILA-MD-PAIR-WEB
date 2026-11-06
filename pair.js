import express from "express";
import fs from "fs";
import path from "path";
import pino from "pino";
import archiver from "archiver";

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
    DisconnectReason
} from "@whiskeysockets/baileys";

import pn from "awesome-phonenumber";
import { upload } from "./mega.js";

const router = express.Router();

const logger = pino({ level: "silent" });

const activeSessions = new Set();

function removeFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.rmSync(filePath, {
                recursive: true,
                force: true
            });
        }
    } catch (error) {
        console.error("File cleanup error:", error.message);
    }
}

function zipFolder(sourceDir, outputPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);

        const archive = archiver("zip", {
            zlib: { level: 9 }
        });

        output.on("close", () => resolve());
        output.on("error", reject);
        archive.on("error", reject);

        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize().catch(reject);
    });
}

function getStatusCode(error) {
    return (
        error?.output?.statusCode ||
        error?.data?.statusCode ||
        error?.statusCode
    );
}

// ==========================================
// PAIR ROUTE
// ==========================================

router.get("/", async (req, res) => {
    let number = String(req.query.number || "")
        .replace(/[^0-9]/g, "");

    if (!number) {
        return res.status(400).json({
            code: "Phone number is required."
        });
    }

    const phone = pn("+" + number);

    if (!phone.isValid()) {
        return res.status(400).json({
            code: "Invalid phone number. Use your full international number."
        });
    }

    number = phone.getNumber("e164").replace("+", "");

    if (activeSessions.has(number)) {
        return res.status(429).json({
            code: "A pairing request is already active for this number."
        });
    }

    activeSessions.add(number);

    const sessionDir = path.resolve("./sessions", number);
    const zipPath = path.resolve(
        `./session_${number}_${Date.now()}.zip`
    );

    removeFile(sessionDir);

    let socket;
    let saveCreds;
    let sessionUploaded = false;
    let restartCount = 0;
    let processingSession = false;

    try {
        const authState = await useMultiFileAuthState(sessionDir);

        const state = authState.state;
        saveCreds = authState.saveCreds;

        const { version } = await fetchLatestBaileysVersion();

        console.log(
            "Starting DARK DILA-MD pairing session..."
        );

        async function createSocket() {
            socket = makeWASocket({
                version,

                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        logger
                    )
                },

                printQRInTerminal: false,
                logger,

                browser: Browsers.windows("Chrome"),

                markOnlineOnConnect: false,
                generateHighQualityLinkPreview: false,

                defaultQueryTimeoutMs: 60000,
                connectTimeoutMs: 60000,
                keepAliveIntervalMs: 30000,
                retryRequestDelayMs: 250,
                maxRetries: 5
            });

            socket.ev.on("creds.update", saveCreds);

            socket.ev.on(
                "connection.update",
                async (update) => {
                    const {
                        connection,
                        lastDisconnect
                    } = update;

                    // ==================================
                    // CONNECTION OPEN
                    // ==================================

                    if (connection === "open") {
                        console.log(
                            "DARK DILA-MD WhatsApp connected."
                        );

                        if (sessionUploaded || processingSession) {
                            return;
                        }

                        processingSession = true;

                        try {
                            await delay(2000);

                            console.log(
                                "Creating session archive..."
                            );

                            await zipFolder(
                                sessionDir,
                                zipPath
                            );

                            console.log(
                                "Uploading session to MEGA..."
                            );

                            const megaUrl = await upload(
                                zipPath,
                                path.basename(zipPath)
                            );

                            if (
                                !megaUrl ||
                                !String(megaUrl).includes("mega")
                            ) {
                                throw new Error(
                                    "Invalid MEGA upload URL."
                                );
                            }

                            const finalSessionId =
                                "DARK DILA-MD=" + megaUrl;

                            // Send the session ID to the linked account.
                            const userJid = jidNormalizedUser(
                                socket.user.id
                            );

                            await socket.sendMessage(userJid, {
                                text: finalSessionId
                            });

                            sessionUploaded = true;

                            console.log(
                                "DARK DILA-MD session uploaded successfully."
                            );

                            // Remove temporary files after upload.
                            removeFile(zipPath);
                            removeFile(sessionDir);

                        } catch (error) {
                            console.error(
                                "Session upload error:",
                                error.message
                            );

                            removeFile(zipPath);

                        } finally {
                            processingSession = false;
                            activeSessions.delete(number);
                        }
                    }

                    // ==================================
                    // CONNECTION CLOSED
                    // ==================================

                    if (connection === "close") {
                        const reason = getStatusCode(
                            lastDisconnect?.error
                        );

                        console.log(
                            "WhatsApp connection closed. Code:",
                            reason
                        );

                        if (
                            reason === DisconnectReason.restartRequired &&
                            restartCount < 2 &&
                            !sessionUploaded
                        ) {
                            restartCount++;

                            console.log(
                                "Restarting WhatsApp connection..."
                            );

                            await delay(1500);
                            await createSocket();

                            return;
                        }

                        if (!sessionUploaded) {
                            activeSessions.delete(number);
                        }
                    }
                }
            );
        }

        await createSocket();

        // ==========================================
        // REQUEST PAIRING CODE
        // ==========================================

        await delay(2000);

        const code = await socket.requestPairingCode(number);

        if (!res.headersSent) {
            return res.status(200).json({
                code
            });
        }

    } catch (error) {
        console.error(
            "Pairing initialization error:",
            error.message
        );

        activeSessions.delete(number);

        removeFile(zipPath);
        removeFile(sessionDir);

        if (!res.headersSent) {
            return res.status(500).json({
                code: "Failed to start pairing session."
            });
        }
    }
});

export default router;
