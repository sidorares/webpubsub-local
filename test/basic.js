import { describe, before, after, it } from 'node:test';
import assert from 'node:assert';
import portfinder from 'portfinder';
import { fork } from 'node:child_process';

let server;

describe('WebPubSub', async () => {
    before(async () => {
        const PORT = await portfinder.getPortPromise();
        // spawn server.js node process here
        server = fork('./server.js', { env: { PORT } });
        // wait for server to be ready
        await new Promise((resolve) => {
            server.on('message', (message) => {
                if (message === 'server:listening') {
                    resolve();
                }
            });
        });        
    });

    after(() => {
        server.kill();
    });

    it('message sent to a hub is dispatched to all connections', () => {
        
    });
  });

