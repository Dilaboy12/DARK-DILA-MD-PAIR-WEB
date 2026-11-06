import * as mega from "megajs";
import fs from "fs";

const auth = {
    email: process.env.MEGA_EMAIL,
    password: process.env.MEGA_PASSWORD,

    userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
};

export const upload = (filePath, fileName) => {
    return new Promise((resolve, reject) => {
        if (!auth.email || !auth.password) {
            return reject(
                new Error("MEGA_EMAIL or MEGA_PASSWORD is missing.")
            );
        }

        let storage;
        let settled = false;

        const fail = (error) => {
            if (settled) return;
            settled = true;

            try {
                storage?.close();
            } catch {}

            reject(error);
        };

        try {
            storage = new mega.Storage(auth, (error) => {
                if (error) return fail(error);

                const readStream = fs.createReadStream(filePath);

                const uploadStream = storage.upload({
                    name: fileName,
                    allowUploadBuffering: true
                });

                readStream.on("error", fail);
                uploadStream.on("error", fail);

                uploadStream.on("complete", (file) => {
                    file.link((linkError, url) => {
                        if (linkError) return fail(linkError);
                        if (settled) return;

                        settled = true;

                        try {
                            storage.close();
                        } catch {}

                        resolve(url);
                    });
                });

                readStream.pipe(uploadStream);
            });

            storage.on("error", fail);

        } catch (error) {
            fail(error);
        }
    });
};

export const download = (url) => {
    return new Promise((resolve, reject) => {
        try {
            if (!url) {
                return reject(new Error("MEGA URL is missing."));
            }

            const file = mega.File.fromURL(url);

            file.loadAttributes((error) => {
                if (error) return reject(error);

                file.downloadBuffer((downloadError, buffer) => {
                    if (downloadError) return reject(downloadError);

                    resolve(buffer);
                });
            });

        } catch (error) {
            reject(error);
        }
    });
};
