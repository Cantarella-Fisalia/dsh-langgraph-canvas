import { environmentValue } from '../../../scripts/runtime/brand.mjs';
import { createServer } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApplication } from "./application.js";
export function startServer(port = Number(environmentValue('PORT') || 4318)) {
    const app = createApplication({ repoRoot: fileURLToPath(new URL('../../../', import.meta.url)) });
    const server = createServer(async (req, res) => {
        if (!['127.0.0.1', 'localhost', '[::1]'].includes((req.headers.host || '').replace(/:\d+$/, ''))) {
            res.writeHead(403);
            res.end();
            return;
        }
        if (!(await app.handler(req, res))) {
            res.writeHead(404);
            res.end('Not found');
        }
    });
    server.listen(port, '127.0.0.1', () => console.log('dsh-langgraph-canvas API: http://127.0.0.1:' + server.address().port + '/api/v1'));
    const stop = () => { app.close(); server.close(); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return { server, stop };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
    startServer();
