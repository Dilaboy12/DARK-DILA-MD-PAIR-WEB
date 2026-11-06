const mega = require("megajs");
const fs = require("fs");

function upload(filePath, fileName) {
    return new Promise((resolve, reject) => {
        const email = process.env.MEGA_EMAIL;
        const password = process.env.MEGA_PASSWORD;

        if (!email || !password) {
            return reject(
                new Error("MEGA_EMAIL or MEGA_PASSWORD is missing")
            );
        }

        let storage;

        try {
            storage = new mega.Storage(
                { email, password },
                (error) => {
                    if (error) return reject(error);

                    const input = fs.createReadStream(filePath);

                    const output = storage.upload({
                        name: fileName,
                        allowUploadBuffering: true
                    });

                    input.on("error", reject);
                    output.on("error", reject);

                    output.on("complete", (file) => {
                        file.link((linkError, url) => {
                            storage.close();

                            if (linkError) return reject(linkError);

                            resolve(url);
                        });
                    });

                    input.pipe(output);
                }
            );

            storage.on("error", reject);

        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { upload };
