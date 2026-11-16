
const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const { Command } = require("commander");
const superagent = require("superagent");

// 1. Налаштування параметрів командного рядка
const program = new Command();

program.helpOption("-?, --help");

program
    .requiredOption("-h, --host <address>", "Server address")
    .requiredOption("-p, --port <number>", "Server port", Number)
    .requiredOption("-c, --cache <path>", "Cache directory");

program.parse(process.argv);

const options = program.opts();

const HOST = options.host;
const PORT = options.port;
const CACHE_DIR = path.resolve(options.cache);

// 2. Перевірка параметрів
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error("Error: invalid port number");
    process.exit(1);
}

// 3. Отримання тіла PUT-запиту
async function readRequestBody(request) {
    const chunks = [];

    for await (const chunk of request) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

// 4. Відправлення текстової відповіді
function sendText(response, statusCode, message, headers = {}) {
    response.writeHead(statusCode, {
        "Content-Type": "text/plain; charset=utf-8",
        ...headers
    });

    response.end(message);
}

// 5. Отримання шляху до файлу кешу
function getCacheFile(code) {
    return path.join(CACHE_DIR, `${code}.jpg`);
}

// 6. Обробка GET-запиту
async function handleGet(code, response) {
    const filePath = getCacheFile(code);
    let image;

    try {
        // Перевірка локального кешу
        image = await fs.readFile(filePath);

        response.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Content-Length": image.length,
            "X-Cache": "HIT"
        });

        response.end(image);
        return;
    } catch (error) {
        if (error.code !== "ENOENT") {
            throw error;
        }
    }

    // Якщо картинки немає, отримуємо її з http.cat
    try {
        const result = await superagent
            .get(`https://http.cat/${code}`)
            .buffer(true);

        image = result.body;

        if (!Buffer.isBuffer(image)) {
            image = Buffer.from(image);
        }
    } catch (error) {
        sendText(response, 404, "Image not found");
        return;
    }

    // Збереження картинки в кеші
    await fs.writeFile(filePath, image);

    response.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": image.length,
        "X-Cache": "MISS"
    });

    response.end(image);
}

// 7. Обробка PUT-запиту
async function handlePut(code, request, response) {
    const image = await readRequestBody(request);

    if (image.length === 0) {
        sendText(response, 400, "Empty image");
        return;
    }

    const filePath = getCacheFile(code);

    await fs.writeFile(filePath, image);

    sendText(response, 201, "Image saved successfully");
}

// 8. Обробка DELETE-запиту
async function handleDelete(code, response) {
    const filePath = getCacheFile(code);

    try {
        await fs.unlink(filePath);
        sendText(response, 200, "Image deleted successfully");
    } catch (error) {
        if (error.code === "ENOENT") {
            sendText(response, 404, "Image not found");
        } else {
            throw error;
        }
    }
}

// 9. Створення HTTP-сервера
async function startServer() {
    // Створення теки кешу, якщо її ще немає
    await fs.mkdir(CACHE_DIR, { recursive: true });

    const server = http.createServer(async (request, response) => {
        try {
            // Дозволені HTTP-методи
            const method = request.method;

            if (!["GET", "PUT", "DELETE"].includes(method)) {
                sendText(response, 405, "Method Not Allowed", {
                    "Allow": "GET, PUT, DELETE"
                });
                return;
            }

            // Отримання коду з URL
            const url = new URL(request.url, `http://${HOST}`);
            const match = url.pathname.match(/^\/(\d{3})$/);

            if (!match) {
                sendText(response, 400, "Invalid image code");
                return;
            }

            const code = match[1];

            // Вибір обробника відповідно до методу
            if (method === "GET") {
                await handleGet(code, response);
            } else if (method === "PUT") {
                await handlePut(code, request, response);
            } else if (method === "DELETE") {
                await handleDelete(code, response);
            }
        } catch (error) {
            console.error("Server error:", error.message);

            if (!response.headersSent) {
                sendText(response, 500, "Internal Server Error");
            } else {
                response.destroy();
            }
        }
    });

    server.listen(PORT, HOST);

    console.log(`Server running at http://${HOST}:${PORT}`);
}

// 10. Запуск програми
startServer().catch((error) => {
    console.error("Startup error:", error.message);
    process.exitCode = 1;
});
